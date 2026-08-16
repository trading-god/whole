// Per-institution configuration for the OCR rule engine. The pipeline first
// detects which institution a screenshot belongs to (`detect.ts`), then runs
// the grouping step with that institution's config layered on top of the shared
// defaults.
//
// An institution is any account provider the app recognizes — a bank, a crypto
// exchange, or a broker — so this list spans SG and HK banks, mainland Chinese
// banks and Alipay, the crypto exchanges, and IBKR. See src/i18n/README.md for
// the terminology.
//
// Picking detection signals: prefer something only that institution's own UI
// prints. A brand name is not automatically safe — "IBKR" appears in the
// holdings list of any broker app where the user owns the stock, so IBKR is
// detected by its portfolio vocabulary instead. Signals also have to separate
// siblings: HSBC HK and HSBC SG share a brand, an app, and an account-number
// format, so only their flagship product names tell them apart.
//
// Adding a new institution means appending an `InstitutionConfig` entry here —
// not editing the classifier or the grouping state machine. Each institution's
// rules (icon tags, account-number formats, nav vocabulary, equivalent-total
// patterns) stay isolated from every other institution's, so an OCBC-specific
// rule can't break DBS parsing and vice versa.
import type { AssetKind } from "../contract/asset-kind";
import type { Currency } from "../contract/currency";
import type { InstitutionId } from "../contract/institution";
import { SG_HYPHEN_ACCOUNT_NUMBER } from "../engine/vocabulary";

// An institution's detection signals and institution-specific rules. Fields are
// optional — an institution only overrides what it needs; everything else
// inherits from `DEFAULT_CONFIG`.
//
// SCOPE, and it is narrower than it looks: an institution's `accountKeywords`
// reach the GROUPING and naming stages, not the row/token classifier. Row roles
// are decided before detection runs (see `parser.ts`), so they are decided with
// the shared English keyword list — a row whose only account-ness comes from a
// per-institution product name ("智能账户", "储蓄户口") can still be classified
// as noise or as a label row, and nothing downstream recovers it. Adding such a
// keyword therefore fixes what an opened account is CALLED, not whether the row
// opens one. Making it fix both means detecting before classifying, which the
// pipeline could do — detection reads only token text and positions, never
// roles — and is a restructuring, not a config change.
export type InstitutionConfig = {
  // Detection signals used by `detectInstitution`. `institutionNameTokens`
  // matches a standalone OCR token (case-insensitive); `productNames` matches a
  // substring in the joined line text; `accountNumberPatterns` matches a
  // standalone token against the institution's account-number morphologies —
  // a digit run broken by hyphens ("275-023637-2", "517-345377-201"), which is
  // neither a card (they may be as short as 10 digits, below MIN_CARD_DIGITS)
  // nor an amount (no currency, no comma grouping).
  detect: {
    institutionNameTokens?: string[];
    productNames?: string[];
    accountNumberPatterns?: RegExp[];
  };
  // Icon-tag prefixes that institution's overview screen renders before account
  // names ("360" before "360 Account", "GSA" before "Global Savings Account").
  // The grouping step strips a leading token when it's one of these and the rest
  // already forms a full account name.
  iconTags?: string[];
  // A pattern matching the institution's "equivalent total" display
  // ("Equivalent in SGD", "Available in 3 currencies").
  //
  // OMITTING it inherits `DEFAULT_CONFIG`'s shared pattern — the display is
  // common enough to be the default. Turning the check off for one institution
  // takes an explicit `equivalentTotalPattern: undefined`, which the spread in
  // `resolveInstitutionConfig` honours.
  equivalentTotalPattern?: RegExp;
  // Account-name keywords specific to this institution's products ("global",
  // "statement" for OCBC; "multiplier" for DBS). Added to the shared
  // `accountKeywords` when this institution is detected.
  //
  // This is where Chinese account words belong. The shared list is English-only
  // on purpose (see the note under `defaultAccountKeywords`): globally, "储蓄"
  // and "账户" label sub-account rows as often as accounts and shatter one
  // account into many. Scoped to one institution the ambiguity disappears —
  // "汇丰" only ever titles an HSBC HK account, "一卡通" only a Wing Lung one —
  // so each institution can name its own products without affecting any other.
  accountKeywords?: string[];
  // The currency this institution's app shows when it doesn't name one. A
  // domestic bank prints its home currency as a bare number — a China Merchants
  // overview reads "76,007.05" with no ¥ anywhere on screen — so a balance with
  // no currency evidence is denominated here rather than dropped.
  //
  // Applied last, after both the row's own currency and any currency the
  // account established elsewhere, so it can never override something the
  // screen actually said. Left undefined for multi-currency venues (brokers,
  // crypto exchanges), where guessing a home currency would be wrong.
  defaultCurrency?: Currency;
  // Where one account's region ends on this institution's overview.
  //
  // Most apps title an account and then list its details below it, so a new
  // title starts a new account and the account number sits inside the region.
  // BOCHK inverts that: it prints name + currency + balance on one row and the
  // account number on the row BELOW, making the number the last thing in the
  // region. Without this flag every account's balance leaks into whichever
  // region opened first, and a four-account screen reads as one.
  //
  // Only set it for an institution whose screen actually has this shape —
  // applied to a name-first layout it would cut each account in half.
  accountNumberEndsAccount?: boolean;
  // Where this institution's account number keeps its identifying digits, when
  // they are not simply its last four. The first capture group is taken as the
  // account's own digits, and its tail four become the last four.
  //
  // BOCHK prints a trailing check digit — "012-394-2-033676-3" is account
  // 033676, which a person reads as 3676, not the mechanical tail 6763. Only
  // numbers matching the pattern are re-read; anything else on the row falls
  // back to the shared tail rule.
  accountNumberLastFour?: RegExp;
  // The mirror image of `accountNumberEndsAccount`: this institution prints the
  // account's name and number together at the TOP of its region, with the
  // balances below ("一卡通 601-526-0984-7" then per-currency rows). There, a
  // named account-number row opens a new account.
  //
  // Off by default, because on most layouts a named card row inside an open
  // account is an attached card ("借记卡 4218-…" under a 360 Account), and
  // treating it as a boundary would split one account in two.
  accountNumberStartsAccount?: boolean;
  // What kind of account this institution holds, when the account's own name
  // doesn't say. A crypto exchange holds crypto and a broker holds investments
  // no matter what words their navigation bars contain — Bitget's 理财 tab was
  // making every Bitget account read as an investment.
  //
  // The account NAME still wins: CMB Wing Lung is a bank (cash), but its
  // 保证金证券 account names itself an investment account and is read as one.
  defaultKind?: AssetKind;
};

