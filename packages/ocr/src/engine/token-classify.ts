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
import {
  isCurrencyCode,
  normalizeCurrencyToken,
  type Currency,
} from "../contract/currency";
// The morphological noise patterns are shared with the row classifier — a
// single definition so tuning the symbol set or the time-fragment shape edits
// one file, not two copies. A Cyrillic run is OCR misreading a non-Latin label;
// the non-ASCII symbol set catches status-bar / icon glyphs (₩, ₺, €, £) but
// deliberately excludes `¥`, which is the CNY currency symbol this app
// recognizes (see `OCR_ONLY_SYMBOLS` in currency-mention.ts).
import {
  isAccountNumber,
  CYRILLIC_RE,
  hasSummaryMarker,
  NON_ASCII_SYMBOL_RE,
  TIME_FRAGMENT_RE,
} from "./line-classify";
import {
  hasAmountShape,
  hasCurrencyAmountShape,
  isCardLike,
  matchAmount,
  NUMBER_RE,
  stripDateFragments,
  toParsed,
  WHOLE_AMOUNT_RE,
} from "./amount";
import { currencyMention } from "./currency-mention";
import {
  DEFAULT_ACCOUNT_KEYWORD_RE,
  defaultNoiseTokens,
  isLabelToken,
} from "./vocabulary";
import type { OcrTextBlock } from "../contract/block";

// A token's semantic role within a line. More granular than `RowRole`
// (`line-classify.ts`) because a single line can carry several roles at once.
// `unknown` is the safe fallback — the grouping step treats it as inert (it
// neither opens a new account region nor attaches a balance).
//
// A plain union, not a zod enum: this role never crosses a boundary — it is
// produced and consumed inside the pipeline — so there is nothing to validate
// at runtime, and `RowRole` next door is written the same way.
export type TokenRole =
  | "currency" // SGD, $, S$, CN¥, CNH — a currency code or symbol
  | "amount" // 6,672.59 / 100,554.59 / 0.00 — a money figure
  | "cardNumber" // **** 1234, 4218-0803-2297-3829, 624-680187-001
  | "accountName" // 360, Account, Global, Savings — words that name an account
  | "label" // Available, Balance, 余额 — a field label, not a name
  | "navArrow" // >, ›, », ← — a tappable-row chevron
  | "noise" // iR₩, ЛКР, EITE, 5G — status-bar / icon gibberish
  | "date" // 08/26, 11 Aug 2026 — a date fragment
  | "summaryMarker" // Total, 总资产, Equivalent — an aggregate-row marker
  | "unknown"; // couldn't classify; inert to the grouping step

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

// A tappable-row chevron, alone in its own token.
const NAV_ARROW_RE = /^[<>›»←→]$/;

