// The shared rule vocabulary: the word lists every institution inherits.
//
// These are the engine's own terms, not any institution's — "Total" marks a
// summary row on every screen, "credit limit" is not a balance anywhere. They
// live in the engine layer so `line-classify` / `token-classify` /
// `account-grouping` don't have to reach into `institutions/` for them; an
// institution's config layers ITS vocabulary (product keywords, icon tags,
// account-number shapes) on top of these.
//
// Lists are matched with `includesAny` below unless noted. Adding a marker is
// a corpus-tuning change: keep short tokens specific, because every list here
// is a substring match over a whole OCR row.

import { boundedPatternSource } from "../text";

// Whether `text` contains any of `markers`. The markers are lowercase, so the
// caller lowercases the row once and passes it in — every marker list in this
// module is consumed this way.
export function includesAny(text: string, markers: string[]): boolean {
  return markers.some((marker) => text.includes(marker));
}

// Whether `text` begins with any of `markers` — the same lowercase contract as
// `includesAny`, for the lists that describe a row's HEADING rather than
// something it merely mentions.
function startsWithAny(text: string, markers: string[]): boolean {
  const trimmed = text.trimStart();
  return markers.some((marker) => trimmed.startsWith(marker));
}

// Suffixes/labels that mark a row as a field label with an attached value
// ("Available Balance", "可用余额", "Balance").
// "可用" is the Chinese "available", and belongs here for the same reason the
// English word does: without it "可用余额" stripped to "可用" and so was not a
// label token, which cost a card its sign — the label counted as a FIELD before
// the minus, and `foldLeadingSign` treats a field before a lone "-" as a
// separator.
const labelMarkers = [
  "available",
  "balance",
  "可用",
  "金额",
  "净值",
  "持仓市值",
];

// The same idea where a plain substring is too blunt, as in `nonBalancePatterns`
// below.
//
// 余额 is the label ("可用余额 1,234.56", which this covers without needing its
// own entry), but 余额宝 is Alipay's money-market fund — a product, and one of
// the most commonly held accounts on a zh-Hans screen. Substring-matched, its
// row read as a field label, so the row never opened an account and the name was
// lost with it.
const labelPatterns = [/余额(?!宝)/];

// Whether `text` (lowercased) carries a field label with an attached value.
export function hasLabelMarker(text: string): boolean {
  return (
    includesAny(text, labelMarkers) || labelPatterns.some((re) => re.test(text))
  );
}

// `text` with its label words removed, so a caller can ask what ELSE the row
// says. "balance" is both a label and an account keyword — "Available Balance"
// is a label row, "Zero Balance Account" is a product — so testing the row for
// an account keyword only separates them once the label words are gone.
// Compiled once, like every other pattern on this path: `classifyRow` asks per
// row and `isLabelToken` per token, so recompiling here undid the saving the
// amount and product caches were each added for.
const GLOBAL_LABEL_PATTERNS = labelPatterns.map(
  (pattern) => new RegExp(pattern.source, "g"),
);

export function stripLabelMarkers(text: string): string {
  let stripped = text;
  for (const marker of labelMarkers) {
    stripped = stripped.split(marker).join(" ");
  }
  for (const pattern of GLOBAL_LABEL_PATTERNS) {
    // `lastIndex` is reset by `replace` on a global regex, so sharing the
    // instance across calls is safe here.
    stripped = stripped.replace(pattern, " ");
  }
  return stripped;
}

// Whether a row TITLES an account: it carries an account keyword that isn't
// one of its own label words. The label-word strip is what makes the test
// usable, because "balance" is both — "Total Balance" strips to "total" and
// titles nothing, "Total Wealth Account" keeps "wealth account" and does.
//
// Shared by the row classifier (which must not read such a row as a summary or
// a label) and the token classifier (whose words are then title words, not
// markers), so both answer the question the same way. `lowerText` is the
// lowercased row.
export function rowTitlesAnAccount(lowerText: string): boolean {
  return DEFAULT_ACCOUNT_KEYWORD_RE.test(stripLabelMarkers(lowerText));
}

