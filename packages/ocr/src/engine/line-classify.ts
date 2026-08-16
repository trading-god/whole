// Row classification: assigns each clustered visual line a role so the grouping
// step knows which rows are account names, which are balance amounts, which are
// summary rows (never accounts), and which are noise (nav, footer, TLDs). The
// keyword lists are tuned against the eval corpus; row role just needs to get
// the *first-order* semantics right, since the grouping step disambiguates
// further.
import { boundedPatternSource } from "../text";
import { isMaskedCard, matchAmount, stripDateFragments } from "./amount";
import {
  DEFAULT_ACCOUNT_KEYWORD_RE,
  accountNumberPatterns,
  contactMarkers,
  defaultNoiseTokens,
  hasLabelMarker,
  includesAny,
  rowTitlesAnAccount,
  summaryMarkers,
} from "./vocabulary";

export type RowRole =
  "accountName" | "cardNumber" | "amountRow" | "summaryRow" | "noise";

// Card-number morphology: a card number has 12–19 digits; an amount can't have
// more than 10. Named so tone corpus tuning edits the constants here rather
// than bare literals inside the classifier.
const MIN_CARD_DIGITS = 12;
const MAX_CARD_DIGITS = 19;
const MAX_AMOUNT_DIGITS = 10;

// Whether `text` is a hyphen-joined account number (a thin digit run
// broken by `-`, without currency/amount formatting). Checks against the
// configured regional account-number patterns (see `institutions/config.ts`);
// adding a new format is a config change, not a code change here.
export function isAccountNumber(text: string): boolean {
  return accountNumberPatterns.some((re) => re.test(text));
}

// Whether `text` (lowercased) contains a summary marker ("Total", "总资产") —
// a row that aggregates the whole account and must never be treated as an
// account. Shared with the token classifier so "what is a summary row" is
// defined once.
export function hasSummaryMarker(text: string): boolean {
  return includesAny(text, summaryMarkers);
}

// Currency-name labels an institution overview prints for a sub-account row
// ("Chinese Yuan", "United States Dollar", "Singapore Dollar"). These are
// NOT account names — they label the currency of a row inside an already-open
// account card, so the grouping step must absorb them into the open group
// (as amount rows) rather than opening a new account. A real account name
// ("360 Account", "Statement Savings Account") never reduces to a bare
// currency name.
//
// Matched with word boundaries, not as substrings: "euro" sits inside "Europe"
// and "won" inside "Wonder", so a "Europe Growth" row was classified as an
// amount row and absorbed into the account above it instead of opening its own.
const CURRENCY_NAME_MARKERS = [
  // RFC-style: ASCII words only, matched case-insensitively.
  "yuan",
  "dollar",
  "pound",
  "euro",
  "riyal",
  "yen",
  "ringgit",
  "baht",
  "won",
  "rupiah",
  "dinar",
];

// Whether `text` (lowercased) is a currency-name label — "Chinese Yuan" /
// "United States Dollar" style rows that name a currency without themselves
// being an account. Classified as an amount row so the open group absorbs
// them (see classifyRow).
// Bounded through `boundedPatternSource` rather than by wrapping the whole
// alternation in `\b`, so the "ASCII words only" note above stops being a rule
// the next marker has to remember: a CJK or punctuated one bounds itself.
const CURRENCY_NAME_RE = new RegExp(
  `(?:${CURRENCY_NAME_MARKERS.map(boundedPatternSource).join("|")})`,
);

export function isCurrencyNameLabel(text: string): boolean {
  return CURRENCY_NAME_RE.test(text);
}

