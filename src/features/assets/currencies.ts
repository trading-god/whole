import { z } from "zod";

export const knownAssetCurrencies = ["SGD", "USD", "HKD", "CNY"] as const;

export type Currency = (typeof knownAssetCurrencies)[number];

// Schema for a known currency code. Owned here (alongside
// `knownAssetCurrencies`) so `asset-repository.ts`, `screenshot-recognition.ts`,
// `currency-conversion.ts`, and the currency preference stores validate against one
// definition instead of each re-declaring `z.enum(knownAssetCurrencies)` or a
// hand-written guard.
export const currencySchema = z.enum(knownAssetCurrencies);

// One figure per known currency. Backs the net-worth snapshot's per-currency
// totals and the capital-flow ledger, both of which have to answer "how much,
// read in this currency" without re-deriving it from a single base — an
// exchange-rate move makes those answers genuinely different.
//
// Exhaustive: `z.record` over an enum requires every member, so a record
// written before a currency was added no longer parses. Adding a currency to
// `knownAssetCurrencies` therefore needs a stored-data migration.
export const currencyAmountsSchema = z.record(currencySchema, z.number());

export type CurrencyAmounts = z.infer<typeof currencyAmountsSchema>;

// Builds a complete `Record<Currency, T>` by calling `value` once per known
// currency. Owned here alongside `knownAssetCurrencies` so the per-currency
// records the app writes — snapshot totals, the capital-flow ledger, and the
// exchange-rate table — are all built the same way, and the one cast that
// asserts exhaustiveness lives in a single place instead of being re-written
// (and re-trusted) per module. Adding a currency then only has to satisfy the
// stored-data migration noted above, not four hand-rolled loops.
export function mapCurrencies<T>(
  value: (currency: Currency) => T,
): Record<Currency, T> {
  return Object.fromEntries(
    knownAssetCurrencies.map((currency) => [currency, value(currency)]),
  ) as Record<Currency, T>;
}

// Whether `rates` can convert every known currency. Per-currency bookkeeping is
// all-or-nothing: recording a partial set would freeze capital at a rate of
// "no data" and permanently skew growth in the currencies that were missing.
export function amountsConvertible(rates: Record<Currency, number>): boolean {
  return knownAssetCurrencies.every((currency) => rates[currency] > 0);
}

// The display currency shown by default before the user picks one, derived
// from the device locale: Singapore (en-SG or zh-SG) → SGD, en-US → USD,
// other Simplified Chinese → CNY, Traditional Chinese → HKD, anything else →
// USD. The persistent base currency (exchange-rate base and net-worth snapshot
// unit) is also seeded from this on first launch; see base-currency-store. After
// first launch the base currency is pinned and no longer follows locale changes.
export function defaultDisplayCurrencyForLanguageTag(
  languageTag: string,
): Currency {
  if (
    languageTag.startsWith("zh-Hant") ||
    languageTag.startsWith("zh-TW") ||
    languageTag.startsWith("zh-HK") ||
    languageTag.startsWith("zh-MO")
  ) {
    return "HKD";
  }

  if (
    languageTag.startsWith("zh-Hans") ||
    languageTag.startsWith("zh-CN") ||
    languageTag === "zh"
  ) {
    return "CNY";
  }

  if (languageTag.startsWith("en-SG") || languageTag.startsWith("zh-SG")) {
    return "SGD";
  }

  // en-US, plain en, and any other language default to USD.
  return "USD";
}

// Display-currency option order: the locale-default currency first, then the
// rest alphabetically by ISO 4217 code.
export function orderedDisplayCurrencies(
  defaultCurrency: Currency,
): Currency[] {
  const others = knownAssetCurrencies
    .filter((currency) => currency !== defaultCurrency)
    .sort((a, b) => a.localeCompare(b));
  return [defaultCurrency, ...others];
}