// The default institution config — used when `detectInstitution` returns
// "unknown". Carries only the shared rules; no institution-specific detection
// signals. The equivalent-total pattern is shared (the "in N currencies" /
// "Equivalent in X" display appears across SG bank multi-currency UIs, not just
// OCBC).
export const DEFAULT_CONFIG: InstitutionConfig = {
  detect: {},
  equivalentTotalPattern: /\b(?:equivalent|in\s+\d+\s+currencies)\b/i,
};

// ── Per-institution configs ────────────────────────────────────────────────

// Bank of China (Hong Kong), e.g. 012-394-2-033676-3: five hyphen-separated
// groups, which no other configured institution prints — that shape alone
// identifies the bank.
const BOCHK_ACCOUNT_NUMBER = /^\d{3}-\d{3}-\d-\d{6}-\d$/;

// CMB Wing Lung prints two different shapes depending on the account type —
// all-in-one (601-526-0984-7) and securities margin (682-2-48564-2). Both are
// four groups, which distinguishes them from the three-group SG and HSBC
// formats and from BOCHK's five.
const CMBWL_ACCOUNT_NUMBERS = [/^\d{3}-\d{3}-\d{4}-\d$/, /^\d{3}-\d-\d{5}-\d$/];

// OCBC: the SG hyphen account-number format, 360/GSA/STS icon tags, and the
// Chinese nav tokens observed on the OCBC Chinese app. The equivalent-total
// pattern ("Equivalent in SGD" / "in N currencies") is inherited from
// DEFAULT_CONFIG — it's shared across SG bank multi-currency UIs.
const OCBC_CONFIG: InstitutionConfig = {
  detect: {
    institutionNameTokens: ["ocbc"],
    productNames: ["360 account", "gsa", "sts", "global savings"],
    accountNumberPatterns: [SG_HYPHEN_ACCOUNT_NUMBER],
  },
  iconTags: ["360", "gsa", "sts"],
  accountKeywords: ["global", "statement"],
  defaultCurrency: "SGD",
  defaultKind: "cash",
};

