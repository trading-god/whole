import { z } from "zod";

import { getItem, setItem } from "@/storage/kv-store";

type CachedPreferenceStoreOptions = {
  // When true, the fallback is persisted the first time it is used, pinning the
  // value against later changes in whatever derived it. The base currency needs
  // this so historical net-worth snapshots stay comparable; the display
  // currency does not, because until the user picks one it should keep
  // following the device locale.
  persistFallback?: boolean;
};

// A module-level-cached user preference backed by the key-value store. `load`
// hydrates from storage and validates against `schema`, falling back to the
// caller's default; `save` writes and updates the cache. The value is stored as
// its own string, so `schema` has to parse one — every preference so far is a
// small enum (currency, chart range).
//
// Owned here so each preference is a call site rather than a re-derivation of
// the same cache/read/validate/write path. In particular the cache is updated
// only after a write succeeds, so a failed write leaves memory matching storage
// instead of holding a value that was never persisted (mirrors
// saveAssetAccounts) — an invariant worth stating once.
//
// The fallback is cached only when it is also persisted: a pinned value is
// stable so caching it is safe, but an unpinned fallback may be derived from
// something that changes (the device locale) and has to be re-derived per load.
export function createCachedPreferenceStore<Value extends string>(
  key: string,
  schema: z.ZodType<Value>,
  { persistFallback = false }: CachedPreferenceStoreOptions = {},
) {
  let cached: Value | null = null;

  async function load(fallback: Value): Promise<Value> {
    if (cached !== null) {
      return cached;
    }

    const raw = await getItem(key);
    if (raw !== null) {
      const parsed = schema.safeParse(raw);
      if (parsed.success) {
        cached = parsed.data;
        return parsed.data;
      }
    }

    if (persistFallback) {
      // Persist before caching, matching `save` and the invariant above: a
      // failed write leaves `cached` null so the next load re-reads storage and
      // retries instead of pinning an unpersisted fallback. Without this, a
      // setItem failure would cache the fallback in memory, the base currency
      // would never be persisted, and a later launch under a different locale
      // would re-derive a different base while the migration marker still names
      // the old one — corrupting every snapshot with a wrong-factor conversion.
      await setItem(key, fallback);
      cached = fallback;
    }
    return fallback;
  }

  async function save(value: Value): Promise<void> {
    await setItem(key, value);
    cached = value;
  }

  return { load, save };
}
