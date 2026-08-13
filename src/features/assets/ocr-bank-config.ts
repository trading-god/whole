// Per-bank configuration for the OCR rule engine. The pipeline first detects
// which bank a screenshot belongs to (`ocr-bank-detect.ts`), then runs the
// grouping step with that bank's config layered on top of the shared defaults.
//
// Adding a new bank means appending a `BankConfig` entry here — not editing
// the classifier or the grouping state machine. Each bank's rules (icon tags,
// account-number formats, nav vocabulary, equivalent-total patterns) stay
// isolated from every other bank's, so an OCBC-specific rule can't break DBS
// parsing and vice versa.
import { z } from "zod";

// Bank identifiers. `"unknown"` is the fallback when detection can't place a
// screenshot; it runs with `DEFAULT_CONFIG` only (the shared rules every bank
// inherits), so an unrecognized bank degrades to the current global behavior
// rather than failing.
export const bankIdSchema = z.enum(["ocbc", "dbs", "unknown"]);
export type BankId = z.infer<typeof bankIdSchema>;

// A bank account-number morphology: a digit run broken by hyphens
// ("275-023637-2", "517-345377-201"). These are NOT cards (they may be as
// short as 10 digits, below MIN_CARD_DIGITS) and NOT amounts (no currency,
// no comma grouping). A standalone hyphen-joined digit string directly under
// an account name is that account's number.
//
// Each entry carries a `description` so the eval trace can explain *why* a
// token was classified as a card number.
export type AccountNumberPattern = {
  regex: RegExp;
  description: string;
};

// A bank's detection signals and bank-specific rules. Fields are optional — a
// bank only overrides what it needs; everything else inherits from
// `DEFAULT_CONFIG`.
export type BankConfig = {
  bankId: BankId;
  // Detection signals used by `detectBank`. `bankNameTokens` matches a
  // standalone OCR token (case-insensitive); `productNames` matches a
  // substring in the joined line text; `accountNumberPatterns` matches a
  // standalone token against the bank's account-number formats.
  detect: {
    bankNameTokens?: string[];
    productNames?: string[];
    accountNumberPatterns?: AccountNumberPattern[];
  };
  // Icon-tag prefixes that bank's overview screen renders before account names
  // ("360" before "360 Account", "GSA" before "Global Savings Account"). The
  // grouping step strips a leading token when it's one of these and the rest
  // already forms a full account name.
  iconTags?: string[];
  // A pattern matching the bank's "equivalent total" display ("Equivalent in
  // SGD", "Available in 3 currencies"). When undefined, equivalent-total
  // detection is skipped for this bank.
  equivalentTotalPattern?: RegExp;
  // Account-name keywords specific to this bank's products ("global",
  // "statement" for OCBC; "multiplier" for DBS). Added to the shared
  // `accountKeywords` when this bank is detected.
  accountKeywords?: string[];
};

// ── Shared defaults (every bank inherits these) ─────────────────────────────

// Suffixes/labels that mark a row as a field label with an attached value
// ("Available Balance", "可用余额", "Balance"). Split by language so the
// token classifier can match per-script: English markers are matched
// case-insensitively as whole tokens; Chinese markers are matched as
// substrings (`\b` doesn't fire between `\w` and CJK).
export const labelMarkers: { en: string[]; zh: string[] } = {
  en: ["available", "balance"],
  zh: ["余额", "可用余额", "金额", "净值", "持仓市值"],
};

// Row-level markers that mean "this row aggregates the whole account, don't
// treat it as an account." Matched as substrings, so short tokens are kept
// specific to avoid false positives — "sum" was removed because it matched
// "consumption"/"consumer".
export const summaryMarkers: { en: string[]; zh: string[] } = {
  en: ["total", "totals", "net worth"],
  zh: [
    "总资产",
    "资产总额",
    "净资产",
    "总余额",
    "全部余额",
    "合计",
    "总计",
    "小计",
  ],
};

