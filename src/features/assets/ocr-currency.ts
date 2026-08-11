// Currency detection for OCR text rows. The screen may show a symbol (`$`,
// `HK$`) or an ISO code (`SGD 1,234.56`); `currencyMention` locates the first
// such token so the amount parser can anchor a number to it.
//
// The ordinary display symbols (`HK$`, `S$`, `CN¥`, `$`) come from
// `CURRENCY_SYMBOLS` in currencies.ts — the same source `formatCurrency`
// uses — so the OCR scanner and display formatting can't drift. Two extra
// spellings real bank screens print but the app never displays are added
// as OCR-only aliases: `US$` (must be tested before `S$`, which it contains
// as a substring, else "US$ 200" would read as SGD) and a bare `¥` (CNY,
// since the display map only carries the disambiguating `CN¥`).
import {
  type Currency,
  CURRENCY_SYMBOLS,
  knownAssetCurrencies,
} from "./currencies";

// Symbol spellings the OCR scanner recognizes beyond the display map. Kept
// explicit and ordered so `US$` is tested before `S$` (it contains it).
const OCR_ONLY_SYMBOLS: { token: string; currency: Currency }[] = [
  { token: "US$", currency: "USD" },
  { token: "¥", currency: "CNY" },
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
const ISO_CODE_PATTERNS = knownAssetCurrencies.map((code) => ({
  code,
  re: new RegExp(`\\b${code}\\b`),
}));

// The first currency mention in `text`: its index, which currency, and the
// exact spelling found (ISO code, OCR-only token, or display symbol). Tells
// the amount parser WHERE the currency sits and HOW it's spelled, so it can
// anchor the amount to it — a row like "360 Account $5,000.00" must read
// $5,000, not the name's leading "360".
export function currencyMention(
  text: string,
): { index: number; currency: Currency; token: string } | undefined {
  const upper = text.toUpperCase();
  let best: { index: number; currency: Currency; token: string } | undefined;
  const consider = (index: number, currency: Currency, token: string) => {
    if (index !== -1 && (!best || index < best.index)) {
      best = { index, currency, token };
    }
  };
  for (const { code, re } of ISO_CODE_PATTERNS) {
    const m = re.exec(upper);
    consider(m?.index ?? -1, code, code);
  }
  for (const { token, currency } of SYMBOL_SCAN_ORDER) {
    consider(upper.indexOf(token), currency, token);
  }
  return best;
}