// Morphological noise: OCR gibberish from a phone's status bar or app icons,
// which is not an account name and carries no semantic account content.
// Account names are real words; these are fragments that never form one:
// - A Cyrillic run ("ЛКР EITE") — OCR misreading of a non-Latin label; a
//   Cyrillic string is never an account name, so it's noise regardless of
//   any ASCII letters alongside it.
// - An isolated non-ASCII symbol fragment ("iR₩", "it₺l") — the ₩/₺ marks an
//   icon/capsule, not a currency amount. Only those two: they are what the
//   corpus actually shows OCR reading off a capsule. `¥` is the CNY symbol this
//   app recognizes, so "¥ 1,234.56" must reach the amount path; and `€`/`£`
//   were dropped from this list because a balance printed with an unstorable
//   SYMBOL was being deleted as noise together with its account, while the same
//   balance printed as the ISO code "EUR" kept the account (see
//   `sawUnstorableBalance`). The two halves of one rule disagreed. The
//   protection against real account names is `DEFAULT_ACCOUNT_KEYWORD_RE`.
// - A status-bar time+signal fragment ("22:28 A 5G E") — a leading time
//   paired with single-letter tokens is status-bar noise.
export const CYRILLIC_RE = /[А-Яа-яЁё]/;
export const NON_ASCII_SYMBOL_RE = /[₩₺]/;
export const TIME_FRAGMENT_RE = /^\d{1,2}:\d{2}/;

// A row that states its own last four ("尾号7732", "ending in 1234"). Shared
// with the grouping step, which reads the captured digits straight off it —
// when the screen has already done the work, that beats any digit-run guess.
//
// The English arm needs the full "ending IN". A bare "ending" plus any four
// digits is ordinary prose — "ending 2024 Growth Fund" gave a promo year as the
// account's last four, which then feeds account dedupe. The trailing guard
// rejects a decimal point too, so "Ending 1234.56" is a figure, not a card.
// The CJK arm (尾号/末四位) is unambiguous and needs neither.
// The English arm is word-bounded, the CJK arm is not — the same split the rest
// of the engine makes, and here it is load-bearing: unanchored, "ending" matched
// inside "Pending 1234" and "Spending 2024", routing an ordinary row down the
// card path and donating a bogus last four to the open account. A wrong last
// four is worse than none; it feeds account dedupe and matching.
export const LAST_FOUR_LABEL_RE =
  /(?:尾号|尾號|末四位|后四位|後四位|\b(?:ending\s+in|last\s*(?:four|4)(?:\s*digits)?))\s*[:：]?\s*(\d{4})(?![\d.])/i;

// Shortest digit run that can plausibly be an account or card number. Below
// this a run is a count, a date, or part of a product name — taking its tail
// would invent a last four. Shared with the grouping step's per-token
// `accountDigits`, so raising the bar here raises it for both the row
// classifier and the last-four extractor instead of only one of them.
export const MIN_ACCOUNT_DIGITS = 8;

// A standalone run of 8+ digits (hyphen grouping allowed) occupying a whole
// token: an account number printed without a mask, like "0193855038" or
// "012049644240".
//
// This cannot catch a balance, and the reason is the anchors: the run must span
// an entire whitespace-delimited token, while money always carries a `,` or a
// `.` that breaks the character class. "0.00021312" (a crypto quantity) yields
// runs of 1 and 8 digits but neither spans the token, so it stays on the amount
// path.
// Global: a row can carry several such runs, and only one of them needs to be
// an account number. Tested once, a leading run that the exclusion list rejects
// ("结息期间 2025-2026 622848000123456", "客服 400-820-8888 0193855038") ended
// the search and the real number beside it was never seen — the account lost
// its last four.
const STANDALONE_ACCOUNT_NUMBER_RE = new RegExp(
  `(?:^|\\s)([\\d-]{${MIN_ACCOUNT_DIGITS},})(?=\\s|$)`,
  "g",
);

// Digit runs that are the account-number SHAPE but not an account number.
//
// The shape is generous by design — an account number is any 8+ run of digits
// and hyphens — so a screen's other hyphen-grouped numbers fall into it, and a
// row that reaches the card path donates its tail four to the open account. A
// wrong last four is worse than none: it feeds account dedupe and matching.
//
// - A year range or pair ("结息期间 2025-2026", "有效期 2025-2030"): two 19xx/
//   20xx groups and nothing else. A real account number does not read as two
//   years.
// - A phone number: exactly the local groupings screens print for one
//   ("9123-4567", "400-820-8888", an 11-digit mainland mobile). Account numbers
//   in the corpus carry more groups or more digits.
export const NOT_AN_ACCOUNT_NUMBER = [
  /^(?:19|20)\d{2}-(?:19|20)\d{2}$/,
  // A compact date, which `stripDateFragments` doesn't touch because it carries
  // no separator: Chinese account-detail rows print 交易日期/记账日期/开户日期
  // as "20250815", and that read as an 8-digit account number ending "0815".
  /^(?:19|20)\d{6}$/,
  /^\d{4}-\d{4}$/,
  /^400-\d{3}-\d{4}$/,
  /^1[3-9]\d{9}$/,
];

