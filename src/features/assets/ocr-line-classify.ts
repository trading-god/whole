// Row classification: assigns each clustered visual line a role so the grouping
// step knows which rows are account names, which are balance amounts, which are
// summary rows (never accounts), and which are noise (nav, footer, TLDs). The
// keyword lists are tuned against the eval corpus; row role just needs to get
// the *first-order* semantics right, since the grouping step disambiguates
// further.
import { isMaskedCard, matchAmount } from "./ocr-amount";

export type RowRole =
  "accountName" | "cardNumber" | "amountRow" | "summaryRow" | "noise";

// Card-number morphology: a card number has 12–19 digits; an amount can't have
// more than 10. Named so tone corpus tuning edits the constants here rather
// than bare literals inside the classifier.
const MIN_CARD_DIGITS = 12;
const MAX_CARD_DIGITS = 19;
const MAX_AMOUNT_DIGITS = 10;

// Bank account-number morphology: a digit run broken by hyphens
// ("275-023637-2", "517-345377-201"). These are NOT cards (they may be as
// short as 10 digits, below MIN_CARD_DIGITS) and NOT amounts (no currency,
// no comma grouping). A standalone hyphen-joined digit string directly under
// an account name is that account's number — it must be absorbed into the
// open account (as a cardNumber row yields a last-four) rather than opening a
// spurious account like "275-023637-2".
const ACCOUNT_NUMBER_RE = /^\d{1,4}-\d{4,7}-\d{1,4}$/;

// Whether `text` is a hyphen-joined bank account number (a thin digit run
// broken by `-`, without currency/amount formatting).
export function isAccountNumber(text: string): boolean {
  return ACCOUNT_NUMBER_RE.test(text);
}

// Suffixes/labels that mark a row as a field label with an attached value
// ("Available Balance", "可用余额", "Balance"). The label is not the number —
// a label row (with or without an amount) is an amount row, never an account
// name; "Balance 1,234.56" is a row to attach, "Available Balance" without a
// number is attached and ignored by the parser.
const LABEL_MARKERS = [
  "available",
  "balance",
  "余额",
  "可用余额",
  "金额",
  "净值",
  "持仓市值",
];

// Whether `text` (lowercased) contains a label marker — a field label with an
// attached value ("Available Balance"). Shared with the grouping step so a
// name+amount row whose prefix is just a label ("Available $5,000.00") never
// promotes the label to an account name.
export function hasLabelMarker(text: string): boolean {
  return LABEL_MARKERS.some((m) => text.includes(m));
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

// Row-level markers that mean "this row aggregates the whole account, don't
// treat it as an account." Matched as substrings, so short tokens are kept
// specific to avoid false positives — "sum" was removed because it matched
// "consumption"/"consumer". The Chinese totals cover zh-Hans bank UIs.
const SUMMARY_MARKERS = [
  "total",
  "totals",
  "net worth",
  "总资产",
  "资产总额",
  "净资产",
  "总余额",
  "全部余额",
  "合计",
  "总计",
  "小计",
];

// English nav/footer tokens — matched only when the WHOLE row is the token
// (after stripping nav punctuation), so standalone "Home"/"Back"/"Settings"
// are noise but "Home Loan"/"Banner Bank"/"FPS Account" (account names that
// contain that word) are not.
const NOISE_TOKENS_EN = [
  "fps",
  "nets",
  "banner",
  "back",
  "home",
  "profile",
  "settings",
];
// Chinese nav/footer tokens. `\b` only fires between `\w` chars and CJK is not
// in `\w`, so these must NOT be wrapped in `\b` — otherwise a standalone
// "返回"/"首页"/"设置" row never matches and falls through to accountName.
const NOISE_RE_ZH = /地址|账户管理|返回|首页|设置/;

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
//   real account names is `ACCOUNT_KEYWORD_RE` below.
// - A status-bar time+signal fragment ("22:28 A 5G E") — a leading time
//   paired with single-letter tokens is status-bar noise.
const CYRILLIC_RE = /[А-Яа-яЁё]/;
const NON_ASCII_SYMBOL_RE = /[₩₺€£]/;
const TIME_FRAGMENT_RE = /^\d{1,2}:\d{2}/;

// Words that mark a real account name, even when the row also carries a stray
// symbol or time prefix. "Account"/"Savings"/"Statement"/"Global" etc. When any
// of these is present the row is treated as an account name, not noise — so
// `360 Account >` or `GSA Global Savings Account` survive. Shared with the
// grouping step (region boundary + name cleaning) so "what counts as a real
// account name" is defined once, not re-declared as three drifting regexes.
export const ACCOUNT_KEYWORD_RE =
  /(account|savings|statement|card|deposit|current|checking|wallet|fund|portfolio|broker|balance|loan|yield|global|money)/i;

// Whether the row is morphological noise: it either contains a Cyrillic run,
// or it carries a non-ASCII currency symbol / status-bar time prefix AND has
// no real account word. Kept separate from the nav-token check so the two
// styles of noise stay readable.
function isMorphologicalNoise(text: string): boolean {
  if (CYRILLIC_RE.test(text)) {
    return true;
  }
  if (ACCOUNT_KEYWORD_RE.test(text)) {
    return false;
  }
  return NON_ASCII_SYMBOL_RE.test(text) || TIME_FRAGMENT_RE.test(text);
}

// Classifies a single line's text. Pure; expects the whitespace-joined text of
// a clustered line.
export function classifyRow(text: string): RowRole {
  const lower = text.toLowerCase();

  // Summary rows first — "Total" alone must never look like an account name.
  if (SUMMARY_MARKERS.some((m) => lower.includes(m))) {
    return "summaryRow";
  }

  // Noise: an English standalone nav label, any Chinese nav token, or
  // morphological status-bar/icon gibberish. Trimmed off `lower` (already
  // lowercased once) so we don't lowercase the row twice.
  const noiseNormalized = lower.trim().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
  if (
    NOISE_TOKENS_EN.includes(noiseNormalized) ||
    NOISE_RE_ZH.test(text) ||
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
  if (isCurrencyNameLabel(lower) && !ACCOUNT_KEYWORD_RE.test(text)) {
    return "amountRow";
  }
  return "accountName";
}
