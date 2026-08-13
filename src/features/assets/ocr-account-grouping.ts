// Account grouping: assembles the classified, clustered lines into tentative
// accounts. The key insight is a bank overview lists each account as a small
// region: an account-name row, an optional card/masked-number row, and
// label/amount pairs. We walk the lines top→bottom, opening an account group
// when we see an account-name line (or a card-number row that isn't the
// continuation of a name group), and attaching label/amount pairs to the open
// group via vertical adjacency.
//
// Amounts are summed per currency and the last four extracted during grouping
// itself. This module is pure and operable on recorded OCR output, so it
// composes with the eval harness.
import { type Currency } from "./currencies";
import { isCardLike, matchAmount, stripDateFragments } from "./ocr-amount";
import {
  buildAccountKeywordRegex,
  DEFAULT_CONFIG,
  type BankConfig,
} from "./ocr-bank-config";
import { hasLabelMarker } from "./ocr-line-classify";
import type { RowRole } from "./ocr-line-classify";
import type { TokenWithRole } from "./ocr-token-classify";

// A multi-currency table (a bank shows a "SGD HKD USD" header row aligned
// over "100,554.59 0.00 0.00" value row). Column-aligned parsing needs the
// token x positions, so it lives here (grouping) not in classifyRow: a single
// row classification can't see the two-row column alignment.
const COLUMN_ALIGN_TOLERANCE = 0.08;

// Center-x of a token's normalized box (0..1), used for column alignment.
function centerX(box: TokenWithRole["box"]): number {
  return box.x + box.width / 2;
}

// Whether a row's tokens are all currency tokens (≥2) — i.e. this row is a
// multi-currency header like "SGD HKD USD". Consumes the token-level roles
// (`role === "currency"`) instead of re-parsing each token against
// `currencySchema`, so a header row is recognized by its tokens' roles, not by
// re-deriving a parallel lookup.
function isCurrencyHeaderRow(line: ClassifiedLine): boolean {
  const toks = line.tokens;
  if (toks.length < 2) {
    return false;
  }
  return toks.every((t) => t.role === "currency");
}

// Pairs a currency-header row's codes with the value amount in the same
// column of a following row, returning per-currency balances. Returns null
// when the value row doesn't align (same token count, x within tolerance).
function parseMultiCurrencyRow(
  header: ClassifiedLine,
  value: ClassifiedLine,
): { currency: Currency; amount: number }[] | null {
  const headerToks = header.tokens;
  const valueToks = value.tokens;
  if (headerToks.length !== valueToks.length || headerToks.length === 0) {
    return null;
  }
  const out: { currency: Currency; amount: number }[] = [];
  for (let i = 0; i < headerToks.length; i++) {
    const headerTok = headerToks[i];
    if (headerTok.role !== "currency" || !headerTok.currency) {
      return null;
    }
    if (
      Math.abs(centerX(headerTok.box) - centerX(valueToks[i].box)) >
      COLUMN_ALIGN_TOLERANCE
    ) {
      return null;
    }
    // Value token should be an amount; use its pre-parsed amount if available,
    // else re-parse (covers a value row whose tokens weren't labeled amount). A
    // value that doesn't parse as a well-formed amount makes the whole column
    // alignment invalid — skip the row rather than recording a 0 balance.
    const valueTok = valueToks[i];
    let amount =
      valueTok.role === "amount" && valueTok.amount !== undefined
        ? valueTok.amount
        : undefined;
    if (amount === undefined) {
      const parsed = matchAmount(valueTok.text);
      if (!parsed.ok) {
        return null;
      }
      amount = parsed.amount;
    }
    out.push({ currency: headerTok.currency, amount });
  }
  return out;
}

export type OcrAccountGroup = {
  name: string;
  lastFour: string | undefined;
  balances: { currency: Currency; amount: number }[];
  // Raw rows that fed this group; joined for detectKind's kind classification.
  sourceText: string[];
  // 1-based indexes of the source `ClassifiedLine`s that fed this group.
  // Populated for the eval harness's trace; production code ignores it.
  lineNumbers: number[];
};

type ClassifiedLine = {
  text: string;
  role: RowRole;
  // Per-token roles for this line (from `classifyTokens`). The grouping step
  // consumes these directly — filtering by role to assemble account name,
  // balance, and card number — instead of re-splitting the joined text.
  // Required: the parser always produces token roles; the eval harness goes
  // through the same parser entry point.
  tokens: TokenWithRole[];
};

