import { createCachedPreferenceStore } from "@/storage/cached-preference-store";

import { currencySchema } from "./currencies";

const DISPLAY_CURRENCY_KEY = "whole.displayCurrency";

// `fallback` is the locale-derived default (see
// defaultDisplayCurrencyForLanguageTag) used when the user hasn't picked a
// currency yet. Unlike the base currency it is not pinned on first launch:
// until the user chooses one it follows the latest device locale.
const displayCurrencyStore = createCachedPreferenceStore(
  DISPLAY_CURRENCY_KEY,
  currencySchema,
);

export const loadDisplayCurrency = displayCurrencyStore.load;
export const saveDisplayCurrency = displayCurrencyStore.save;
