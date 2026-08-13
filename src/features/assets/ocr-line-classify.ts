// Row classification: assigns each clustered visual line a role so the grouping
// step knows which rows are account names, which are balance amounts, which are
// summary rows (never accounts), and which are noise (nav, footer, TLDs). The
// keyword lists are tuned against the eval corpus; row role just needs to get
// the *first-order* semantics right, since the grouping step disambiguates
// further.
import { isMaskedCard, matchAmount } from "./ocr-amount";
import {
  DEFAULT_ACCOUNT_KEYWORD_RE,
  accountNumberPatterns,
  defaultNoiseTokens,
  labelMarkers,
  summaryMarkers,
} from "./ocr-bank-config";

export type RowRole =
  "accountName" | "cardNumber" | "amountRow" | "summaryRow" | "noise";

// Card-number morphology: a card number has 12–19 digits; an amount can't have
// more than 10. Named so tone corpus tuning edits the constants here rather
// than bare literals inside the classifier.
const MIN_CARD_DIGITS = 12;
const MAX_CARD_DIGITS = 19;
const MAX_AMOUNT_DIGITS = 10;

// Whether `text` is a hyphen-joined bank account number (a thin digit run
// broken by `-`, without currency/amount formatting). Checks against the
// configured regional account-number patterns (see `ocr-bank-config.ts`);
// adding a new format is a config change, not a code change here.
export function isAccountNumber(text: string): boolean {
  return accountNumberPatterns.some((p) => p.regex.test(text));
}

// Whether `text` (lowercased) contains a label marker — a field label with an
// attached value ("Available Balance"). Shared with the grouping step so a
// name+amount row whose prefix is just a label ("Available $5,000.00") never
// promotes the label to an account name.
export function hasLabelMarker(text: string): boolean {
  return (
    labelMarkers.en.some((m) => text.includes(m)) ||
    labelMarkers.zh.some((m) => text.includes(m))
  );
}

// Whether `text` (lowercased) contains a summary marker ("Total", "总资产") —
// a row that aggregates the whole account and must never be treated as an
// account. Shared with the token classifier so "what is a summary row" is
// defined once.
export function hasSummaryMarker(text: string): boolean {
  return (
    summaryMarkers.en.some((m) => text.includes(m)) ||
    summaryMarkers.zh.some((m) => text.includes(m))
  );
}

// Currency-name labels a bank overview prints for a sub-account row
// ("Chinese Yuan", "United States Dollar", "Singapore Dollar"). These are
// NOT account names — they label the currency of a row inside an already-open
// account card, so the grouping step must absorb them into the open group
// (as amount rows) rather than opening a new account. A real account name
// ("360 Account", "Statement Savings Account") never reduces to a bare
// currency name, so these tokens are safe to match as substrings.
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
export function isCurrencyNameLabel(text: string): boolean {
  return CURRENCY_NAME_MARKERS.some((m) => text.includes(m));
}

// Morphological noise: OCR gibberish from a phone's status bar or app icons,
// which is not an account name and carries no semantic account content.
// Account names are real words; these are fragments that never form one:
// - A Cyrillic run ("ЛКР EITE") — OCR misreading of a non-Latin label; a
//   Cyrillic string is never an account name, so it's noise regardless of
//   any ASCII letters alongside it.
// - An isolated non-ASCII currency/symbol fragment ("iR₩", "it₺l") — the ₩/₺
//   marks an icon/capsule, not a currency amount. `¥` is deliberately NOT
//   matched here: it is the CNY currency symbol this app recognizes (see
//   `OCR_ONLY_SYMBOLS` in ocr-currency.ts), so a row like "¥ 1,234.56" must
//   reach the amount path, not be dropped as noise. The protection against
//   real account names is `DEFAULT_ACCOUNT_KEYWORD_RE` below.
// - A status-bar time+signal fragment ("22:28 A 5G E") — a leading time
//   paired with single-letter tokens is status-bar noise.
export const CYRILLIC_RE = /[А-Яа-яЁё]/;
export const NON_ASCII_SYMBOL_RE = /[₩₺€£]/;
export const TIME_FRAGMENT_RE = /^\d{1,2}:\d{2}/;

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
  if (hasSummaryMarker(lower)) {
    return "summaryRow";
  }

  // Noise: an English standalone nav label, any Chinese nav token, or
  // morphological status-bar/icon gibberish. Trimmed off `lower` (already
  // lowercased once) so we don't lowercase the row twice.
  const noiseNormalized = lower.trim().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
  if (
    defaultNoiseTokens.en.includes(noiseNormalized) ||
    defaultNoiseTokens.zh.some((m) => text.includes(m)) ||
    isMorphologicalNoise(text)
  ) {
    return "noise";
  }

  const digitCount = (text.match(/\d/g) ?? []).length;

  // A masked card ("**** 1234", "•••• •••• ••••") is always a card-number row:
  // its digits are fewer than the full-card threshold but its last four should
  // still be extracted, and carrying a currency symbol ("$**** 1234") would
  // otherwise look like an amount.
  if (isMaskedCard(text)) {
    return "cardNumber";
  }

  // A bank account number (hyphen-joined digit run like "275-023637-2"): its
  // own row right under an account name, absorbed into the open account. It
  // must not read as an amount (no currency/comma) or as a spurious account
  // name. Tested before the amount logic so a hyphen-joined number is never
  // treated as money.
  if (isAccountNumber(text)) {
    return "cardNumber";
  }

  // A currency amount: the shared `matchAmount` is the single source of "is
  // this a well-formed amount" — the same matcher the grouping step's
  // `attachAmount` uses, so the classifier and the parser can't drift.
  // `matchAmount` deliberately requires a currency, thousands grouping, or a
  // 2-decimal shape (a bare "200" is NOT an amount — too easily confused with a
  // number in an account name), and its digit handling keeps a credit-card full
  // number from reading as money. A digit-less row can't be an amount, so the
  // guard skips the matcher entirely for those (the common account-name row).
  const isAmount =
    digitCount > 0 && digitCount <= MAX_AMOUNT_DIGITS && matchAmount(text).ok;

  if (isAmount) {
    return "amountRow";
  }

  // Card check: a full-card-number row (12-19 digits in 4+ char runs) is a
  // cardNumber row. Amounts are tested first so a 12+ digit figure with a
  // decimal/fraction ("123456789012.34") reads as money, not as a card whose
  // tail 4 digits get stolen as the account last-four.
  const fullCard =
    digitCount >= MIN_CARD_DIGITS &&
    digitCount <= MAX_CARD_DIGITS &&
    /[\d·•*]{4,}/.test(text.replace(/\s/g, ""));
  if (fullCard) {
    return "cardNumber";
  }

  // Label rows without a number ("Available Balance" alone) are still labels,
  // not account names — the grouping step must not open an account for them.
  if (hasLabelMarker(lower)) {
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
