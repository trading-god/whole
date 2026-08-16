import { queryOptions } from "@tanstack/react-query";

import { type Currency } from "@/features/assets/currencies";
import { fetchFreshRates } from "@/features/assets/currency-conversion";

// Frankfurter publishes ECB reference rates once per business day, so a few
// hours of staleness is immaterial. Refreshing mid-day means a stale rate rarely
// survives past one trading session.
const RATES_STALE_MS = 6 * 60 * 60 * 1000;

// The key's leading segment, exported on its own so callers can match every
// base at once (`refetchQueries({ queryKey: [exchangeRatesQueryPrefix] })`).
// Passing the key *builder* by mistake type-checks — `queryKey` is
// `unknown[]` — and silently matches nothing.
export const exchangeRatesQueryPrefix = "exchangeRates";

export function exchangeRatesQueryKey(base: Currency) {
  return [exchangeRatesQueryPrefix, base] as const;
}

// The base is part of the key, not just an argument the fetcher closes over.
// That is what makes a base change fetch its own entry instead of serving the
// previous base's rates under the new one — the bug the old code avoided by
// hand, by comparing `stored.base !== base` on every read.
export function exchangeRatesQueryOptions(base: Currency) {
  return queryOptions({
    queryKey: exchangeRatesQueryKey(base),
    queryFn: ({ signal }) => fetchFreshRates(base, signal),
    staleTime: RATES_STALE_MS,
    gcTime: Infinity,
    // The one query that talks to the network, so it is also the only one that
    // should wait for a connection rather than fail fast against `always`.
    networkMode: "online",
    // One retry, against the client default of none: a single dropped request
    // on a flaky mobile connection is worth one more try, three is not (the
    // fallback below is already good).
    retry: 1,
  });
}