// A balance row whose currency may not have been stated yet — resolved against
// the group's established currency in `finish`, so a leading
// "Available Balance 1,000.00" (no currency marker) isn't dropped just because
// no currency has appeared by the time the row is read.
type PendingBalance = { currency: Currency | undefined; amount: number };

// Opened-group state while scanning lines. Amount rows are queued as pending
// balances and resolved to a currency in `finish` once the group's currency is
// established (see PendingBalance). `establishedCurrencies` tracks which
// currencies the account actually holds (set as amount rows attach), so a
// trailing amount row whose currency is NOT held (e.g. an "equivalent in SGD"
// total on a CNY/USD card) can be recognized as a converted display, not a
// real balance.
type OpenGroup = {
  name: string;
  lastFour: string | undefined;
  pending: PendingBalance[];
  sourceText: string[];
  sourceLineNumbers: number[];
  establishedCurrencies: Set<Currency>;
};

// Extracts a last-four from card-number text: keep only digits and take the
// tail 4. Date-like fragments ("08/26", "12/05/2024") are removed first so a
// trailing (or leading) expiry doesn't blend into the card's last four
// ("**** 1234 08/26" → "1234", not "0826"). Returns undefined when fewer than
// 4 digits remain.
function lastFourFromCardText(text: string): string | undefined {
  const cardPart = stripDateFragments(text);
  // Only the digit run adjacent to the mask chars is the card's last four —
  // a balance sharing the line ("**** 1234 $5,000.00") would otherwise
  // contaminate it with the amount's digits.
  const match = cardPart.match(/[·•*]+\s*(\d+)/);
  if (!match) {
    return undefined;
  }
  const digits = match[1];
  return digits.length >= 4 ? digits.slice(-4) : undefined;
}

// Whether a row is a converted/aggregate total display — "Available in 3
// currencies ( SGD 100,554.59" (a multi-currency account's whole balance
// restated in the base currency) or "Equivalent in SGD 2,009.85" (a
// foreign-currency card's converted total). These aggregate the whole account
// into one display number: the amount is a summary, not a per-currency
// holding, so it must not be added to balances (it would double-count the
// same holding a currency table or per-currency rows already report). It also
// does NOT end the account region — it's an attached display inside the open
// account, unlike a real summary block ("Total") which discards following
// rows. The "currencies" arm is anchored to "in <digits> currencies" so a
// real balance row like "Currencies Held: SGD 1,234.56" is NOT swallowed.
//
// The pattern is bank-specific (OCBC's multi-currency UI); `bankConfig` carries
// it. When undefined, equivalent-total detection is skipped (no bank-specific
// aggregate display to suppress).

// Whether the row is a converted/aggregate total written in a currency the
// account does NOT hold: on a CNY/USD card, a trailing "2,009.85 SGD" is the
// total restated in SGD (each holding converted), not a real SGD balance.
// Only kicks in once the account has established ≥1 held currency, only for a
// currency outside that set, and never for a sub-account row that carries the
// chevron ">" (a real per-currency row is tappable — "0.00 USD >" is a current
// USD sub-account, not a conversion). A single-currency account's own balance
// (360's only "6,672.59 SGD") is never affected. `text` is the already-trimmed
// row text (hoisted by the caller so it isn't re-trimmed per amount token).
function isConvertedTotalAmount(
  group: Pick<OpenGroup, "establishedCurrencies">,
  amountToken: TokenWithRole,
  text: string,
  lineCurrency: Currency | undefined,
): boolean {
  const currency = amountToken.currency ?? lineCurrency;
  return (
    group.establishedCurrencies.size > 0 &&
    currency !== undefined &&
    !group.establishedCurrencies.has(currency) &&
    // A zero balance is a real (empty) holding, never a converted total —
    // an equivalent amount is the sum of converted holdings, which can't be 0.
    amountToken.amount !== 0 &&
    // A tappable sub-account row is a holding, not a conversion total.
    !/>\s*$/.test(text)
  );
}

