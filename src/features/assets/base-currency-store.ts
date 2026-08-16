import { queryOptions } from "@tanstack/react-query";

import { createCachedPreferenceStore } from "@/storage/cached-preference-store";

import { type Currency, currencySchema } from "./currencies";

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

// The query form, so the rate query can declare the base as a dependency
// (`enabled: base !== undefined`) instead of the screen sequencing the two reads
// by hand. It never goes stale: the value is pinned on first launch and must not
// change afterwards, or historical snapshots stop being comparable.
//
// It lives here rather than beside the rate query because reaching storage makes
// it impure — the rate query stays free of React Native imports so it can be
// tested under plain Node.
export function baseCurrencyQueryOptions(fallback: Currency) {
  return queryOptions({
    queryKey: ["baseCurrency", fallback] as const,
    queryFn: () => loadBaseCurrency(fallback),
    staleTime: Infinity,
    gcTime: Infinity,
    networkMode: "always",
  });
}
