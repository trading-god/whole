// Token-level role labeling for the OCR pipeline. Where `classifyRow` assigns
// one role to a whole line's joined text, this module assigns a role to each
// individual OCR token (word-level block) — so a line like "360 Account
// $5,000.00 SGD" yields `accountName` + `accountName` + `amount` + `currency`
// instead of a single `amountRow` that the grouping step then has to split
// apart by string surgery. The grouping step consumes these per-token roles to
// assemble account name, balance, and card number from whichever tokens carry
// each role, without assuming the line's text order.
//
// This module is PURE (no React Native / Expo imports): it works on the same
// `OcrTextBlock[]` the parser already clusters into lines, so it composes with
// the eval harness exactly like the rest of the pipeline.
import { z } from "zod";

import { currencySchema, type Currency } from "./currencies";
import {
  isAccountNumber,
  CYRILLIC_RE,
  hasLabelMarker,
  hasSummaryMarker,
  NON_ASCII_SYMBOL_RE,
  TIME_FRAGMENT_RE,
} from "./ocr-line-classify";
import {
  hasAmountShape,
  isCardLike,
  isMaskedCard,
  matchAmount,
  NUMBER_RE,
  stripDateFragments,
  toParsed,
  WHOLE_AMOUNT_RE,
} from "./ocr-amount";
import { currencyMention } from "./ocr-currency";
import {
  DEFAULT_ACCOUNT_KEYWORD_RE,
  defaultNoiseTokens,
} from "./ocr-bank-config";
import type { OcrTextBlock } from "./ocr-types";

// A token's semantic role within a line. More granular than `RowRole`
// (`ocr-line-classify`) because a single line can carry several roles at once.
// `unknown` is the safe fallback — the grouping step treats it as inert (it
// neither opens a new account region nor attaches a balance).
export const tokenRoleSchema = z.enum([
  "currency", // SGD, $, S$, CN¥, CNH — a currency code or symbol
  "amount", // 6,672.59 / 100,554.59 / 0.00 — a money figure
  "cardNumber", // **** 1234, 4218-0803-2297-3829, 624-680187-001
  "accountName", // 360, Account, Global, Savings — words that name an account
  "label", // Available, Balance, 余额 — a field label, not a name
  "navArrow", // >, ›, », ← — a tappable-row chevron
  "noise", // iR₩, ЛКР, EITE, 5G — status-bar / icon gibberish
  "date", // 08/26, 11 Aug 2026 — a date fragment
  "summaryMarker", // Total, 总资产, Equivalent — an aggregate-row marker
  "unknown", // couldn't classify; inert to the grouping step
]);
export type TokenRole = z.infer<typeof tokenRoleSchema>;

// One OCR token with its classified role and full normalized bounding box.
// The box is the full {x, y, width, height} (0..1, top-left origin) — not just
// center-x — so a future spatial-clustering grouping step can use vertical
// gaps and x-overlap to assign tokens to accounts without re-reading the
// source blocks. For now the grouping step is linear (top→bottom), but the
// data is already there.
//
// `currency` / `amount` are filled only when the role is `currency` / `amount`
// respectively; other roles leave them undefined.
export type TokenWithRole = {
  text: string;
  role: TokenRole;
  box: { x: number; y: number; width: number; height: number };
  currency?: Currency;
  amount?: number;
  // 0-based index within the originating line. Preserved across
  // `mergeAdjacentTokens` so the eval trace can point back at the source block.
  index: number;
};

// Morphological noise patterns are shared with the row classifier
// (`ocr-line-classify`) — a single definition so tuning the symbol set or the
// time-fragment shape edits one file, not two copies. A Cyrillic run is OCR
// misreading a non-Latin label; the non-ASCII symbol set catches status-bar /
// icon glyphs (₩, ₺, €, £) but deliberately excludes `¥`, which is the CNY
// currency symbol this app recognizes (see `OCR_ONLY_SYMBOLS` in
// ocr-currency.ts).
const NAV_ARROW_RE = /^[<>›»←→]$/;

// Whether a single token is a nav/footer label ("退出", "首页", "账户",
// "back", "home"). Chinese nav tokens are matched as exact-equal (a standalone
// "退出"/"首页" row is nav noise); English nav tokens are matched
// case-insensitively on the whole token.
function isNoiseToken(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  const lower = trimmed.toLowerCase();
  return (
    defaultNoiseTokens.en.includes(lower) ||
    defaultNoiseTokens.zh.some((m) => trimmed.includes(m))
  );
}

// Locates the currency mention that covers a given token, if any. A token like
// "SGD" is itself a currency code; a token like "$5,000.00" carries a currency
// symbol fused into an amount token. `currencyMention` on the whole line finds
// the symbol's char index; this maps that index back to the token whose text
// spans it, so the fused token can be tagged `amount` with a `currency` field.
function currencyCoveringToken(
  mention: { index: number; currency: Currency; token: string } | undefined,
  tokenStart: number,
  tokenEnd: number,
): Currency | undefined {
  if (!mention) {
    return undefined;
  }
  // The mention's char range overlaps this token's char range in the joined
  // line text. A symbol fused into an amount token ("$5,000.00") overlaps;
  // a standalone "SGD" token is its own match and gets role `currency` directly.
  const mentionEnd = mention.index + mention.token.length;
  return mention.index < tokenEnd && mentionEnd > tokenStart
    ? mention.currency
    : undefined;
}