// DBS: the "Multiplier" product name and the DBS institution-name token. Shares
// the SG hyphen account-number format with OCBC (both are SG banks), so
// detection falls back to product name when the institution-name token isn't
// visible.
const DBS_CONFIG: InstitutionConfig = {
  detect: {
    institutionNameTokens: ["dbs"],
    productNames: ["multiplier"],
    accountNumberPatterns: [SG_HYPHEN_ACCOUNT_NUMBER],
  },
  accountKeywords: ["multiplier"],
  defaultCurrency: "SGD",
  defaultKind: "cash",
};

// ── Mainland China ─────────────────────────────────────────────────────────

// Alipay. The app never prints "支付宝" on the asset overview — the wordmark is
// an image — so detection leans on 余额宝, its own money-market fund, which no
// other app offers.
const ALIPAY_CONFIG: InstitutionConfig = {
  detect: {
    institutionNameTokens: ["支付宝", "alipay"],
    productNames: ["余额宝"],
  },
  defaultCurrency: "CNY",
  defaultKind: "investment",
  accountKeywords: ["稳健理财", "进阶理财", "余额宝"],
};

// China Construction Bank. Prints its full name and 龙卡通 (its debit-card
// brand) on the account card, so both the token and the product signal fire.
const CCB_CONFIG: InstitutionConfig = {
  detect: {
    institutionNameTokens: ["中国建设银行"],
    productNames: ["china construction bank", "建设银行", "龙卡通"],
  },
  defaultCurrency: "CNY",
  defaultKind: "cash",
  accountKeywords: ["中国建设银行"],
};

// China Merchants Bank. 朝朝宝 is its own cash-management product; 招行 is the
// contraction it uses in its own marketing rows ("买理财，来招行").
//
// Deliberately NOT keyed on 一卡通: that brand also appears on CMB Wing Lung
// screens, and matching it here would swallow every Wing Lung screenshot.
const CMB_CONFIG: InstitutionConfig = {
  detect: {
    institutionNameTokens: ["招商银行"],
    productNames: ["朝朝宝", "招行"],
  },
  defaultCurrency: "CNY",
  defaultKind: "cash",
};

// ── Hong Kong ──────────────────────────────────────────────────────────────

// Bank of China (Hong Kong). The overview screen shows no reliable name token
// (OCR mangles the logotype), so its account-number morphology carries
// detection.
const BOCHK_CONFIG: InstitutionConfig = {
  detect: {
    institutionNameTokens: ["中银香港", "bochk"],
    accountNumberPatterns: [BOCHK_ACCOUNT_NUMBER],
  },
  defaultCurrency: "HKD",
  // Name, currency and balance share a row; the account number follows on the
  // row below. See `accountNumberEndsAccount`.
  accountNumberEndsAccount: true,
  // The final group is a check digit; the account is the six digits before it.
  accountNumberLastFour: /^\d{3}-\d{3}-\d-(\d{6})-\d$/,
  defaultKind: "cash",
  accountKeywords: ["智能账户"],
};

// CMB Wing Lung Bank. Same situation as BOCHK: no name token survives on the
// overview, and its two account-number shapes are distinct enough to identify
// it. Its parent CMB is detected by product name instead, so the two never
// compete on the same signal.
const CMBWL_CONFIG: InstitutionConfig = {
  detect: {
    institutionNameTokens: ["招商永隆银行", "永隆银行"],
    productNames: ["wing lung", "永隆"],
    accountNumberPatterns: CMBWL_ACCOUNT_NUMBERS,
  },
  // Each account is titled on its own number row, with balances below it.
  accountNumberStartsAccount: true,
  defaultCurrency: "HKD",
  defaultKind: "cash",
  accountKeywords: ["一卡通", "保证金证券"],
};

// HSBC Hong Kong and HSBC Singapore share a brand, an app design, AND an
// account-number format (`661-796201-833` / `145-742482-221`), so neither the
// name token nor the number shape can separate them. Only the flagship product
// names can: 汇丰One / 汇丰Pulse are HK-only, Everyday Global Account and
// Live+ are SG-only. That is why neither config declares an
// `institutionNameTokens` entry for "HSBC" — it would match both and resolve
// to whichever happens to be listed first.
const HSBCHK_CONFIG: InstitutionConfig = {
  detect: {
    productNames: ["汇丰one", "汇丰pulse", "hsbc one"],
  },
  defaultCurrency: "HKD",
  defaultKind: "cash",
  accountKeywords: ["汇丰"],
};

