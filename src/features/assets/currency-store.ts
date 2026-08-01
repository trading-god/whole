import { getItem, setItem } from "@/storage/kv-store";

import { type Currency, currencySchema } from "./currencies";

type CachedCurrencyStoreOptions = {
  // When true, the fallback is persisted on first launch so the value is
  // pinned across future locale changes. Used by the base currency, which must
  // stay stable so historical net-worth snapshots stay comparable; the display
  // currency is not pinned because, until the user picks one, it follows the
  // latest device locale.
  persistFallback?: boolean;
};

// A module-level-cached currency preference backed by the key-value store.
// `load` hydrates from storage (validating against the known currency list)
// and falls back to a locale-derived default; `save` writes and updates the
// cache. Extracted so the base- and display-currency stores share one
// cache/read/validate path instead of mirroring it.
//
// The fallback is cached only when it is also persisted: a pinned value is
// stable so caching is safe, but an unpinned fallback follows the locale and
// must be re-derived each load (caching it would freeze a stale locale).
export function createCachedCurrencyStore(
  key: string,
  { persistFallback = false }: CachedCurrencyStoreOptions = {},
) {
  let cached: Currency | null = null;

  async function load(fallback: Currency): Promise<Currency> {
    if (cached) {
      return cached;
    }

    const raw = await getItem(key);
    if (raw) {
      const parsed = currencySchema.safeParse(raw);
      if (parsed.success) {
        cached = parsed.data;
        return parsed.data;
      }
    }

    if (persistFallback) {
      // Persist before caching, matching `save` and the module's invariant
      // ("the fallback is cached only when it is also persisted"): a failed
      // write leaves `cached` null so the next load re-reads storage and
      // retries instead of pinning an unpersisted fallback. Without this, a
      // setItem failure would cache the fallback in memory, the base currency
      // would never be persisted, and a later launch under a different locale
      // would re-derive a different base while the migration marker still
      // names the old one — corrupting every snapshot with a wrong-factor
      // conversion.
      await setItem(key, fallback);
      cached = fallback;
    }
    return fallback;
  }

  async function save(currency: Currency): Promise<void> {
    await setItem(key, currency);
    // Update the cache only after persistence succeeds, so a failed write
    // leaves the cache matching storage instead of holding an unpersisted
    // value (mirrors saveAssetAccounts).
    cached = currency;
  }

  return { load, save };
}