// Records a source row against the open group: its text (for detectKind) and
// its 1-based line index (for the eval trace). Centralized so every case that
// attaches a row stays in lockstep, instead of repeating the pair of pushes.
function attachSource(
  open: OpenGroup | null,
  line: ClassifiedLine,
  lineIndex: number,
): void {
  open?.sourceText.push(line.text);
  open?.sourceLineNumbers.push(lineIndex + 1);
}

// Whether a line looks like a real account name — contains an account word
// ("Account"/"Savings"/"Card"/"Global" for OCBC, "Multiplier" for DBS, …).
// `keywordRegex` is built from the shared defaults plus the detected bank's
// product keywords (see `buildAccountKeywordRegex`).
export function groupIntoAccounts(
  lines: ClassifiedLine[],
  bankConfig: BankConfig = DEFAULT_CONFIG,
): OcrAccountGroup[] {
  // Bank-specific rules resolved once per parse: the keyword regex (shared
  // defaults + this bank's product keywords) and the equivalent-total pattern
  // (OCBC's multi-currency aggregate display; undefined for banks without it).
  const keywordRegex = buildAccountKeywordRegex(bankConfig);
  const equivalentTotalRe = bankConfig.equivalentTotalPattern;
  const iconTags = bankConfig.iconTags ?? [];

  const groups: OcrAccountGroup[] = [];
  let open: OpenGroup | null = null;
  // True while skipping rows that belong to a summary (e.g. "Total" followed by
  // its amount on the next line) — those rows must not attach to the previous
  // account. Cleared by the next accountName.
  let discarding = false;
  // A detected multi-currency header row ("SGD HKD USD") awaiting its
  // column-aligned value row on the next line. Null unless one is pending.
  let pendingCurrencyHeader: ClassifiedLine | null = null;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];

    // If the previous line was a currency header, try to consume THIS line as
    // its aligned value row (e.g. "100,554.59 0.00 0.00"). Column-aligned
    // pairing is the multi-currency table read — it wins over treating the
    // value row as a name/amount on its own.
    if (pendingCurrencyHeader) {
      const header = pendingCurrencyHeader;
      pendingCurrencyHeader = null;
      if (open) {
        const parsed = parseMultiCurrencyRow(header, line);
        if (parsed) {
          for (const { currency, amount } of parsed) {
            open.pending.push({ currency, amount });
            // Track held currencies so a trailing converted-total row in a
            // currency the table does NOT hold is recognized as a display
            // (see isConvertedTotalAmount) — same as attachAmount does for
            // single-currency amount rows.
            open.establishedCurrencies.add(currency);
          }
          attachSource(open, line, lineIndex);
          continue;
        }
      }
    }

    // A currency header row ("SGD HKD USD") is not a name — it opens a
    // multi-currency table awaiting its aligned value row. Don't open a new
    // account for it; remember it and let the next line be consumed above.
    if (isCurrencyHeaderRow(line)) {
      pendingCurrencyHeader = line;
      continue;
    }

    switch (line.role) {
      case "accountName": {
        discarding = false;
        // A real account name closes the previous region and opens a new one.
        // Scaffolding that OCR classified as accountName (nav tabs, shortcut
        // labels, greeting text) stays attached to the open region instead of
        // splitting the account apart — that's what keeps "DBS Multiplier
        // Account" from being decoupled from its balance by the "Overview Bank
        // & Earn Manage" nav row above the balance.
        const nameTokens = line.tokens.filter(
          (t) => t.role === "accountName" || t.role === "unknown",
        );
        if (keywordRegex.test(line.text)) {
          if (open && open.name && groupHasContent(open)) {
            groups.push(finish(open));
          }
          open = createGroup(
            cleanAccountName(nameTokens, keywordRegex, iconTags),
          );
          attachSource(open, line, lineIndex);
        } else if (open) {
          // Scaffolding accountName with an open region: keep it as source
          // context so the real account's rows below aren't mis-assigned.
          attachSource(open, line, lineIndex);
        }
        // Scaffolding with NO open region: do nothing. A greeting ("欢迎") or
        // nav tab alone never opens a spurious account — the real account opens
        // when a row with an account keyword ("Account"/"Savings") arrives.
        break;
      }
      case "cardNumber": {
        if (discarding) {
          break;
        }
        // Extract the last-four from the full row text, not just the
        // cardNumber-role tokens: `classifyTokens` labels the mask characters
        // ("••••"/"****") as cardNumber, but the trailing digit block ("1234")
        // comes back `unknown`, so filtering to cardNumber tokens would drop the
        // digits and lose the last four. The row is already classified
        // `cardNumber` by `classifyRow`, and `lastFourFromCardText`'s regex is
        // anchored to the mask chars, so the full text is safe to use here.
        const cardText = line.text;
        if (!cardText || !isCardLike(cardText)) {
          attachSource(open, line, lineIndex);
          break;
        }
        // If a card-number row starts a region (no open name group yet), open
        // one; if it follows a name group, it belongs to that account.
        if (!open) {
          open = createGroup("");
        }
        const lastFour = lastFourFromCardText(cardText);
        if (lastFour && !open.lastFour) {
          open.lastFour = lastFour;
        }
        attachSource(open, line, lineIndex);
        break;
      }
      case "amountRow": {
        if (discarding) {
          break;
        }
        if (!open) {
          open = createGroup("");
        }
        // An equivalent/aggregate total row ("Available in 3 currencies ( SGD
        // 100,554.59", "Equivalent in SGD 2,009.85") is a display summary, not
        // a per-currency holding — don't add it to balances (it would
        // double-count the currency table), but keep it attached to the open
        // account so it never splits the region.
        const trimmedText = line.text.trim();
        const lineCurrency = line.tokens.find(
          (t) => t.role === "currency",
        )?.currency;
        // Snapshot the (now non-null) open group for the `.some` callback
        // below, where TS can't narrow the mutating `let open`.
        const openGroup = open;
        if (
          (equivalentTotalRe?.test(line.text) ?? false) ||
          line.tokens.some(
            (t) =>
              t.role === "amount" &&
              isConvertedTotalAmount(openGroup, t, trimmedText, lineCurrency),
          )
        ) {
          attachSource(open, line, lineIndex);
          break;
        }
        attachAmountFromTokens(
          open,
          line.tokens,
          keywordRegex,
          iconTags,
          lineCurrency,
        );
        attachSource(open, line, lineIndex);
        break;
      }
      case "summaryRow": {
        // A summary row aggregates the whole account, never an account itself.
        // Close the open group so a following summary amount doesn't leak into
        // it, then discard rows until the next accountName.
        if (open && groupHasContent(open)) {
          groups.push(finish(open));
        }
        open = null;
        discarding = true;
        break;
      }
      case "noise": {
        // Never an account; ignore entirely (doesn't end a discard run, since a
        // noise row between a summary and its amount shouldn't re-enable
        // attaching).
        break;
      }
    }
  }

  if (open && groupHasContent(open)) {
    groups.push(finish(open));
  }

  // Drop groups that wound up with no name and no last four and no balance —
  // pure noise that slipped through classification.
  return groups.filter((g) => g.name || g.lastFour || g.balances.length > 0);
}

