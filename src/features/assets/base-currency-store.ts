import { createCachedCurrencyStore } from "./currency-store";

const BASE_CURRENCY_KEY = "whole.baseCurrency";

// The base currency is the exchange-rate base and the unit net-worth snapshots
// are stored in. It is seeded once from the device locale (via
// defaultDisplayCurrencyForLanguageTag) on first launch, then persisted so it
// never changes again — even if the device language later changes — keeping
// historical snapshots comparable. `fallback` is the locale-derived default.
//
// Callers MUST wait for i18n hydration (useAppLocale().isHydrated) before
// calling: on web, the pre-hydration languageTag falls back to "en-SG" (SGD),
// and pinning that as the base would be wrong.
const baseCurrencyStore = createCachedCurrencyStore(BASE_CURRENCY_KEY, {
  persistFallback: true,
});

export const loadBaseCurrency = baseCurrencyStore.load;