// Whether a single TOKEN is itself a field label.
//
// Wider than `hasLabelMarker`, because the row vocabularies below label figures
// too: 信用额度 labels the limit, 已用额度 labels the debt, exactly the way
// "Available Balance" labels a balance. They are matched per row rather than
// per token, so as tokens they had no role at all and joined the account's NAME
// — a card row printing "尾号7732 信用额度 10,000.00 已用额度 4,766.92" with no
// title of its own was recognized as an account called "信用额度 已用额度".
//
// Equality, not substring: these lists are tuned for ROW matching, where a
// marker is a phrase somewhere inside a longer row. Applied to a token, the
// same substring test would demote any product name that happens to contain a
// marker word, and a name is not recoverable once dropped.
export function isLabelToken(text: string): boolean {
  const token = text.trim().toLowerCase();
  if (nonBalanceMarkers.includes(token) || debtMarkers.includes(token)) {
    return true;
  }
  // Nothing but label words — "Available Balance" as one OCR block strips to
  // nothing, "BalanceMax" strips to "max" and "净值型理财" to "型理财". Asking
  // `hasLabelMarker` (a substring test) instead demoted any product name that
  // merely contained a label word, and `nameTokensOf` then dropped it: the
  // account came back with its balance and no name — and no kind either, since
  // that is read off the name.
  return hasLabelMarker(token) && stripLabelMarkers(token).trim() === "";
}

// Row-level markers that mean "this row aggregates the whole account, don't
// treat it as an account." Short tokens are kept specific to avoid false
// positives — "sum" was removed because it matched "consumption"/"consumer".
export const summaryMarkers = [
  "total",
  "totals",
  "net worth",
  "总资产",
  "资产总额",
  "净资产",
  // IBKR's term for the account's total value ("净清算价值 63,714"), which is
  // the figure a person reads as the account balance.
  "净清算价值",
  "淨清算價值",
  "总余额",
  "全部余额",
  "合计",
  "总计",
  "小计",
];

// A row announcing how many sub-accounts follow: "7个账户", "3 accounts".
// Everything above it in the open region was that region's TOTAL, and the
// per-currency detail is below. HSBC One prints 74,987.99 HKD as the card's
// total and then lists the seven accounts that make it up — counting both
// double-counts the money.
// Anchored to the start of the row. Unanchored, "08月01日 至08日 1个账户" — a
// footnote on HSBC's cash-flow widget saying how many accounts it covers —
// looked like a sub-account heading and wiped the balances above it.
// The count is one or two digits and, in English, PLURAL. Unbounded and
// singular-tolerant, `\d+\s+accounts?` matched OCBC's product name "360
// Account" — which then cleared the region's balances and, once this marker
// stopped a row from opening an account, deleted the 360 Account itself.
export const subAccountCountMarkers = [
  /^\d{1,2}\s*个[账帳]户/,
  /^\d{1,2}\s+accounts\b/i,
];

// Rows that state a credit facility rather than a balance. A card screen prints
// its limit, the credit still available on it, and the next statement's due
// amount alongside the actual balance — summing them turned a 4,766.92 card
// into 61,180.91. Matched case-insensitively as substrings.
const nonBalanceMarkers = [
  "credit limit",
  "available credit",
  "minimum payment",
  // The MINIMUM due is a payment obligation, never the balance. It CONTAINS
  // `debtMarkers`' "amount due", which is how `statesDebt` below tells this row
  // from one that names a debt and a limit side by side.
  "minimum amount due",
  "最低还款额",
  "最低应还",
  "信用额度",
  "可用额度",
  "最低还款",
  // A broker's holdings table prints every row's worth in the ACCOUNT'S base
  // currency, whatever the asset's own currency is: IBKR's "HKD 现金 15.8K
  // 市场价值" is 15,800 SGD, not 15,800 HKD. The currency label names the
  // asset, the figure is already converted, and the account's total (净清算
  // 价值) already includes all of them — so these rows contribute no balance.
  "市场价值",
  "market value",
  "等值",
  // Change-since rows sit directly under the total on almost every wallet and
  // portfolio screen ("-$0.11 今日变动"). The figure is a delta, not a holding.
  "今日变动",
  "当日盈亏",
  "涨跌",
  "today's change",
  "24h change",
];

