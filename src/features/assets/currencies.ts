import { z } from "zod";

export const knownAssetCurrencies = ["SGD", "USD", "HKD", "CNY"] as const;

export type Currency = (typeof knownAssetCurrencies)[number];

// Schema for a known currency code. Owned here (alongside
// `knownAssetCurrencies`) so `asset-repository.ts`, `screenshot-recognition.ts`,
// `currency-conversion.ts`, and `currency-store.ts` validate against one
// definition instead of each re-declaring `z.enum(knownAssetCurrencies)` or a
// hand-written guard.
export const currencySchema = z.enum(knownAssetCurrencies);

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
