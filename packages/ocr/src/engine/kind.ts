// Asset-kind classification for OCR text rows. `detectAssetKind` maps an
// account's recognized text onto the app's asset kinds (cash / investment /
// crypto) via a small keyword table. The table is tuned against the eval
// corpus; keywords are matched case-insensitively.
//
// ASCII keywords are matched with `\b` word boundaries so short tokens don't
// fire inside longer words ("eth" must not match "Netherlands", "btc" must not
// match some future word); CJK keywords are matched as substrings because `\b`
// doesn't fire around CJK characters. "wallet"/"钱包" and "trading" are
// deliberately NOT markers: too many non-crypto products use them (零钱包 petty
// cash, 支付宝钱包, "ABC Trading Ltd"), so they would misroute cash accounts;
// "cash" is the safer default.
import type { AssetKind } from "../contract/asset-kind";
import { boundedPatternSource } from "../text";

type KindRule = { kind: AssetKind; keywords: string[] };

// Ordered by specificity. "broker"/"brokerage"/"证券"/"股票" read investment;
// "crypto"/"BTC"/"ETH"/"USDT"/"交易所" read crypto. The heuristics' English
// tokens are what the user's institutions actually print; the Chinese tokens
// cover zh-Hans banking/crypto UIs.
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

// Precompiled matchers. `boundedPatternSource` owns the ASCII-gets-`\b` /
// CJK-gets-substring rule and the escaping that goes with it, so a keyword
// ending in punctuation ("usdt+") bounds itself correctly here instead of
// compiling to a pattern that can never fire.
const KIND_PATTERNS: { kind: AssetKind; patterns: RegExp[] }[] = KIND_RULES.map(
  (rule) => ({
    kind: rule.kind,
    patterns: rule.keywords.map(
      (kw) => new RegExp(boundedPatternSource(kw), "i"),
    ),
  }),
);

// The kind a piece of text indicates, or undefined when no keyword matches.
//
// Returning undefined rather than defaulting is what lets the caller fall back
// to the institution's own kind. That distinction matters: an account NAMED
// "保证金证券" really is an investment account, but the word 理财 sitting in a
// crypto exchange's navigation bar says nothing about the account — so the name
// is trusted and everything else defers to what the institution is.
export function detectAssetKind(text: string): AssetKind | undefined {
  const haystack = text.toLowerCase();
  for (const rule of KIND_PATTERNS) {
    if (rule.patterns.some((re) => re.test(haystack))) {
      return rule.kind;
    }
  }
  return undefined;
}
