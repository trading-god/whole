import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { QueryClient } from "@tanstack/react-query";
import { type PersistedClient } from "@tanstack/react-query-persist-client";
import { z } from "zod";

import { exchangeRatesSchema } from "@/features/assets/currency-conversion";
import { exchangeRatesQueryPrefix } from "@/features/assets/exchange-rates-query";
import { getItem, removeItem, setItem } from "@/storage/kv-store";

// The query cache and its disk persistence. This replaces the hand-rolled
// memo + persisted-cache + TTL + force-refetch ladder that used to live in
// `currency-conversion.ts`.
//
// Four of the five settings below are non-default, and each one is here because
// the default is wrong for this app in a way that fails SILENTLY. They are
// stated together so the reasoning survives; changing one without reading this
// block is how the exchange-rate fallback quietly stops working.

const QUERY_CACHE_STORAGE_KEY = "whole.queryCache";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // (1) Everything but the rate fetch reads local SQLite, where "is the
      // device online" is not a precondition. The default `online` mode would
      // park those queries in `fetchStatus: 'paused'` whenever RN's netinfo
      // reports offline — including when it simply has no opinion yet — and the
      // screen would sit on a spinner over data that is already on disk.
      networkMode: "always",
      // (2) The default is three silent retries with exponential backoff. The
      // rate fetch is explicitly "try once, then fall back to whatever we have"
      // — retrying pushes the home screen's total to "—" for seconds longer
      // while it waits on a failure the fallback already handles. The rate
      // query opts back into a single retry itself.
      retry: 0,
      // (3) Must be >= the persister's maxAge, or a query is garbage-collected
      // out of the cache before the snapshot that holds it is considered stale.
      // With maxAge Infinity (see below), this has to be Infinity too.
      gcTime: Infinity,
      // (4) Screen focus is driven explicitly through expo-router's
      // `useFocusEffect`. TanStack's focusManager tracks APP foreground state,
      // not which screen is on top, and its `setFocused(false)` also pauses
      // every retry process-wide — a heavier switch than it looks.
      refetchOnWindowFocus: false,
    },
  },
});

// The disk envelope. `kv-store`'s getItem/setItem/removeItem already match the
// persister's AsyncStorage interface field for field, so it is wired in
// directly rather than through an adapter.
const persistedClientSchema = z.looseObject({
  timestamp: z.number(),
  buster: z.string(),
  clientState: z.looseObject({
    queries: z.array(z.unknown()),
    mutations: z.array(z.unknown()),
  }),
});

// Just enough of a persisted query to route on: its key and its data. Anything
// that does not match this shape is left alone rather than dropped — it is not a
// rate table, so it is not this filter's business.
const persistedQuerySchema = z.looseObject({
  queryKey: z.array(z.unknown()),
  state: z.looseObject({ data: z.unknown() }),
});

export const queryPersister = createAsyncStoragePersister({
  storage: { getItem, setItem, removeItem },
  key: QUERY_CACHE_STORAGE_KEY,
  // The persister's default is a bare `JSON.parse`, which would hand a
  // half-written or hand-edited blob straight to the hydrator. Validating here
  // keeps this on the same footing as every other persisted shape in the app
  // (see the Validation section in AGENTS.md). Throwing is the correct failure:
  // `persistQueryClientRestore` wraps the whole restore in a try and drops the
  // cache, which is exactly what an unreadable cache deserves.
  deserialize: (raw) => {
    const restored = persistedClientSchema.parse(JSON.parse(raw));
    // Drop a rate table that no longer parses before it ever reaches the cache.
    // This is the only place it can be caught: `fetchQuery` and `useQuery` both
    // serve a cached entry WITHOUT calling `queryFn` while it is fresh, so a
    // truncated or hand-edited snapshot would otherwise be handed to
    // `convertCurrency` verbatim and produce NaN totals instead of the "—" that
    // means "no data". Dropping the entry makes the next read a cache miss,
    // which fetches.
    return {
      ...restored,
      clientState: {
        ...restored.clientState,
        queries: restored.clientState.queries.filter((query) => {
          const parsed = persistedQuerySchema.safeParse(query);
          if (
            !parsed.success ||
            parsed.data.queryKey[0] !== exchangeRatesQueryPrefix
          ) {
            return true;
          }
          return exchangeRatesSchema.safeParse(parsed.data.state.data).success;
        }),
      },
    } as PersistedClient;
  },
});

export const queryPersistOptions = {
  persister: queryPersister,
  // (5) The one that is easiest to get wrong. `maxAge` is NOT a per-query TTL —
  // it is a single timestamp on the whole snapshot, refreshed on every cache
  // write, and when it expires the persister calls `removeClient()` and throws
  // the ENTIRE cache away. Leaving it at the 24h default would mean a device
  // left unopened for a day comes back with no rates at all rather than stale
  // ones. Freshness is expressed per query by `staleTime`; this only decides
  // how long the file itself is worth reading, and the answer is "always".
  maxAge: Infinity,
  buster: "v1",
  dehydrateOptions: {
    // Two departures from the default, for opposite reasons.
    //
    // Restricted to the rate query: accounts are also cached in memory, but
    // `asset-repository` owns them on disk, in a versioned envelope with its own
    // migration chain. Persisting them here too would put the user's financial
    // data in sqlite TWICE, under two different schemas, written on two
    // different schedules — and a cold start would show the persister's older
    // copy for a frame before the repository's read replaced it. The rates are
    // the only thing here worth keeping across launches, because they are the
    // only thing that came from off-device.
    //
    // And broadened from `status === 'success'` to "holds data at all": a query
    // whose last refresh failed is in `'error'` while still serving the previous
    // good rates. Since writes are whole-snapshot, the default would let the
    // first cache write after a failed refresh ERASE the last known rates from
    // disk, leaving the next cold start with nothing to fall back to.
    shouldDehydrateQuery: (query: {
      queryKey: readonly unknown[];
      state: { data: unknown };
    }) =>
      query.queryKey[0] === exchangeRatesQueryPrefix &&
      query.state.data !== undefined,
  },
};
