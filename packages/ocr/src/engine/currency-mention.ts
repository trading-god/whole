// Currency detection for OCR text rows. The screen may show a symbol (`$`,
// `HK$`) or an ISO code (`SGD 1,234.56`); `currencyMention` locates the first
// such token so the amount parser can anchor a number to it.
//
// The ordinary display symbols (`HK$`, `S$`, `CN¥`, `$`) come from
// `CURRENCY_SYMBOLS` in currencies.ts — the same source `formatCurrency`
// uses — so the OCR scanner and display formatting can't drift. Two extra
// spellings real institution screens print but the app never displays are added
// as OCR-only aliases: `US$` (must be tested before `S$`, which it contains
// as a substring, else "US$ 200" would read as SGD) and a bare `¥` (CNY,
// since the display map only carries the disambiguating `CN¥`).
import {
  type Currency,
  CURRENCY_SYMBOLS,
  knownAssetCurrencies,
} from "../contract/currency";
import { escapeRegExp } from "../text";

// Symbol/alias spellings the OCR scanner recognizes beyond the display map.
// Kept explicit and ordered so `US$` is tested before `S$` (it contains it).
// CNH (offshore RMB) is normalized to CNY — in this app they are the same
// currency for account-recognition purposes; the amount lands as CNY and no
// new currency is introduced into the display schema.
const OCR_ONLY_SYMBOLS: { token: string; currency: Currency }[] = [
  { token: "US$", currency: "USD" },
  { token: "¥", currency: "CNY" },
];

// ISO aliases, not symbols: `CNH` is a real code some banks print (offshore
// RMB), treated as the same currency as CNY. Kept apart from the symbol list
// because it is spelled like a code and needs a code's letter boundaries — as a
// bare substring, any token containing "cnh" (a ticker, an OCR misread) became
// a CNY mention that `matchAmount` then anchored an amount to. Same reasoning
// as `ISO_CODE_PATTERNS` below, which exists so "USDT" is not a USD mention.
const OCR_ONLY_CODES: { code: string; currency: Currency }[] = [
  { code: "CNH", currency: "CNY" },
];

// The full symbol scan order: OCR-only aliases first, then the shared display
// symbols longest-first so multi-char tokens (`HK$`, `S$`, `CN¥`) win over
// their bare `$` prefix.
const SYMBOL_SCAN_ORDER = [
  ...OCR_ONLY_SYMBOLS,
  ...[...knownAssetCurrencies]
    .sort((a, b) => CURRENCY_SYMBOLS[b].length - CURRENCY_SYMBOLS[a].length)
    .map((code) => ({ token: CURRENCY_SYMBOLS[code], currency: code })),
];

// Precompiled once at module load: `currencyMention` runs per amount row, so
// rebuilding `new RegExp` per call per code is wasted work. Kept as a per-code
// list (not a combined alternation) so the loop still returns the first
// matching code in `knownAssetCurrencies` order.
// Bounded by LETTERS, not by `\b`. HSBC prints its balances with the code glued
// to the figure — "0.00HKD", "-1,745.52SGD" — and `\b` doesn't fire between a
// digit and a letter, so a word-boundary pattern missed every one of them and
// the balances came back with no currency at all.
//
// Letter boundaries still reject a code embedded in a longer word, which is
// what the boundary was for: "USDT" is a crypto ticker, not a USD mention.
const ISO_CODE_PATTERNS = [
  ...knownAssetCurrencies.map((code) => ({ code, currency: code as Currency })),
  ...OCR_ONLY_CODES.map(({ code, currency }) => ({ code, currency })),
].map(({ code, currency }) => ({
  code,
  currency,
  re: new RegExp(`(?<![A-Za-z])${code}(?![A-Za-z])`, "i"),
}));

// The symbol scan, precompiled the same way and for the same reason. Case
// -insensitive patterns over the ORIGINAL text rather than `indexOf` over an
// uppercased copy: `toUpperCase` is not length-preserving (ﬁ→FI, ß→SS, and
// Apple Vision does emit those ligatures), so an index taken from the uppercased
// string can land a character off in the string the callers actually hold —
// which maps a fused currency symbol onto the neighbouring token.
const SYMBOL_PATTERNS = SYMBOL_SCAN_ORDER.map(({ token, currency }) => ({
  token,
  currency,
  re: new RegExp(escapeRegExp(token), "i"),
}));