// The same idea, where a plain substring is too blunt.
//
// 到期 marks a card's statement due amount ("账单 24 Aug到期 3,580.91 SGD"), but
// 到期日 / 到期时间 label a MATURITY DATE, which ordinary term-deposit rows print
// beside a real balance — "CNY 50,000.00 到期日 2027-01-01" was losing its
// 50,000.00 and then the account with it.
const nonBalancePatterns = [/到期(?!日|時|时间|時間)/];

// Whether this row states something other than a balance — a credit facility, a
// converted holding, a day's change. `lowerLine` is the lowercased row.
export function isNonBalanceRow(lowerLine: string): boolean {
  return (
    includesAny(lowerLine, nonBalanceMarkers) ||
    nonBalancePatterns.some((re) => re.test(lowerLine))
  );
}

// Rows whose figure is money OWED, stated as a positive number.
//
// Card issuers split on this and there is no way to tell from the digits
// alone. Some print what you SPENT — OCBC shows "您花了 4,766.92 SGD" — where
// the account's balance is -4,766.92. Others print the debt already signed —
// HSBC shows "-1,745.52SGD" — and need no marker at all, since `-Math.abs()`
// leaves an already-negative figure unchanged either way.
//
// Both conventions are handled, but only when the row SAYS which it is. A card
// that prints a bare positive balance with no such label is genuinely
// ambiguous — the same "4,766.92" could be a debt or an overpayment credit —
// so the recognizer reports what the screen shows and leaves the sign to the
// user, which the editable draft exists for.
const debtMarkers = [
  "you spent",
  "outstanding balance",
  "amount owed",
  "you owe",
  "amount due",
  "balance due",
  "您花了",
  "你花了",
  "已用额度",
  "本期应还",
  "当期应还",
  "应还金额",
  "未还金额",
  "待还款",
  "欠款",
  "结欠",
];

// Whether `text` states a debt rather than a credit facility, when it carries
// markers from both vocabularies.
//
// Card rows routinely do. Two shapes, and they need opposite answers:
//
//   "您花了 4,766.92 信用额度 10,000.00"     — two SEPARATE labels, one per
//                                             figure. The debt is real; the
//                                             debt path takes only its figure.
//   "Minimum amount due S$50.00"            — ONE label that CONTAINS the debt
//                                             marker "amount due". The row is
//                                             a payment obligation, not a debt.
//
// So containment decides, not length: an overlapping non-balance marker (one
// that swallows the debt marker) wins; two unrelated labels mean the row really
// does state a debt. Comparing raw lengths across the two vocabularies said
// "您花了" (3) loses to "信用额度" (4) and suppressed the card's only balance.
export function statesDebt(text: string): boolean {
  return debtMarkerEndIn(text) !== -1;
}

// Where the row's debt label ENDS, as a character index into `text`, or -1 when
// the row states no debt. The figure the label names is the first one after it.
//
// Per MARKER, not per row. One overlapping label used to cancel every debt
// marker on the line, so a row carrying both "Minimum amount due" (which
// swallows "amount due") and "Outstanding balance" was suppressed whole and the
// account disappeared. A debt marker counts unless some non-balance marker on
// this row contains IT.
//
// Returned as a character index because the label SPANS TOKENS: every English
// marker here is two or three words while OCR emits one word per block, so a
// per-token scan found nothing and the caller fell back to the row's first
// figure — which on a card row is the credit LIMIT. "Credit limit S$10,000.00
// Amount owed S$4,766.92" was recognized as a balance of -10,000.
export function debtMarkerEndIn(text: string): number {
  let end = -1;
  for (const debt of debtMarkers) {
    const at = text.indexOf(debt);
    if (at === -1) {
      continue;
    }
    const swallowed = nonBalanceMarkers.some(
      (marker) =>
        marker !== debt && marker.includes(debt) && text.includes(marker),
    );
    if (swallowed) {
      continue;
    }
    if (end === -1 || at + debt.length < end) {
      end = at + debt.length;
    }
  }
  return end;
}

