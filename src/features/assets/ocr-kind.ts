// Asset-kind classification for OCR text rows. `detectKind` maps an account's
// recognized text onto the app's asset kinds (cash / investment / crypto) via a
// small keyword table, defaulting to `cash`. The table is tuned against the
// eval corpus; keywords are matched case-insensitively and against both the
// row text and the full recognized text so an overview screenshot's account
// kind tags the right row.
//
// ASCII keywords are matched with `\b` word boundaries so short tokens don't
// fire inside longer words ("eth" must not match "Netherlands", "btc" must not
// match some future word); CJK keywords are matched as substrings because `\b`
// doesn't fire around CJK characters. "wallet"/"钱包" and "trading" are
// deliberately NOT markers: too many non-crypto products use them (零钱包 petty
// cash, 支付宝钱包, "ABC Trading Ltd"), so they would misroute bank accounts;
// "cash" is the safer default.
import type { AssetKind } from "./account-appearance";

type KindRule = { kind: AssetKind; keywords: string[] };

// Ordered by specificity. "broker"/"brokerage"/"证券"/"股票" read investment;
// "crypto"/"BTC"/"ETH"/"USDT"/"交易所" read crypto. The heuristics' English
// tokens are what the user's banks actually print; the Chinese tokens cover
// zh-Hans bank/crypto UIs.
const KIND_RULES: KindRule[] = [
  {
    kind: "investment",
    keywords: [
      "broker",
      "brokerage",
      "securities",
      "证券",
      "股票",
      "基金",
      "理财",
    ],
  },
  {
    kind: "crypto",
    keywords: [
      "crypto",
      "bitcoin",
      "ethereum",
      "btc",
      "eth",
      "usdt",
      "数字货币",
      "虚拟货币",
      "交易所",
    ],
  },
];

// Precompiled matchers: ASCII keywords get `\b` word boundaries (so "eth"
// doesn't match "Netherlands"); CJK keywords are substring matches (`\b`
// doesn't fire around CJK).
const KIND_PATTERNS: { kind: AssetKind; patterns: RegExp[] }[] = KIND_RULES.map(
  (rule) => ({
    kind: rule.kind,
    patterns: rule.keywords.map((kw) =>
      /^[\x00-\x7F]+$/.test(kw)
        ? new RegExp(`\\b${kw}\\b`, "i")
        : new RegExp(kw),
    ),
  }),
);

// Detects an asset kind from a row's text (the row's own words plus, for
// robustness, the whole account's recognized text). Returns "cash" when no
// keyword matches.
export function detectKind(text: string, wholeText?: string): AssetKind {
  const haystack = `${text} ${wholeText ?? ""}`.toLowerCase();
  for (const rule of KIND_PATTERNS) {
    if (rule.patterns.some((re) => re.test(haystack))) {
      return rule.kind;
    }
  }
  return "cash";
}