function createGroup(name: string): OpenGroup {
  return {
    name,
    lastFour: undefined,
    pending: [],
    sourceText: [],
    sourceLineNumbers: [],
    establishedCurrencies: new Set<Currency>(),
  };
}

// Attaches one row's amount tokens to the open group: queue each as a pending
// balance (currency resolved later in `finish`) and record currencies the
// account holds. Consumes the token-level roles directly — amount tokens carry
// their pre-parsed `amount` — so the row's amount is never re-parsed.
//
// Currency pairing: an amount token's `currency` is only set when the currency
// symbol was fused into the token ("$5,000.00"). When currency is a separate
// token on the same line ("6,672.59 SGD"), the amount token has no currency —
// pair it with the line's `currency` token (there is at most one per row in
// bank overviews). A group that is still unnamed after the amount row recovers
// its name from the row's `accountName` tokens (a name+amount row like "360
// Account $5,000.00" has both roles on one line), unless the name prefix is
// just a field label.
function attachAmountFromTokens(
  group: OpenGroup,
  tokens: TokenWithRole[],
  keywordRegex: RegExp,
  iconTags: string[],
  lineCurrency: Currency | undefined,
): void {
  for (const token of tokens) {
    if (token.role !== "amount" || token.amount === undefined) {
      continue;
    }
    const currency = token.currency ?? lineCurrency;
    group.pending.push({ currency, amount: token.amount });
    if (currency) {
      group.establishedCurrencies.add(currency);
    }
  }
  if (!group.name) {
    const nameTokens = tokens.filter(
      (t) => t.role === "accountName" || t.role === "unknown",
    );
    const candidate = cleanAccountName(nameTokens, keywordRegex, iconTags);
    if (candidate && !hasLabelMarker(candidate.toLowerCase())) {
      group.name = candidate;
    }
  }
}