// Footer rows printing a contact number. A service hotline is a hyphen-grouped
// digit run of exactly the shape `hasStandaloneAccountNumber` looks for, so
// "客服热线 400-820-8888" classified as a card row and donated "8888" to
// whichever account was still missing a last four — a wrong last four feeds
// account dedupe and matching, so it is worse than none.
//
// Matched as substrings: these words label the row, and the row is footer
// chrome either way.
export const contactMarkers = [
  "客服热线",
  "服务热线",
  "客服电话",
  "咨询电话",
  "服务电话",
  "热线",
  "hotline",
  "customer service",
  "contact us",
];

// Headings that end the account list. Below one of these a screen switches
// from "here are your accounts" to something else — a transaction log, a
// cash-flow widget, a spending breakdown — and every figure below is a
// posting, a flow, or a statistic rather than a balance.
//
// This matters more than it looks. DBS shows the balance (SGD 100,554.59) and
// then, under "Transaction History", a "TRF TOP-UP TO PAYLAH! … SGD -4.50" row
// that was being added to the account. HSBC follows its cards with a 净现金流
// panel whose 0.00 HKD was landing in the last card.
//
// Split by script, the same way `kind.ts` splits its keywords and for the same
// reason: an English marker is a word among words and needs a boundary, a CJK
// one has none to find.
//
// English markers must LEAD the row. Substring-matched, `"transactions"` fired
// on a top nav row ("Home Transactions Cards") and on DBS's own "Search
// transactions" box — and because this marker stops the scan outright, every
// account below was silently lost. Anchoring still allows the trailing icon or
// filter control these headings are usually OCR'd with ("Transactions 已获得
// 利息 新") and still catches DBS's own "Transaction History".
const accountSectionEndHeadingsEn = [
  "transaction history",
  "transactions",
  "recent activity",
  "cash flow",
];

// CJK markers stay substring-matched, and the corpus says they must: Bitget
// Wallet prints its account area, then a mid-row nav bar "转账 收款 交易历史",
// and below it a token-holdings list whose figures are already inside the
// account's total. Anchoring here would let those holdings double-count the
// balance. Whether that row is really a section end or just happens to sit
// where one belongs is a per-institution question — see the layering note in
// the README — but until an institution config answers it, substring matching
// is what reads these screens correctly.
const accountSectionEndHeadingsZh = [
  "交易记录",
  "交易明细",
  "交易历史",
  "账单明细",
  // A per-product breakdown of the assets ALREADY listed above it. Alipay's
  // overview totals 5,203.47 under 稳健理财, then repeats the same money below
  // 资产明细 as 余额宝 / 定期 / 基金 / 黄金 rows — counting both doubles the
  // account. Not the bare 明细 a CCB row prints as a button label.
  "资产明细",
  "最近交易",
  "净现金流",
  "现金流入",
  "现金流出",
];

// Whether this row ends the account list. `lowerLine` is the lowercased row.
export function endsAccountSection(lowerLine: string): boolean {
  return (
    startsWithAny(lowerLine, accountSectionEndHeadingsEn) ||
    includesAny(lowerLine, accountSectionEndHeadingsZh)
  );
}

// Nav/footer tokens shared across institution apps. Unlike every other list in
// this module these are NOT substring-matched over a row: a nav label stands
// alone on its row, and a row with more on it is content.
//
// `classifyRow` compares them against the whole row — English after stripping
// nav punctuation, Chinese against the trimmed row — because substring matching
// on Chinese was tried and repeatedly ate real content: "账户" swallowed
// "智能账户号码 港元 0.00", and "更多" swallowed the tab row "储蓄户口 付款 更多"
// that titles a Trust account. `classifyTokens` applies the same list to a
// single token, where the row-level ambiguity doesn't arise.
export const defaultNoiseTokens: { en: string[]; zh: string[] } = {
  en: ["fps", "nets", "banner", "back", "home", "profile", "settings"],
  zh: [
    "地址",
    "账户管理",
    "返回",
    "首页",
    "设置",
    "退出",
    "银行卡",
    "投资",
    "贷款",
    "保险",
    "计划",
    "转账与付款",
    "奖励积点",
    "更多",
  ],
};