// English nav/footer tokens shared across bank apps — matched only when the
// WHOLE row is the token (after stripping nav punctuation). Chinese nav tokens
// here are the common ones; bank-specific Chinese nav lives in each bank's
// `noiseTokens`.
export const defaultNoiseTokens: { en: string[]; zh: string[] } = {
  en: ["fps", "nets", "banner", "back", "home", "profile", "settings"],
  zh: [
    "地址",
    "账户管理",
    "返回",
    "首页",
    "设置",
    "退出",
    "账户",
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

// Words that mark a real account name, shared across banks. Bank-specific
// product keywords ("global"/"statement" for OCBC, "multiplier" for DBS) are
// added per-bank.
export const defaultAccountKeywords = [
  "account",
  "savings",
  "statement",
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
  "global",
  "money",
];

// The compiled default account-keyword regex. Case-insensitive. Per-bank
// configs extend this via `buildAccountKeywordRegex`.
export const DEFAULT_ACCOUNT_KEYWORD_RE = new RegExp(
  `(${defaultAccountKeywords.join("|")})`,
  "i",
);

// The default bank config — used when `detectBank` returns "unknown". Carries
// only the shared rules; no bank-specific detection signals. The equivalent-
// total pattern is shared (the "in N currencies" / "Equivalent in X" display
// appears across SG bank multi-currency UIs, not just OCBC).
export const DEFAULT_CONFIG: BankConfig = {
  bankId: "unknown",
  detect: {},
  equivalentTotalPattern: /\b(?:equivalent|in\s+\d+\s+currencies)\b/i,
};

// ── Per-bank configs ───────────────────────────────────────────────────────

// The ordered list of banks detection tries, excluding `unknown` (the fallback
// when nothing matches). Adding a bank to this list plus its `BankConfig` is
// the whole "add a bank" change — `detectBank` iterates this instead of a
// hardcoded list, so the detector and the config can't drift.
export const DETECT_BANKS: readonly Exclude<BankId, "unknown">[] = [
  "ocbc",
  "dbs",
];

// The SG hyphen account-number format shared by OCBC and DBS (both are SG
// banks). One definition so a third SG bank reuses the same entry instead of
// pasting a third copy.
const SG_HYPHEN_ACCOUNT_NUMBER: AccountNumberPattern = {
  regex: /^\d{1,4}-\d{4,7}-\d{1,4}$/,
  description: "SG hyphen-joined account number (e.g. 275-023637-2)",
};

// OCBC: the SG hyphen account-number format, 360/GSA/STS icon tags, and the
// Chinese nav tokens observed on the OCBC Chinese app. The equivalent-total
// pattern ("Equivalent in SGD" / "in N currencies") is inherited from
// DEFAULT_CONFIG — it's shared across SG bank multi-currency UIs.
export const OCBC_CONFIG: BankConfig = {
  bankId: "ocbc",
  detect: {
    bankNameTokens: ["ocbc"],
    productNames: ["360 account", "gsa", "sts", "global savings"],
    accountNumberPatterns: [SG_HYPHEN_ACCOUNT_NUMBER],
  },
  iconTags: ["360", "gsa", "sts"],
  accountKeywords: ["global", "statement"],
};

// DBS: the "Multiplier" product name and the DBS bank-name token. Shares the
// SG hyphen account-number format with OCBC (both are SG banks), so detection
// falls back to product name when the bank-name token isn't visible.
export const DBS_CONFIG: BankConfig = {
  bankId: "dbs",
  detect: {
    bankNameTokens: ["dbs"],
    productNames: ["multiplier"],
    accountNumberPatterns: [SG_HYPHEN_ACCOUNT_NUMBER],
  },
  accountKeywords: ["multiplier"],
};

// All bank configs keyed by bankId. `unknown` is the fallback.
export const BANK_CONFIGS: Record<BankId, BankConfig> = {
  ocbc: OCBC_CONFIG,
  dbs: DBS_CONFIG,
  unknown: DEFAULT_CONFIG,
};

// Builds the account-keyword regex for a bank: the shared defaults plus the
// bank's product keywords. Compiled once per bank at detection time so the
// classifier and grouping step share one pattern.
export function buildAccountKeywordRegex(bankConfig: BankConfig): RegExp {
  const keywords = [
    ...defaultAccountKeywords,
    ...(bankConfig.accountKeywords ?? []),
  ];
  return new RegExp(`(${keywords.join("|")})`, "i");
}

// The account-number formats used on the global (pre-detection) classification
// path — the SG hyphen shape shared by the SG-bank configs. Detected-bank
// account-number matching happens in `ocr-bank-detect`; this shared list is the
// fallback the row classifier runs before the bank is known.
export const accountNumberPatterns: AccountNumberPattern[] = [
  SG_HYPHEN_ACCOUNT_NUMBER,
];