// Whether a single token is a nav/footer label ("退出", "首页", "账户",
// "back", "home"), on a row that is not naming an account.
//
// Both scripts match the WHOLE token, the same rule `classifyRow` applies to a
// whole row. Substring-matching the Chinese arm — which this did — meant any
// token merely containing a nav word was noise: "投资理财" contains "投资", so
// the row lost its name AND its asset kind, since the kind is read off that
// name. `vocabulary.ts` records the same lesson from the row-level check.
//
// The row guard is what keeps a nav WORD inside a real name: every token of a
// multi-word name stands alone by construction, so "Home Loan" and "Profile
// Savings" were losing their first word to `defaultNoiseTokens.en`. A row that
// carries an account keyword is naming something; its words are name words.
// Chrome that trails a real name ("储蓄户口 付款 更多") is still dropped —
// `cleanAccountName` truncates at the last account keyword.
function isNoiseToken(text: string, lineText: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || DEFAULT_ACCOUNT_KEYWORD_RE.test(lineText)) {
    return false;
  }
  return (
    defaultNoiseTokens.en.includes(trimmed.toLowerCase()) ||
    defaultNoiseTokens.zh.includes(trimmed)
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

// The currency a token IS, when the whole token is one — "SGD", "$", "-S$".
// Undefined for a token that merely contains a symbol ("$5,000.00"), which the
// amount branch pairs through `currencyCoveringToken` instead.
//
// One definition, computed once per block and read twice: the row asks it of
// every block to find the first currency and of each block's neighbour to
// decide the one-decimal relaxation, and the classifier then asks it again of
// the block itself. `currencyMention` is the scan `contract/currency.ts`
// profiled at ~40% of parser CPU, and the two copies had already drifted — the
// leading-minus strip had to be back-ported into one of them.
//
// The token is cleaned by `normalizeCurrencyToken`, which is also what
// `isUnstorableCurrencyCode` asks of it — so a glyphed or signed code is either
// a currency or a known-unstorable one, never neither.
function standaloneCurrency(text: string): Currency | undefined {
  const cleaned = normalizeCurrencyToken(text);
  if (isCurrencyCode(cleaned)) {
    return cleaned;
  }
  const single = currencyMention(cleaned);
  return single && single.index === 0 && single.token.length === cleaned.length
    ? single.currency
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
    // `lineText` defaults to the space-join of these very blocks, so the search
    // normally succeeds. A caller passing anything else — normalized text,
    // de-noised text — would otherwise get `start = -1`, and since the cursor
    // advances from it EVERY later span would be wrong, mapping a fused
    // currency symbol onto the wrong token. Falling back to the cursor keeps
    // the spans monotonic and in bounds.
    const found = lineText.indexOf(b.text, cursor);
    const start = found === -1 ? cursor : found;
    const end = start + b.text.length;
    cursor = end;
    return { start, end };
  });

  // A percentage the OCR split across two blocks: "-0.51" followed by "%".
  // `matchAmount` strips percentages from a whole ROW, but the grouping step
  // sums per TOKEN, so a split "%" left the rate labelled `amount` and it was
  // added to the balance ("SGD 1,234.56 -0.51 %" recognized 1,234.05). Glued
  // into one token ("-0.51%") the row path already handled it.
  const followedByPercent = (i: number) =>
    line[i + 1]?.text.trim().startsWith("%") ?? false;
  const isPercentSign = (i: number) => line[i].text.trim() === "%";

  // Whether a block is a standalone currency token ("SGD", "HK$", "-S$"). Used
  // to decide whether the figure NEXT to it may use the looser one-decimal
  // amount shape.
  //
  // Answered once per block and cached: the row asks it of every block to find
  // the first one, then again of each block's neighbour, and `currencyMention`
  // is the expensive scan `contract/currency.ts` profiled at ~40% of parser CPU.
  const blockCurrencies = line.map((block) => standaloneCurrency(block.text));
  const isCurrencyBlock = (i: number) => blockCurrencies[i] !== undefined;

  // Whether the row prints its currency codes BEFORE their figures. Decided
  // once for the row, from the first currency block and the first FIGURE.
  //
  // A figure, not any digit run: an icon tag ("360 Account SGD 403.3"), a date
  // ("08/26 SGD 403.3") or a card tail sits left of the currency and flipped the
  // answer, so the one-decimal relaxation then looked on the wrong side of the
  // real figure and the balance was left `unknown`. Money carries a decimal
  // point or a thousands separator; a bare digit run does not, and a date is
  // gone before the test.
  const firstCurrencyBlock = blockCurrencies.findIndex(
    (currency) => currency !== undefined,
  );
  const firstNumberBlock = line.findIndex((block) => {
    const dateless = stripDateFragments(block.text);
    return NUMBER_RE.test(dateless) && /[.,']/.test(dateless);
  });
  // Whether the row already carries a figure that needs no relaxation to read
  // as money. See the `amountShape` choice below.
  const rowStatesAWellFormedAmount = line.some((block) =>
    hasAmountShape(stripDateFragments(block.text)),
  );
  const currencyLeadsOnRow =
    firstCurrencyBlock !== -1 &&
    (firstNumberBlock === -1 || firstCurrencyBlock < firstNumberBlock);

  const raw: TokenWithRole[] = line.map((block, i) => {
    const text = block.text;
    const span = spans[i];
    const box = block.normalizedBox;
    const base = { text, role: "unknown" as TokenRole, box, index: i };

    // Whether a currency sits ON this token, or on the side the row puts its
    // codes. Symmetric, the relaxation leaked mirrored: on a currency-leading
    // row "3.5 SGD 50,000.00" the RATE is what touches the currency, and 3.50
    // was summed into the balance.
    const currencyAdjacent =
      currencyCoveringToken(mention, span.start, span.end) !== undefined ||
      isCurrencyBlock(i + (currencyLeadsOnRow ? -1 : 1));

    // 0. A rate, not money. Left `unknown` so the grouping step treats it as
    //    inert, exactly like the stripped fragment on the row path.
    //
    //    A figure immediately followed by a bare "%" block IS a percentage —
    //    that is what the notation means, and no further test is applied.
    //
    //    Three narrower rules were tried here (a currency beside the figure, a
    //    thousands separator in it, "the row has another figure"), each meant
    //    to spare a balance with a stray "%" glyph clustered onto it. Every one
    //    mis-read some ordinary row instead — the last counted "3.50" in
    //    "利率 3.50" as the account's balance. No sample carries a bare "%"
    //    block at all (all 17 print percentages glued to their figure, which
    //    the row-level `stripPercentages` already removes), so the guard was
    //    guessing on both sides. Between dropping a real balance and inventing
    //    a rate as one, dropping is the visible error.
    // Only a FIGURE is dropped for sitting beside a "%". Applied to every
    // token, the guard stripped the role from whatever preceded the sign — on
    // "SGD % 1,234.56" it demoted the row's CURRENCY, so the balance came back
    // undenominated (or, on an institution with a home currency, silently
    // re-denominated into it).
    if (isPercentSign(i) || (followedByPercent(i) && NUMBER_RE.test(text))) {
      return base;
    }

    // 1. Currency code or symbol — standalone "SGD" / "HKD" / "$" / "CNH".
    //    `isCurrencyCode` catches ISO codes; `currencyMention` on the single
    //    token catches OCR-only aliases (CNH, ¥, US$) that the display schema
    //    doesn't carry. A symbol fused into an amount token ("$5,000.00") is
    //    handled below in the amount branch via `fusedCurrency`.
    //    OCR routinely glues a stray glyph onto a currency code — a dropdown
    //    chevron reads as "SGD、", a separator as "UsD、". Trailing punctuation
    //    is stripped before the comparison so the code is still recognized;
    //    without this the row has no currency at all and its balance is
    //    dropped. Currency symbols ($ ¥ € £) are kept, being part of the token.
    const standalone = blockCurrencies[i];
    if (standalone) {
      return { ...base, role: "currency", currency: standalone };
    }
    // A currency symbol fused into this token ("$5,000.00") — the token is an
    // amount that also carries a currency; handle below in the amount branch.
    const fusedCurrency = currencyCoveringToken(mention, span.start, span.end);

    // 2. Card number (masked or full — `isCardLike` covers both) or account
    //    number.
    if (isCardLike(text) || isAccountNumber(text)) {
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

    // 5. Nav/footer label ("退出", "首页", "账户", "back", "home") on a row that
    //    isn't naming an account. Matched before morphological noise so a
    //    standalone nav token is noise even if it's an ASCII word that could
    //    otherwise fall through to accountName.
    if (isNoiseToken(text, lineText)) {
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
    //
    //    A one-decimal figure counts only when a currency sits ON or NEXT TO
    //    this token (see `hasCurrencyAmountShape`): "$403.3" and "HKD 1,212.5"
    //    are money, a bare "3.5" is not. Row-wide, the relaxation leaked —
    //    "SGD 5,000.00 Interest 3.5" summed the rate into the balance.
    //
    //    And only when the row states no better-formed figure. A one-decimal
    //    figure beside a currency is money on a screen that prints nothing else
    //    ("$403.3" is Bitget Wallet's whole total); on a row that also carries a
    //    grouped or two-decimal figure it is the rate or tenor printed beside
    //    the balance, and "3.5 SGD 50,000.00" was recognized as 50,003.50.
    const amountShape =
      currencyAdjacent && !rowStatesAWellFormedAmount
        ? hasCurrencyAmountShape
        : hasAmountShape;
    if (NUMBER_RE.test(text)) {
      // A currency the TOKEN carries, when the row-level scan didn't find it
      // here: `currencyMention` reports only the FIRST mention on the row, so
      // the second of two glued figures ("1,212.52HKD 500.00USD" — HSBC prints
      // codes glued) had no currency, and its raw text ("500.00USD") failed the
      // end-anchored shape tests too. The figure was left unlabelled: dropped
      // as a balance and, being a name-ish token, offered as the account's NAME.
      const own = currencyMention(text);
      const ownCurrency = fusedCurrency ?? own?.currency;
      // The figure with that code removed, for the shape tests and for
      // `toParsed`, which needs the whole token to BE a number.
      const bare = own
        ? `${text.slice(0, own.index)}${text.slice(own.index + own.token.length)}`
        : text;
      const parsed = toParsed(bare, ownCurrency);
      if (parsed.ok && (ownCurrency || amountShape(bare))) {
        return {
          ...base,
          role: "amount",
          amount: parsed.amount,
          currency: parsed.currency,
        };
      }
      // `toParsed` requires the WHOLE token to be a number, which two common
      // cases violate:
      //   - a fused currency symbol ("$5,000.00")
      //   - trailing OCR noise ("1,212.52⑦" — a chevron glyph read as a digit)
      // `matchAmount` extracts the well-formed figure from inside the token
      // instead, the same way row-level classification reads
      // "360 Account $5,000.00". The amount-shape guard still applies, so a
      // bare integer with a stray glyph can't become a balance.
      const extracted = matchAmount(text);
      if (extracted.ok && (ownCurrency || amountShape(bare))) {
        return {
          ...base,
          role: "amount",
          amount: extracted.amount,
          currency: extracted.currency ?? ownCurrency,
        };
      }
    }

    // 8. Summary-row marker ("Total", "总资产").
    if (hasSummaryMarker(text.toLowerCase())) {
      return { ...base, role: "summaryMarker" };
    }

    // 9. Field label ("Available", "Balance", "余额", "信用额度").
    if (isLabelToken(text)) {
      return { ...base, role: "label" };
    }

    // 10. Account-name keyword ("Account", "Savings", "Global", ...). A token
    //    like "360" that is NOT an amount and NOT a label stays `unknown` —
    //    digits alone must never open an account region on their own. It is
    //    still part of the name: the grouping step builds a name from
    //    `accountName` AND `unknown` tokens, so "360" + "Account" recognizes as
    //    "360 Account". `unknown` means "inert on its own", not "discarded".
    if (DEFAULT_ACCOUNT_KEYWORD_RE.test(text)) {
      return { ...base, role: "accountName" };
    }

    // A bare English word token (not a keyword, not noise) is a name candidate —
    // institution product names like "Multiplier", "Everyday", "360" aren't in the
    // keyword list but are real name words. Keeping it as `accountName` lets the
    // grouping step collect it; the account-keyword test in `groupIntoAccounts`
    // still gates whether a region actually opens.
    //
    // CJK-only tokens do NOT fall through to accountName here: on Chinese
    // institution UIs the account name is almost always an English product name ("360
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

// A token carrying a letter or a digit — a field the row states, as opposed to
// the bullets, chevrons and icon fragments OCR reads off the surrounding
// chrome. Used to tell a sign that opens a row from a separator between two
// fields.
const FIELD_CONTENT_RE = /[\p{L}\p{N}]/u;

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
      (prev.role === "amount" ||
        isAmountFragment(prev.text) ||
        // A join this loop already made and left incomplete ("1," + "234,").
        isPartialAmount(prev.text)) &&
      isAmountFragment(token.text) &&
      !WHOLE_AMOUNT_RE.test(prev.text) // only merge if the prev wasn't already whole
    ) {
      const joined = prev.text + token.text;
      // `toParsed` reads a bare figure; `matchAmount` reads one with the
      // currency fused onto it ("S$5,000.00"), which is exactly what a leading
      // fragment carries.
      const parsed = toParsed(joined, prev.currency ?? token.currency);
      const merged = parsed.ok ? parsed : matchAmount(joined);
      if (!merged.ok && isPartialAmount(joined)) {
        // Still incomplete — keep the pieces together and let the next token
        // finish the figure.
        out[out.length - 1] = {
          ...prev,
          text: joined,
          box: unionBox(prev.box, token.box),
        };
        continue;
      }
      if (merged.ok) {
        const parsedResult = merged;
        out[out.length - 1] = {
          ...prev,
          // The join is what makes it an amount, so the merged token says so
          // rather than inheriting the fragment's role. A fragment is not a
          // figure on its own — "6," parses to nothing now that a separator has
          // to separate thousands — and the merge was handing its `unknown`
          // role to a perfectly good 6,672.59.
          role: "amount",
          text: joined,
          amount: parsedResult.amount,
          currency: parsedResult.currency ?? prev.currency ?? token.currency,
          box: unionBox(prev.box, token.box),
        };
        foldLeadingSign(out);
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
    foldLeadingSign(out);
  }
  return out;
}

// Folds a lone "+"/"-" token into the amount that follows it, once that amount
// is the last thing in `out`.
//
// Applied AFTER whatever produced the amount — a plain push, or the fragment
// merge above — because OCR does both at once: ML Kit emits the sign as its own
// block AND splits the figure three ways, so "-" + "1," + "745.52" left the
// merge holding a positive 1,745.52 and the sign stranded beside it. A card's
// debt then read as an asset, which is the one error the negative-balance path
// exists to prevent.
//
// "+" always merges: an explicitly signed gain is never a balance, and the rule
// that drops it lives downstream ("SGD 5,203.47 + 12.88").
//
// "-" merges only when NO FIELD precedes it on the row. Behind a field it is as
// often a separator between two of them ("Everyday Global - 1,234.56"), and
// reading that as a sign turns an asset into a debt. Chrome does not count as a
// field — a bullet OCR'd at the start of the row ("· - 1,234.56"), nor the
// row's own CURRENCY: "S$" carries a letter, so testing text alone made the
// same layout a debt in USD ("$ - 1,234.56") and an asset in SGD.
function foldLeadingSign(out: TokenWithRole[]): void {
  const amount = out[out.length - 1];
  if (!amount || amount.role !== "amount" || amount.amount === undefined) {
    return;
  }
  // The sign is the last thing before the figure that isn't the figure's own
  // CURRENCY: "-S$1,234.56" splits either way round, as "-S$" + figure or as
  // "-" + "S$" + figure, and looking only at the token immediately before left
  // the second form's minus stranded — a card's debt stored as an asset.
  let signIndex = out.length - 2;
  // A minus GLUED to the currency symbol is unambiguous, unlike a lone one:
  // "-S$" + "1,234.56" is a debt, and nothing else is written that way. It is
  // folded here rather than in its own branch, because that branch required the
  // figure to ALREADY be an amount — so the moment OCR also split the figure
  // ("-S$" + "1," + "745.52") the sign was dropped and the debt became an
  // asset, while the "-" + "S$" + … spelling of the same screen read correctly.
  let gluedMinus = false;
  while (signIndex >= 0 && out[signIndex].role === "currency") {
    gluedMinus ||= out[signIndex].text.trim().startsWith("-");
    signIndex -= 1;
  }
  const sign = out[signIndex];
  const text = sign?.text.trim() ?? "";
  if (text !== "+" && text !== "-") {
    if (gluedMinus && !amount.text.trim().startsWith("-")) {
      out[out.length - 1] = {
        ...amount,
        text: `-${amount.text}`,
        amount: -Math.abs(amount.amount),
      };
    }
    return;
  }
  // A LABEL is not a field for this rule — it is the label OF the figure, and
  // a card's balance is printed under one ("可用余额 -S$1,745.52", "Available
  // Balance − …"). Counting it meant the sign was dropped on exactly the rows
  // a debt appears on, unless the issuer also printed a debt phrase.
  const precededByAField = out
    .slice(0, signIndex)
    .some(
      (earlier) =>
        earlier.role !== "currency" &&
        earlier.role !== "label" &&
        FIELD_CONTENT_RE.test(earlier.text),
    );
  if (text === "-" && precededByAField) {
    return;
  }
  // The sign token is removed and the figure keeps its place, so a currency
  // token between them stays where the row printed it.
  out.splice(signIndex, 1);
  out[out.length - 1] = {
    ...amount,
    text: `${text}${amount.text}`,
    amount: text === "-" ? -Math.abs(amount.amount) : amount.amount,
    box: unionBox(sign.box, amount.box),
  };
}

// Whether a token looks like a fragment of a larger amount — a digit run with
// a trailing comma ("6,"), a leading decimal ("672.59"), or a bare digit group
// ("672"). Used by `mergeAdjacentTokens` to spot splits ML Kit introduced.
//
// A LEADING fragment may carry the row's currency symbol or the figure's sign
// fused onto it, because that is how the screen printed it: OCR splits
// "S$5,000.00" as "S$5," + "000.00" and "-1,234.56" as "-1," + "234.56". Tested
// on the digits alone, those never merged — and the trailing half then read as
// a standalone amount, so S$5,000.00 was recognized as SGD 0.00 and a card's
// -1,234.56 as +234.56.
function isAmountFragment(text: string): boolean {
  const body = fragmentBody(text);
  return (
    body !== undefined &&
    (/^\d{1,3}(?:,$|,\d{3}$|\.\d+$|\d{3}$)/.test(body) || /^\d+$/.test(body))
  );
}

// The digits of a fragment, minus a leading sign and/or currency token.
// Undefined when what precedes the digits is neither.
function fragmentBody(text: string): string | undefined {
  const firstDigit = text.search(/\d/);
  if (firstDigit === -1) {
    return undefined;
  }
  const body = text.slice(firstDigit);
  const prefix = text.slice(0, firstDigit).replace(/^[-+]/, "");
  return prefix === "" || standaloneCurrency(prefix) !== undefined
    ? body
    : undefined;
}

// A join that is still INCOMPLETE — a digit run ending on a separator, so the
// figure continues in the next token. ML Kit splits a millions-scale figure
// three ways ("1," + "234," + "567.89"), and a merge that gave up when the
// two-piece join failed to parse left the leading group behind: 1,234,567.89
// was recognized as 234,567.89, a 1000x understatement with no signal.
function isPartialAmount(text: string): boolean {
  const body = fragmentBody(text);
  return body !== undefined && /^\d[\d,' ]*[,']$/.test(body);
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