// Whether an open group has accumulated any content worth keeping (a name, a
// card last-four, a queued amount, or any attached row text).
function groupHasContent(group: OpenGroup): boolean {
  return (
    group.name !== "" ||
    group.lastFour !== undefined ||
    group.pending.length > 0 ||
    group.sourceText.length > 0
  );
}

// Cleans a set of account-name tokens into the account's real display name.
// Bank overview rows carry OCR/card-apparatus noise that should not be part of
// the stored name:
// - Trailing navigation chevrons / arrows: skipped (navArrow tokens are never
//   `accountName`, so they're already excluded by the caller's filter).
// - A leading icon tag that duplicates or prefixes the real name: the beige
//   circle icon renders as a word before the name. "360 360 Account" is the
//   icon "360" + the real name "360 Account" (same leading token); "GSA
//   Global Savings Account" is the icon label "GSA" + the real name. When the
//   remaining tokens after the first already form a complete account name
//   (contain an account keyword), the first token is icon noise.
// Conservative: only strips a single leading token when the rest is clearly
// still a full account name — real single-token account names ("Savings",
// "Cash") are never split.
//
// `iconTags` and `keywordRegex` are bank-specific: the icon tags are the
// detected bank's (e.g. OCBC's "360"/"GSA"/"STS"), and the keyword regex is
// the shared defaults plus the bank's product keywords. Both come from the
// `BankConfig` passed to `groupIntoAccounts`.
export function cleanAccountName(
  nameTokens: TokenWithRole[],
  keywordRegex: RegExp,
  iconTags: string[],
): string {
  const texts = nameTokens.map((t) => t.text);
  if (texts.length === 0) {
    return "";
  }
  // Icon-tag strip: drop the first token when it's clearly icon apparatus, NOT
  // the account's own identifying name:
  // - The first token is one of the bank's icon tags ("360"/"GSA"/"STS") AND
  //   the rest already forms a full account name (has a keyword).
  // - OR the first token repeats the next token exactly ("360 360 Account").
  // A single-token rest is NOT stripped, so "360" is kept as the identifier —
  // otherwise every "<X> Account" name would lose its distinguishing X.
  if (texts.length > 1) {
    const first = texts[0];
    const rest = texts.slice(1);
    const firstIsIconTag = iconTags.some(
      (tag) => first.toLowerCase() === tag.toLowerCase(),
    );
    const restHasKeyword = rest.some((t) => keywordRegex.test(t));
    // `rest.length > 1` keeps a 2-token name like ["360", "Account"] intact:
    // a single-token rest is the account's own identifier (the "360" of "360
    // Account"), not an icon-prefix+duplicate. Only strip when the rest is a
    // full multi-token name ("360 360 Account" → icon + name; "GSA Global
    // Savings Account" → icon + name).
    const firstRepeatsRest = first.toLowerCase() === rest[0].toLowerCase();
    if (
      (firstIsIconTag && restHasKeyword && rest.length > 1) ||
      firstRepeatsRest
    ) {
      return rest.join(" ").trim();
    }
  }
  return texts.join(" ").trim();
}

function finish(group: OpenGroup): OcrAccountGroup {
  // Resolve currency-less amounts to the group's first explicitly-stated
  // currency, so a leading currency-less balance folds into the currency a
  // later row establishes instead of being silently dropped.
  const establishedCurrency = group.pending.find((p) => p.currency)?.currency;
  const balances = new Map<Currency, number>();
  for (const { currency, amount } of group.pending) {
    const resolved = currency ?? establishedCurrency;
    if (resolved) {
      balances.set(resolved, (balances.get(resolved) ?? 0) + amount);
    }
  }
  return {
    name: group.name.trim(),
    lastFour: group.lastFour,
    balances: [...balances.entries()].map(([currency, amount]) => ({
      currency,
      amount,
    })),
    sourceText: group.sourceText,
    lineNumbers: group.sourceLineNumbers,
  };
}