// Words that mark a real account name, shared across institutions.
// Institution-specific product keywords ("global"/"statement" for OCBC,
// "multiplier" for DBS) are added per-institution.
export const defaultAccountKeywords = [
  "account",
  "savings",
  "card",
  "deposit",
  "current",
  "checking",
  "wallet",
  "fund",
  "portfolio",
  "broker",
  "balance",
  "loan",
  "yield",
  "money",
];

// NOT here, deliberately: Chinese account words ("账户", "储蓄", "户口",
// "存款", "证券"). Adding them was tried and reverted — measured over the eval
// corpus it resolved nothing and regressed three fields.
//
// The reason is that on a zh-Hans institution UI these words label SUB-account
// rows as often as accounts: "港元储蓄" / "人民币储蓄" are the per-currency rows
// of one HSBC account, and "盈透证券集团股份有…" is a holding inside an IBKR
// portfolio. Treating each as an account keyword opens a region per row and
// shatters one account into many.
//
// Recognizing Chinese account names therefore needs the grouping step to tell
// an account from its sub-rows — indentation, currency-row structure, or a
// per-institution rule — not a longer keyword list.

// One compiled regex per distinct keyword list. The inputs are fixed per
// institution, so the whole app can only ever produce about fifteen patterns —
// but `buildAccountKeywordRegex` is called once per parse, and rebuilding meant
// two `.test()` calls and an escape pass per keyword every time. Declared above
// `DEFAULT_ACCOUNT_KEYWORD_RE` because that constant calls the builder at module
// init, which would hit this in its temporal dead zone otherwise.
const accountKeywordRegexCache = new Map<string, RegExp>();

// The compiled default account-keyword regex. Case-insensitive. Used on the
// pre-detection path, where no institution is known yet.
export const DEFAULT_ACCOUNT_KEYWORD_RE = buildAccountKeywordRegex();

// Builds the account-keyword regex for a parse: the shared defaults plus the
// detected institution's product keywords. Memoized so the classifier and the
// grouping step share one pattern across parses, not just within one.
export function buildAccountKeywordRegex(
  institutionKeywords: string[] = [],
): RegExp {
  const cacheKey = institutionKeywords.join(" ");
  const cached = accountKeywordRegexCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  // Escaped and bounded by `boundedPatternSource`, which owns that rule for
  // both keyword tiers — these come from `InstitutionConfig`, whose product
  // copy carries regex metacharacters ("hsbc live+"), and unbounded, "fund"
  // matched inside "Refund policy" so a disclaimer opened an account and took
  // the figure beside it. That row also clears a summary discard run, so it
  // re-enabled balance attachment too.
  const keywords = [...defaultAccountKeywords, ...institutionKeywords].map(
    boundedPatternSource,
  );
  const compiled = new RegExp(`(${keywords.join("|")})`, "i");
  accountKeywordRegexCache.set(cacheKey, compiled);
  return compiled;
}

// The account-number morphologies the pre-detection row classifier knows: a
// digit run broken by hyphens, without currency or amount formatting.
//
// The SG hyphen format (e.g. 275-023637-2) is the only one here because it is
// the only one an institution-agnostic pass can safely claim. Per-institution
// formats live in each `InstitutionConfig.detect.accountNumberPatterns`, and
// `institutions/config.ts` reuses this entry for the SG banks that print it.
export const SG_HYPHEN_ACCOUNT_NUMBER = /^\d{1,4}-\d{4,7}-\d{1,4}$/;

export const accountNumberPatterns: RegExp[] = [SG_HYPHEN_ACCOUNT_NUMBER];