const HSBCSG_CONFIG: InstitutionConfig = {
  detect: {
    productNames: ["everyday global account", "hsbc live+"],
  },
  defaultCurrency: "SGD",
  defaultKind: "cash",
};

// ── Crypto exchanges and brokers ───────────────────────────────────────────

const BITGET_CONFIG: InstitutionConfig = {
  detect: { institutionNameTokens: ["bitget"] },
  defaultKind: "crypto",
};

const OKX_CONFIG: InstitutionConfig = {
  detect: { institutionNameTokens: ["okx"] },
  defaultKind: "crypto",
};

// Interactive Brokers. Detected by its portfolio vocabulary, NOT by the "IBKR"
// token — IBKR is a listed company, so that token appears in the holdings list
// of any broker app where the user owns its shares. 净清算价值 (Net Liquidation
// Value) and 剩余流动性 (Available Funds) are IBKR's own terms of art and only
// appear on its own screen.
const IBKR_CONFIG: InstitutionConfig = {
  detect: {
    productNames: ["净清算价值", "剩余流动性", "interactive brokers"],
  },
  // IBKR reports the portfolio in the account's base currency, which it prints
  // beside the total in a column the screenshot crops. For a Singapore account
  // that base is SGD; a different base would need its own detection signal.
  defaultCurrency: "SGD",
  defaultKind: "investment",
};

// ── Singapore ──────────────────────────────────────────────────────────────

// Trust Bank Singapore. The overview prints no "Trust" token; 储蓄罐 (its Money
// Jar savings product) is what identifies it.
//
// "trust" is deliberately NOT an institution-name token, even though it is the
// bank's name. It is an ordinary word in security names — unit trusts, REITs —
// and the name-token tier is swept across every institution before the
// product-name tier, so it outranked every other institution's product signal:
// an IBKR portfolio listing "Link REIT Trust" detected as Trust Bank, which
// flipped the account's kind from investment to cash and offered "Trust Bank"
// as the wizard's group name. No sample needs it; the corpus screen carries no
// such token at all.
const TRUST_CONFIG: InstitutionConfig = {
  detect: {
    productNames: ["储蓄罐"],
  },
  defaultCurrency: "SGD",
  defaultKind: "cash",
  accountKeywords: ["储蓄户口"],
};

// All institution configs keyed by institutionId. `unknown` is the fallback.
//
// This is also the order `detectInstitution` tries them in (see
// `DETECT_INSTITUTIONS` below), so it is grouped by region for readability.
// Order only matters when two institutions could fire on the SAME signal tier
// (name token, then product name, then account-number shape), and the configs
// are written so that never happens — see the HSBC and CMB/Wing Lung notes.
export const INSTITUTION_CONFIGS: Record<InstitutionId, InstitutionConfig> = {
  // Singapore
  ocbc: OCBC_CONFIG,
  dbs: DBS_CONFIG,
  trust: TRUST_CONFIG,
  hsbcsg: HSBCSG_CONFIG,
  // Hong Kong
  hsbchk: HSBCHK_CONFIG,
  bochk: BOCHK_CONFIG,
  cmbwl: CMBWL_CONFIG,
  // Mainland China
  cmb: CMB_CONFIG,
  ccb: CCB_CONFIG,
  alipay: ALIPAY_CONFIG,
  // Crypto exchanges and brokers
  bitget: BITGET_CONFIG,
  okx: OKX_CONFIG,
  ibkr: IBKR_CONFIG,
  // The fallback — no detection signals, so `DETECT_INSTITUTIONS` skips it.
  unknown: DEFAULT_CONFIG,
};

// The ordered list of institutions detection tries: every configured
// institution that actually declares a detection signal. Derived rather than
// hand-listed, so adding an `InstitutionConfig` entry above is the whole "add
// an institution" change and the detector can't drift from the configs.
//
// The `detect`-is-non-empty test is what excludes `unknown`, and it also
// excludes a staged institution — an id declared in `institutionIdSchema` with
// a config but no signals yet, which `detectInstitution` must not resolve to.
export const DETECT_INSTITUTIONS: readonly InstitutionId[] = (
  Object.keys(INSTITUTION_CONFIGS) as InstitutionId[]
).filter((id) => Object.keys(INSTITUTION_CONFIGS[id].detect).length > 0);