// Classifies the tokens of one clustered line. Returns one `TokenWithRole` per
// source block (after merging adjacent amount fragments — see
// `mergeAdjacentTokens`). Pure; operates on the line's blocks and their
// joined text.
//
// Order matters: more specific morphology (card, account number, date, arrow,
// noise) is tested before the amount/label/name keywords, so a masked-card
// token "••••" never falls through to `unknown` and a "Total" token is a
// `summaryMarker` before it could be mistaken for an account name.
export function classifyTokens(
  line: OcrTextBlock[],
  lineText = line.map((b) => b.text).join(" "),
): TokenWithRole[] {
  const mention = currencyMention(lineText);

  // Precompute each token's char span in the joined line text, so the currency
  // mention (char-indexed) can be mapped back to the token it covers.
  let cursor = 0;
  const spans = line.map((b) => {
    const start = lineText.indexOf(b.text, cursor);
    const end = start + b.text.length;
    cursor = end;
    return { start, end };
  });

  const raw: TokenWithRole[] = line.map((block, i) => {
    const text = block.text;
    const span = spans[i];
    const box = block.normalizedBox;
    const base = { text, role: "unknown" as TokenRole, box, index: i };

    // 1. Currency code or symbol — standalone "SGD" / "HKD" / "$" / "CNH".
    //    `currencySchema` catches ISO codes; `currencyMention` on the single
    //    token catches OCR-only aliases (CNH, ¥, US$) that the display schema
    //    doesn't carry. A symbol fused into an amount token ("$5,000.00") is
    //    handled below in the amount branch via `fusedCurrency`.
    const trimmedUpper = text.trim().toUpperCase();
    const parsedCurrency = currencySchema.safeParse(trimmedUpper);
    if (parsedCurrency.success) {
      return { ...base, role: "currency", currency: parsedCurrency.data };
    }
    const singleMention = currencyMention(text);
    if (
      singleMention &&
      singleMention.index === 0 &&
      singleMention.token.length === text.trim().length
    ) {
      return { ...base, role: "currency", currency: singleMention.currency };
    }
    // A currency symbol fused into this token ("$5,000.00") — the token is an
    // amount that also carries a currency; handle below in the amount branch.
    const fusedCurrency = currencyCoveringToken(mention, span.start, span.end);

    // 2. Masked card / full card number / bank account number.
    if (isMaskedCard(text) || isCardLike(text) || isAccountNumber(text)) {
      return { ...base, role: "cardNumber" };
    }

    // 3. Date fragment ("08/26", "12/05/2024").
    if (stripDateFragments(text) !== text) {
      return { ...base, role: "date" };
    }

    // 4. Navigation chevron.
    if (NAV_ARROW_RE.test(text)) {
      return { ...base, role: "navArrow" };
    }

    // 5. Nav/footer label ("退出", "首页", "账户", "back", "home"). Matched
    //    before morphological noise so a standalone nav token is noise even if
    //    it's an ASCII word that could otherwise fall through to accountName.
    //    A real account name ("Home Loan") contains an account keyword and is
    //    NOT a standalone nav token, so this doesn't over-match.
    if (isNoiseToken(text)) {
      return { ...base, role: "noise" };
    }

    // 6. Morphological noise: Cyrillic, non-ASCII icon glyph, or a status-bar
    //    time fragment. A token with a real account keyword is NOT noise even
    //    if it carries one of these glyphs — `DEFAULT_ACCOUNT_KEYWORD_RE` guards that.
    if (CYRILLIC_RE.test(text)) {
      return { ...base, role: "noise" };
    }
    if (!DEFAULT_ACCOUNT_KEYWORD_RE.test(text)) {
      if (NON_ASCII_SYMBOL_RE.test(text) || TIME_FRAGMENT_RE.test(text)) {
        return { ...base, role: "noise" };
      }
    }

    // 7. Amount — a money figure. A standalone token "6,672.59" matches
    //    NUMBER_RE; a fused "$5,000.00" also matches and carries the currency.
    //    Mirrors `matchAmount`'s fallback guard: a bare integer ("360", "3")
    //    is NOT an amount — too easily confused with a digit in an account name
    //    or a count like "in 3 currencies". Require thousands grouping (`,`/`'`)
    //    or a 2-decimal tail, unless a currency symbol is fused into this token
    //    ("$5,000.00" carries its own disambiguator).
    if (NUMBER_RE.test(text)) {
      const parsed = toParsed(text, fusedCurrency);
      if (parsed.ok && (fusedCurrency || hasAmountShape(text))) {
        return {
          ...base,
          role: "amount",
          amount: parsed.amount,
          currency: parsed.currency,
        };
      }
      // A fused currency symbol ("$5,000.00") isn't a bare number, so
      // `toParsed` rejects it. Fall back to `matchAmount`, whose currency-
      // anchored match strips the symbol and captures the number beside it —
      // the same way row-level classification reads "360 Account $5,000.00".
      if (fusedCurrency) {
        const fused = matchAmount(text);
        if (fused.ok) {
          return {
            ...base,
            role: "amount",
            amount: fused.amount,
            currency: fused.currency,
          };
        }
      }
    }

    // 8. Summary-row marker ("Total", "总资产").
    if (hasSummaryMarker(text.toLowerCase())) {
      return { ...base, role: "summaryMarker" };
    }

    // 9. Field label ("Available", "Balance", "余额").
    if (hasLabelMarker(text.toLowerCase())) {
      return { ...base, role: "label" };
    }

    // 10. Account-name keyword ("Account", "Savings", "Global", ...). A token
    //    like "360" that is NOT an amount and NOT a label falls through to
    //    `accountName` only when it reads like part of a name — digits-only
    //    tokens without a keyword are `unknown` so they don't spuriously name
    //    an account. "360" alone is `accountName` because the grouping step
    //    treats it as a name candidate alongside a following keyword token.
    if (DEFAULT_ACCOUNT_KEYWORD_RE.test(text)) {
      return { ...base, role: "accountName" };
    }

    // A bare English word token (not a keyword, not noise) is a name candidate —
    // bank product names like "Multiplier", "Everyday", "360" aren't in the
    // keyword list but are real name words. Keeping it as `accountName` lets the
    // grouping step collect it; `isRealAccountName` (the keyword check) still
    // gates whether a region actually opens.
    //
    // CJK-only tokens do NOT fall through to accountName here: on Chinese bank
    // UIs the account name is almost always an English product name ("360
    // Account", "Global Savings Account"), while standalone Chinese tokens are
    // nav labels (退出/首页/账户), field labels (可用余额), or section headers —
    // none of which should open a spurious account region. Chinese tokens that
    // aren't labels/summary/noise stay `unknown` so the grouping step treats
    // them as inert.
    if (/[a-zA-Z]/.test(text)) {
      return { ...base, role: "accountName" };
    }

    return base;
  });

  return mergeAdjacentTokens(raw);
}

