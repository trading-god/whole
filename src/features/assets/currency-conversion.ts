import { z } from "zod";

import { readJson, setItem } from "@/storage/kv-store";

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

// Schema for the persisted rate cache. Replaces the hand-written shape
// guards that used to live in `isValidRates`/`readStoredRates`: `safeParse`
// validates version, base, fetchedAt, and that every known currency has a
// non-negative rate (0 means "no data"). zod v4's `z.number()` rejects
// NaN/Infinity by default, so `.nonnegative()` alone matches the old
// `Number.isFinite(rate) && rate >= 0` guard. The requested base is matched
// against `base` after parsing, since it is a runtime argument.
const rateValueSchema = z.number().nonnegative();

// Exhaustive: `z.record` over an enum requires every member, so a cache
// written before a currency was added no longer parses and is refetched —
// which is exactly right for rates. (Same property `currencyAmountsSchema`
// relies on; there it means adding a currency needs a stored-data migration.)
const exchangeRatesSchema = z.record(currencySchema, rateValueSchema);

const storedRatesSchema = z.object({
  version: z.literal(2),
  base: currencySchema,
  rates: exchangeRatesSchema,
  fetchedAt: z.number(),
});

type StoredRates = z.infer<typeof storedRatesSchema>;

const RATES_STORAGE_KEY = "whole.exchangeRates";
// Frankfurter publishes ECB reference rates once per business day, so a few
// hours of staleness is immaterial. Refresh mid-day so a stale rate rarely
// survives past one trading session.
const RATES_CACHE_MS = 6 * 60 * 60 * 1000;

// Rates when no foreign-currency data is available yet: only the base currency
// is convertible. Foreign currencies get 0 (no data) so callers fall back to
// summing only base-currency balances (or, with direct conversion, balances
// already in the target currency).
function ratesForBaseOnly(base: Currency): ExchangeRates {
  return mapCurrencies((currency) => (currency === base ? 1 : 0));
}

async function readStoredRates(base: Currency): Promise<StoredRates | null> {
  try {
    const parsed = storedRatesSchema.safeParse(
      await readJson(RATES_STORAGE_KEY),
    );
    if (!parsed.success || parsed.data.base !== base) {
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

async function writeStoredRates(stored: StoredRates): Promise<void> {
  try {
    await setItem(RATES_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Caching is best-effort; a write failure just means a refetch next time.
  }
}

// Fetches fresh rates from Frankfurter (ECB reference rates, free, no API key).
// The API returns "1 base = apiRate foreign"; we invert to "base per foreign"
// so conversion is a single multiply. A timeout bounds the request so a dead
// endpoint can't block the home screen indefinitely.
async function fetchFreshRates(base: Currency): Promise<ExchangeRates> {
  const others = knownAssetCurrencies.filter((currency) => currency !== base);
  const symbols = others.join(",");
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);
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
    // result. Caching base-only rates for the TTL would pin every foreign-
    // currency total to "—" for hours; throwing lets `resolveExchangeRates`
    // fall back to the prior stored/memo rates and leaves the cache untouched
    // so the next focus retries.
    if (others.length > 0 && usableCount === 0) {
      throw new Error("Exchange rate response had no usable rates");
    }
    return rates;
  } finally {
    clearTimeout(timeoutId);
  }
}

let cachedRates: StoredRates | null = null;

// Resolves rates for `base`, preferring a fresh in-memory cache, then a fresh
// persisted cache, then a network fetch, then a stale copy, before falling back
// to base-only rates. `force` skips both freshness checks and goes straight to
// the network — the caches are still read, so a failed fetch can fall back to
// them rather than degrading a working screen to base-only rates. Never throws:
// a network failure degrades to summing only base-currency (or same-currency)
// balances.
async function resolveExchangeRates(
  base: Currency,
  force: boolean,
): Promise<ExchangeRates> {
  const now = Date.now();
  const memo = cachedRates && cachedRates.base === base ? cachedRates : null;

  if (!force && memo && now - memo.fetchedAt < RATES_CACHE_MS) {
    return memo.rates;
  }

  const stored = await readStoredRates(base);
  if (!force && stored && now - stored.fetchedAt < RATES_CACHE_MS) {
    cachedRates = stored;
    return stored.rates;
  }

  try {
    const rates = await fetchFreshRates(base);
    const fresh: StoredRates = { version: 2, base, rates, fetchedAt: now };
    cachedRates = fresh;
    await writeStoredRates(fresh);
    return rates;
  } catch {
    if (stored) {
      cachedRates = stored;
      return stored.rates;
    }
    // A forced refresh may hold a usable in-memory copy that `readStoredRates`
    // couldn't return (an unreadable store). Preferring it over base-only rates
    // keeps a pull-to-refresh from blanking totals that were converting a
    // moment ago.
    if (memo) {
      return memo.rates;
    }
    return ratesForBaseOnly(base);
  }
}

export function loadExchangeRates(base: Currency): Promise<ExchangeRates> {
  return resolveExchangeRates(base, false);
}

// Bypasses the cache TTL and refetches. Backs pull-to-refresh: the rates are
// the only figure on the home screen sourced from outside the device, so
// "refresh" means "ask the rate service again", not "re-read local storage".
export function refreshExchangeRates(base: Currency): Promise<ExchangeRates> {
  return resolveExchangeRates(base, true);
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
