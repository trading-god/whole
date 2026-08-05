import { createCachedPreferenceStore } from "@/storage/cached-preference-store";

import { currencySchema } from "./currencies";

const BASE_CURRENCY_KEY = "whole.baseCurrency";

// The base currency is the exchange-rate base and the unit net-worth snapshots
// are stored in. It is seeded once from the device locale (via
// defaultDisplayCurrencyForLanguageTag) on first launch, then persisted so it
// never changes again — even if the device language later changes — keeping
// historical snapshots comparable. `fallback` is the locale-derived default.
const baseCurrencyStore = createCachedPreferenceStore(
  BASE_CURRENCY_KEY,
  currencySchema,
  { persistFallback: true },
);

export const loadBaseCurrency = baseCurrencyStore.load;
