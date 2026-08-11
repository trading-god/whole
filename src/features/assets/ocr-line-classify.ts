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

// Classifies a single line's text. Pure; expects the whitespace-joined text of
// a clustered line.
export function classifyRow(text: string): RowRole {
  const lower = text.toLowerCase();

  // Summary rows first — "Total" alone must never look like an account name.
  if (SUMMARY_MARKERS.some((m) => lower.includes(m))) {
    return "summaryRow";
  }

  // Noise: an English standalone nav label, or any Chinese nav token. Trimmed
  // off `lower` (already lowercased once) so we don't lowercase the row twice.
  const noiseNormalized = lower.trim().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
  if (NOISE_TOKENS_EN.includes(noiseNormalized) || NOISE_RE_ZH.test(text)) {
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
  return "accountName";
}
