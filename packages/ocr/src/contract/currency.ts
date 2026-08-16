// The currency vocabulary the recognizer and the app share.
//
// This lives in `@whole/ocr` rather than in the app because the OCR engine has
// to answer "is this token a currency, and which one" without importing
// anything from the app — but the answer must be the SAME set of currencies the
// app can store and display, or the recognizer would read a currency the form
// can't hold. The app re-exports these from
// `src/features/assets/currencies.ts` alongside its locale/formatting helpers,
// so there is one definition and app code keeps its existing import path.
import { z } from "zod";

export const knownAssetCurrencies = ["SGD", "USD", "HKD", "CNY"] as const;

export type Currency = (typeof knownAssetCurrencies)[number];

// Standard (ISO 4217) display symbols per currency. Intl's currency-symbol
// resolution can fall back to the ISO code on Hermes (e.g. "SGD" instead of
// "S$" when the currency isn't the locale's own), so the app formats the
// symbol explicitly; CN¥ disambiguates CNY from JPY (also ¥). Single source of
// truth for the currency↔symbol mapping, shared by `formatCurrency` (i18n) and
// the OCR currency scanner, so adding a currency updates both in one place.
export const CURRENCY_SYMBOLS: Record<Currency, string> = {
  SGD: "S$",
  USD: "$",
  HKD: "HK$",
  CNY: "CN¥",
};

// Schema for a known currency code. Owned here (alongside
// `knownAssetCurrencies`) so the parser, `asset-repository.ts`,
// `currency-conversion.ts`, and the currency preference stores validate against
// one definition instead of each re-declaring `z.enum(knownAssetCurrencies)` or
// a hand-written guard.
export const currencySchema = z.enum(knownAssetCurrencies);

// Membership test for hot paths. `currencySchema.safeParse` allocates and
// formats a full `ZodError` on every miss, and the token classifier asks this
// question of EVERY OCR token — where >95% of the answers are "no". That one
// call profiled as ~40% of the whole parser's CPU; a `Set` lookup is ~400×
// cheaper and, being derived from `knownAssetCurrencies`, cannot disagree with
// the schema. Use the schema where the answer is needed a handful of times per
// screenshot; use this where it is needed per token.
const CURRENCY_CODES: ReadonlySet<string> = new Set(knownAssetCurrencies);

export function isCurrencyCode(value: string): value is Currency {
  return CURRENCY_CODES.has(value);
}

// ISO-4217 codes a screen might print that this app has no currency for.
//
// The recognizer needs this to tell "a figure in a currency I cannot store"
// from "a figure with no currency stated" — the second inherits the account's
// currency, and treating the first as the second put yen into a Hong Kong
// dollar balance. A CMB Wing Lung screen listing "日股•日元 JPY 0.00" beside an
// HKD account was one non-zero figure away from exactly that. It lives here,
// beside `knownAssetCurrencies`, because it is
// the same question from the other side: adding a currency to that list must
// remove it from this one, and a second hand-maintained list in the engine
// would have to be edited in step or silently keep dropping the new currency.
//
// An explicit list, not "any three capitals": institution abbreviations and
// tickers are the same shape, and a guard on shape alone threw away the balance
// on rows like "DBS S$1,234.56" — losing real money to avoid mis-denominating
// it. Add a code here when a screen is found printing it.
const OTHER_ISO_CODES = [
  "JPY",
  "EUR",
  "GBP",
  "AUD",
  "CAD",
  "CHF",
  "NZD",
  "KRW",
  "INR",
  "THB",
  "MYR",
  "IDR",
  "PHP",
  "VND",
  "TWD",
  "MOP",
  "AED",
  "SAR",
  "ZAR",
  "SEK",
  "NOK",
  "DKK",
  "RUB",
  "BRL",
  "MXN",
  "TRY",
  "PLN",
  "CZK",
  "HUF",
  "ILS",
] as const;

const UNSTORABLE_CURRENCY_CODES: ReadonlySet<string> = new Set(
  OTHER_ISO_CODES.filter((code) => !CURRENCY_CODES.has(code)),
);

// A currency token as an OCR engine hands it over, cleaned for comparison.
//
// Screens glue a stray glyph onto a currency code — a dropdown chevron reads as
// "SGD、", a separator as "UsD、" — and a card row splits its sign off as part
// of the symbol ("-S$"). Both are removed here so every question about a
// currency token asks it of the same string. They were not: the token
// classifier cleaned the token and `isUnstorableCurrencyCode` did not, so
// "JPY、" was neither a currency nor unstorable, and a yen figure was banked as
// the account's own currency with the glyphed code taken as its NAME.
export function normalizeCurrencyToken(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^\p{L}\p{N}$¥€£]+$/u, "")
    .replace(/^-/, "");
}

// Whether `value` is a currency code this app knows of but cannot store.
export function isUnstorableCurrencyCode(value: string): boolean {
  const token = value.trim();
  // Case-SENSITIVE on the letters, because several of these codes spell
  // ordinary English words: "Try", "Cad", "Php", "Mop", "Sar", "Chf", "Nok",
  // "Ils", "Aed", "Inr". Matched case-insensitively, a promo row ("Try now")
  // clustered onto a balance row read as a currency and the account's money was
  // dropped. A screen printing a real code prints it in caps.
  if (token !== token.toUpperCase()) {
    return false;
  }
  return UNSTORABLE_CURRENCY_CODES.has(normalizeCurrencyToken(token));
}

// Whether `value` CARRIES such a code — the token is the code, or a figure with
// it glued on ("0.00JPY", the way HSBC prints codes). The glued form reaches the
// same two questions as the bare one: it contributes no balance, and it is not
// part of an account's name.
// Case-sensitive for the same reason as `isUnstorableCurrencyCode` above.
const FUSED_UNSTORABLE_RE = new RegExp(
  `(?:^|[^A-Za-z])(${[...UNSTORABLE_CURRENCY_CODES].join("|")})(?![A-Za-z])`,
);

export function carriesUnstorableCurrency(value: string): boolean {
  return FUSED_UNSTORABLE_RE.test(value.trim());
}