// Currency names as Chinese-language institution apps print them. A zh-Hans/
// zh-Hant screen names the currency in words instead of a symbol or ISO code
// ("港元 1,212.52", "美元 5,673.53"), so without these an entire screenshot's
// balances have no currency and get dropped.
//
// Overlapping names resolve correctly for free: `currencyMention` keeps the
// EARLIEST match, and every compound name starts before the 元 it contains —
// in "新加坡元", 新 sits three characters ahead of 元.
//
// A bare 元 is deliberately NOT listed. It is the generic word for "unit of
// money" and appears in ordinary UI copy ("日享约2.21元"), where reading it as
// a currency would invent a balance out of a marketing line. A screen whose
// only currency signal is a bare 元 falls back to the institution's own
// currency instead (`defaultCurrency` in InstitutionConfig).
const CJK_CURRENCY_PATTERNS: { re: RegExp; currency: Currency }[] = [
  { re: /港元|港幣|港币/, currency: "HKD" },
  { re: /美元|美金/, currency: "USD" },
  { re: /新加坡元|新幣|新币/, currency: "SGD" },
  { re: /人民幣|人民币/, currency: "CNY" },
];

// The currency a token names in Chinese words at its START — "港元储蓄",
// "美元储蓄", "人民币储蓄". A zh-Hans/zh-Hant sub-account row labels itself this
// way and then prints a bare figure, so without this the figure had no currency
// of its own: on an institution with a `defaultCurrency` it was silently
// denominated in the WRONG one (HSBC HK prints 美元储蓄 beside 港元储蓄, and
// both came back HKD unless the OCR happened to fuse an ISO code onto the
// figure), and on one without, the money was dropped.
//
// Anchored at the start, and CJK names only. That is what separates a row that
// IS a currency's sub-account from a row that merely mentions one: a card named
// "汇丰Pulse银联双币钻石卡-人民币" says 人民币 at the END, and marketing copy
// ("3.51亿美元的") says it mid-sentence — denominating either row's figures by
// that mention would invent a balance in a currency the account doesn't hold.
// ISO codes and symbols are excluded because they are not word-bounded here:
// "USDT" starts with "USD", and a crypto screen is full of them.
export function leadingCurrencyName(text: string): Currency | undefined {
  const trimmed = text.trim();
  return CJK_CURRENCY_PATTERNS.find(({ re }) => {
    const m = re.exec(trimmed);
    return m?.index === 0;
  })?.currency;
}

// The first currency mention in `text`: its index, which currency, and the
// exact spelling found (ISO code, OCR-only token, or display symbol). Tells
// the amount parser WHERE the currency sits and HOW it's spelled, so it can
// anchor the amount to it — a row like "360 Account $5,000.00" must read
// $5,000, not the name's leading "360".
export function currencyMention(
  text: string,
): { index: number; currency: Currency; token: string } | undefined {
  let best: { index: number; currency: Currency; token: string } | undefined;
  const consider = (index: number, currency: Currency, token: string) => {
    if (index !== -1 && (!best || index < best.index)) {
      best = { index, currency, token };
    }
  };
  for (const { code, currency, re } of ISO_CODE_PATTERNS) {
    const m = re.exec(text);
    consider(m?.index ?? -1, currency, m?.[0] ?? code);
  }
  for (const { token, currency, re } of SYMBOL_PATTERNS) {
    const m = re.exec(text);
    consider(m?.index ?? -1, currency, m?.[0] ?? token);
  }
  // Chinese currency names. The matched text is reported as the token so the
  // amount parser can anchor to it the same way it anchors to "SGD" or "S$".
  for (const { re, currency } of CJK_CURRENCY_PATTERNS) {
    const m = re.exec(text);
    if (m) {
      consider(m.index, currency, m[0]);
    }
  }
  return best;
}