// Merges tokens the OCR engine split across block boundaries but that form one
// semantic unit. Two cases:
// - Amount fragments: "6," + "672.59" (ML Kit word-splitting) merge into one
//   `amount` token whose joined text matches NUMBER_RE and parses via toParsed.
// - Adjacent labels: "Available" + "Balance" merge into one `label` token.
//
// Does NOT merge: `accountName` tokens (the grouping step joins them into a
// name string, so keeping them separate preserves the option to strip a
// leading icon tag), and `currency` + `amount` (they pair, not merge).
function mergeAdjacentTokens(tokens: TokenWithRole[]): TokenWithRole[] {
  const out: TokenWithRole[] = [];
  for (const token of tokens) {
    const prev = out[out.length - 1];

    // Amount-fragment merge: a partial amount ("6,") glued to a following
    // amount-shaped fragment ("672.59"), or two amount fragments whose join
    // parses as a well-formed amount.
    if (
      prev &&
      (prev.role === "amount" || isAmountFragment(prev.text)) &&
      isAmountFragment(token.text) &&
      !WHOLE_AMOUNT_RE.test(prev.text) // only merge if the prev wasn't already whole
    ) {
      const joined = prev.text + token.text;
      const parsed = toParsed(joined, prev.currency ?? token.currency);
      if (parsed.ok) {
        out[out.length - 1] = {
          ...prev,
          text: joined,
          amount: parsed.amount,
          currency: parsed.currency,
          box: unionBox(prev.box, token.box),
        };
        continue;
      }
    }

    // Adjacent-label merge: "Available" + "Balance" → one label.
    if (prev && prev.role === "label" && token.role === "label") {
      out[out.length - 1] = {
        ...prev,
        text: `${prev.text} ${token.text}`,
        box: unionBox(prev.box, token.box),
      };
      continue;
    }

    out.push(token);
  }
  return out;
}

// Whether a token looks like a fragment of a larger amount — a digit run with
// a trailing comma ("6,"), a leading decimal ("672.59"), or a bare digit group
// ("672"). Used by `mergeAdjacentTokens` to spot splits ML Kit introduced.
function isAmountFragment(text: string): boolean {
  return (
    /^\d{1,3}(?:,$|,\d{3}$|\.\d+$|\d{3}$)/.test(text) || /^\d+$/.test(text)
  );
}

// The smallest box covering two adjacent boxes (for merged tokens). Both are
// 0..1 normalized; the union is the min origin and max extent.
function unionBox(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.width, b.x + b.width);
  const bottom = Math.max(a.y + a.height, b.y + b.height);
  return { x, y, width: right - x, height: bottom - y };
}