// Whether the row carries an unmasked account number as its own token.
function hasStandaloneAccountNumber(text: string): boolean {
  // `matchAll` rather than `exec`, so the global flag's `lastIndex` cannot leak
  // between calls.
  for (const [, run] of text.matchAll(STANDALONE_ACCOUNT_NUMBER_RE)) {
    if (
      run.replace(/-/g, "").length >= MIN_ACCOUNT_DIGITS &&
      !NOT_AN_ACCOUNT_NUMBER.some((re) => re.test(run))
    ) {
      return true;
    }
  }
  return false;
}

// Whether the row is morphological noise: it either contains a Cyrillic run,
// or it carries a non-ASCII currency symbol / status-bar time prefix AND has
// no real account word. Kept separate from the nav-token check so the two
// styles of noise stay readable.
function isMorphologicalNoise(text: string): boolean {
  if (CYRILLIC_RE.test(text)) {
    return true;
  }
  if (DEFAULT_ACCOUNT_KEYWORD_RE.test(text)) {
    return false;
  }
  return NON_ASCII_SYMBOL_RE.test(text) || TIME_FRAGMENT_RE.test(text);
}

// Classifies a single line's text. Pure; expects the whitespace-joined text of
// a clustered line.
export function classifyRow(text: string): RowRole {
  const lower = text.toLowerCase();

  // Summary rows first — "Total" alone must never look like an account name.
  //
  // Deliberately WITHOUT the account-keyword escape the label branch below
  // uses. It was tried: the keyword list is made of generic product nouns
  // ("portfolio", "fund", "card", "account", "balance"), so "Total Portfolio",
  // "Total Funds" and "Total Card Balance" — ordinary summary headings — all
  // read as titles, opened a phantom account, and banked the screen's GRAND
  // TOTAL as its balance beside the accounts that make it up. Net worth counted
  // the same money twice.
  //
  // The error this trades against is smaller: a product genuinely titled
  // "Total …" loses its name, and its figure still reaches the user through the
  // summary fallback. Inventing money is worse than losing a title.
  if (hasSummaryMarker(lower)) {
    return "summaryRow";
  }

  // Noise: an English standalone nav label, any Chinese nav token, or
  // morphological status-bar/icon gibberish. Trimmed off `lower` (already
  // lowercased once) so we don't lowercase the row twice.
  const noiseNormalized = lower.trim().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
  // A nav token counts only when it IS the row. `noiseNormalized` strips
  // leading/trailing non-alphanumerics, which erases CJK entirely, so the
  // Chinese comparison uses the trimmed row. See `defaultNoiseTokens` for why
  // substring matching was abandoned.
  if (
    defaultNoiseTokens.en.includes(noiseNormalized) ||
    defaultNoiseTokens.zh.includes(text.trim()) ||
    includesAny(lower, contactMarkers) ||
    isMorphologicalNoise(text)
  ) {
    return "noise";
  }

  const digitCount = (text.match(/\d/g) ?? []).length;
  // The longest single run of digits, which is what the amount ceiling is
  // about: no individual money figure has more than ten digits. Counting every
  // digit on the ROW instead conflated "one huge number" with "several ordinary
  // numbers" — IBKR's "63,714 -327 -0.51%" totals eleven digits across three
  // small figures, so the row was disqualified as an amount and its balance was
  // never read. The card checks below still use the row-wide count, because a
  // card number IS one long run.
  const longestDigitRun = Math.max(
    0,
    ...(text.match(/\d+/g) ?? []).map((run) => run.length),
  );

  // A masked card ("**** 1234", "•••• •••• ••••") is always a card-number row:
  // its digits are fewer than the full-card threshold but its last four should
  // still be extracted, and carrying a currency symbol ("$**** 1234") would
  // otherwise look like an amount.
  if (isMaskedCard(text)) {
    return "cardNumber";
  }

  // An account number (hyphen-joined digit run like "275-023637-2"): its
  // own row right under an account name, absorbed into the open account. It
  // must not read as an amount (no currency/comma) or as a spurious account
  // name. Tested before the amount logic so a hyphen-joined number is never
  // treated as money.
  if (isAccountNumber(text)) {
    return "cardNumber";
  }

  // A row that names its own last four ("尾号7732 龙卡通") or prints an unmasked
  // account number as a standalone token ("户口号码 - 0193855038"). Both carry
  // the account's identifying digits without being card-shaped, so without this
  // they fell through to `accountName` — which both lost the last four AND
  // opened a spurious account region for what is really an attribute of the
  // account above. Tested before the amount path, which is safe because neither
  // pattern can match a money figure (see `hasStandaloneAccountNumber`).
  const dateless = stripDateFragments(text);
  if (
    LAST_FOUR_LABEL_RE.test(dateless) ||
    hasStandaloneAccountNumber(dateless)
  ) {
    return "cardNumber";
  }

  // A currency amount: the shared `matchAmount` is the single source of "is
  // this a well-formed amount" — the same matcher the grouping step's
  // `attachAmountFromTokens` uses, so the classifier and the parser can't drift.
  // `matchAmount` deliberately requires a currency, thousands grouping, or a
  // 2-decimal shape (a bare "200" is NOT an amount — too easily confused with a
  // number in an account name), and its digit handling keeps a credit-card full
  // number from reading as money. A digit-less row can't be an amount, so the
  // guard skips the matcher entirely for those (the common account-name row).
  const isAmount =
    digitCount > 0 &&
    longestDigitRun <= MAX_AMOUNT_DIGITS &&
    matchAmount(text).ok;

  if (isAmount) {
    return "amountRow";
  }

  // Card check: a full-card-number row (12-19 digits in 4+ char runs) is a
  // cardNumber row. Amounts are tested first, so any figure the amount path
  // accepted is already gone by here.
  //
  // Note the amount path is gated on `longestDigitRun <= MAX_AMOUNT_DIGITS`
  // (10), so a figure with a longer unbroken run can't reach it even when
  // `matchAmount` parses it — "123456789012.34" therefore lands HERE and reads
  // as a card, and its tail four becomes the account's last four. That only
  // happens above ~10 billion, so no real account hits it; see the "beyond the
  // 10-digit amount ceiling" cases in line-classify.test.ts, which pin the
  // behavior. (The run, not the row's total digit count: a grouped
  // "1,234,567,890.12" has runs of 3 and passes.)
  const fullCard =
    digitCount >= MIN_CARD_DIGITS &&
    digitCount <= MAX_CARD_DIGITS &&
    /[\d·•*]{4,}/.test(text.replace(/\s/g, ""));
  if (fullCard) {
    return "cardNumber";
  }

  // Label rows without a number ("Available Balance" alone) are still labels,
  // not account names — the grouping step must not open an account for them.
  //
  // Guarded against a real title that contains a label word, the same way the
  // currency-name branch below is: "Zero Balance Account" and "Cash Balance
  // Account" are products, and classifying them as label rows meant they never
  // opened a region — the account was deleted and its balance added to the one
  // above it. `nameTokensOf` already knows these names; the row classifier was
  // discarding the row before it got there.
  // Tested on the row MINUS its label words, because "balance" is itself an
  // account keyword: unstripped, "Available Balance" claimed to be a real title.
  if (hasLabelMarker(lower) && !rowTitlesAnAccount(lower)) {
    return "amountRow";
  }
  // A currency-name label ("Chinese Yuan", "United States Dollar") names a
  // sub-account's currency without being an account; classify it as an amount
  // row so grouping absorbs it into the open account instead of opening a new
  // one. Guarded against real account names that happen to contain a currency
  // word — "Dollar Savings Account", "US Dollar Account" — which contain an
  // account keyword and must fall through to `accountName`, not be absorbed.
  if (isCurrencyNameLabel(lower) && !DEFAULT_ACCOUNT_KEYWORD_RE.test(text)) {
    return "amountRow";
  }
  return "accountName";
}
