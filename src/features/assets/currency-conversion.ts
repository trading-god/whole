import { z } from "zod";

import {
  type Currency,
  currencySchema,
  knownAssetCurrencies,
  mapCurrencies,
} from "./currencies";

// Exchange rates expressed relative to a base currency: `rates[X]` is "how much
// of the base currency equals one unit of X", so converting X → base is a
// single multiply and base → X a single divide. The base currency always has
// rate 1. A rate of 0 means no conversion data is available for that currency
// (callers skip it rather than treating the balance as zero, which would skew
// totals and percentages). The base is the persistent base currency (see
// base-currency-store), not a fixed constant.
export type ExchangeRates = Record<Currency, number>;

// zod v4's `z.number()` rejects NaN/Infinity by default, so `.nonnegative()`
// alone matches the old `Number.isFinite(rate) && rate >= 0` guard.
const rateValueSchema = z.number().nonnegative();

// Exhaustive: `z.record` over an enum requires every member, so a cache written
// before a currency was added no longer parses and is refetched — which is
// exactly right for rates. (Same property `currencyAmountsSchema` relies on;
// there it means adding a currency needs a stored-data migration.)
export const exchangeRatesSchema = z.record(currencySchema, rateValueSchema);

// Rates when no foreign-currency data is available yet: only the base currency
// is convertible. Foreign currencies get 0 (no data) so callers fall back to
// summing only base-currency balances (or, with direct conversion, balances
// already in the target currency).
export function ratesForBaseOnly(base: Currency): ExchangeRates {
  return mapCurrencies((currency) => (currency === base ? 1 : 0));
}

// Fetches fresh rates from Frankfurter (ECB reference rates, free, no API key).
// The API returns "1 base = apiRate foreign"; we invert to "base per foreign"
// so conversion is a single multiply.
//
// The caching, staleness, and fallback ladder that used to wrap this all lives
// in `exchange-rates-query.ts` now — this function does one thing: ask the
// network, or throw. `signal` comes from the query so an in-flight request is
// aborted when the query is cancelled; the 10s timeout still bounds a server
// that accepts the connection and then goes quiet.
export async function fetchFreshRates(
  base: Currency,
  signal?: AbortSignal,
): Promise<ExchangeRates> {
  const others = knownAssetCurrencies.filter((currency) => currency !== base);
  const symbols = others.join(",");
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);
  // Abort on either trigger: the query cancelling, or the timeout firing.
  signal?.addEventListener("abort", () => controller.abort(), { once: true });
  try {
    const response = await fetch(
      `https://api.frankfurter.app/latest?from=${base}&to=${symbols}`,
      { signal: controller.signal },
    );
    if (!response.ok) {
      throw new Error(`Exchange rate request failed: ${response.status}`);
    }
    const data = (await response.json()) as { rates?: Record<string, number> };
    const rates = ratesForBaseOnly(base);
    let usableCount = 0;
    for (const currency of others) {
      const apiRate = data.rates?.[currency];
      if (isUsableRate(apiRate)) {
        rates[currency] = 1 / apiRate;
        usableCount += 1;
      }
    }
    // A 200 with no usable rates (a captive-portal JSON body, or a proxy that
    // dropped the `rates` field) is a failed fetch, not a fresh base-only
    // result. Caching base-only rates would pin every foreign-currency total to
    // "—" for the whole staleTime; throwing lets the query keep serving the
    // previous good rates and retry on the next focus.
    if (others.length > 0 && usableCount === 0) {
      throw new Error("Exchange rate response had no usable rates");
    }
    return rates;
  } finally {
    clearTimeout(timeoutId);
  }
}

// A rate is usable for conversion when it is a positive finite number. A rate
// of 0 means "no data" (see ExchangeRates); the guard also rejects NaN/Infinity
// so a malformed store can't produce NaN totals.
function isUsableRate(rate: unknown): rate is number {
  return typeof rate === "number" && Number.isFinite(rate) && rate > 0;
}

// Converts `amount` from currency `from` to currency `to` directly, without
// routing through an intermediate currency. Because all rates share one base,
// `amount * rates[from] / rates[to]` is the from→to cross rate; this is done
// per-account so totals never accumulate rounding error across a pivot
// currency. Returns null when either rate is unavailable (rates haven't loaded
// or fetch failed) so callers can skip the account instead of treating it as
// zero (which would understate totals and distort percentages). `from === to`
// short-circuits without consulting rates, so same-currency balances always
// convert even before rates load.
export function convertCurrency(
  amount: number,
  from: Currency,
  to: Currency,
  rates: ExchangeRates,
): number | null {
  if (from === to) {
    return amount;
  }
  const fromRate = rates[from];
  const toRate = rates[to];
  if (!isUsableRate(fromRate) || !isUsableRate(toRate)) {
    return null;
  }
  return (amount * fromRate) / toRate;
}
