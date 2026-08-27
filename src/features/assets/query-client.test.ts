import { describe, expect, it, vi } from "vitest";

import { exchangeRatesQueryPrefix } from "@/features/assets/exchange-rates-query";
import {
  deserializePersistedClient,
  queryClient,
  queryPersistOptions,
} from "@/features/assets/query-client";

// The persister writes through `kv-store`; none of the cases here exercise
// sqlite, only the envelope validation around it.
vi.mock("@/storage/kv-store", () => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
}));

const RATES = { SGD: 1, USD: 1.35, HKD: 0.17, CNY: 0.19 };

const persistedQuery = (queryKey: readonly unknown[], data: unknown) => ({
  queryKey,
  queryHash: JSON.stringify(queryKey),
  state: { data, dataUpdatedAt: 0 },
});

const snapshot = (queries: unknown[]) =>
  JSON.stringify({
    timestamp: 0,
    buster: "v1",
    clientState: { queries, mutations: [] },
  });

// What the persister calls on restore; the only hook that sees a snapshot
// before the cache does.
const deserialize = deserializePersistedClient;

const queriesIn = (raw: string): unknown[] =>
  deserialize(raw).clientState.queries;

describe("the query client defaults", () => {
  const defaults = queryClient.getDefaultOptions().queries;

  // Every one of these is non-default because the default fails silently. The
  // reasoning lives in `query-client.ts`; these pin the values so a change has
  // to be deliberate.
  it("keeps local-data queries off the online gate", () => {
    expect(defaults?.networkMode).toBe("always");
  });

  it("does not retry, so the home total never waits on backoff", () => {
    expect(defaults?.retry).toBe(0);
  });

  // Must be >= the persister's maxAge, or a query is garbage-collected out of
  // the cache before the snapshot holding it is considered stale.
  it("never garbage-collects, matching the persister's maxAge", () => {
    expect(defaults?.gcTime).toBe(Infinity);
    expect(queryPersistOptions.maxAge).toBe(Infinity);
  });

  it("leaves focus refetching to expo-router", () => {
    expect(defaults?.refetchOnWindowFocus).toBe(false);
  });
});

describe("deserialize", () => {
  it("restores a well-formed snapshot", () => {
    const raw = snapshot([
      persistedQuery([exchangeRatesQueryPrefix, "SGD"], RATES),
    ]);

    expect(queriesIn(raw)).toHaveLength(1);
  });

  // The rate table is the reason this hook exists. `fetchQuery` serves a fresh
  // cached entry WITHOUT calling `queryFn`, so a corrupt snapshot would reach
  // `convertCurrency` verbatim and produce NaN totals instead of "—".
  it.each([
    ["a rate table missing a currency", { SGD: 1, USD: 1.35 }],
    ["a negative rate", { ...RATES, USD: -1 }],
    ["a non-numeric rate", { ...RATES, USD: "1.35" }],
    ["a rate table that is not an object", "corrupt"],
    ["a null rate table", null],
  ])("drops %s", (_label, data) => {
    const raw = snapshot([
      persistedQuery([exchangeRatesQueryPrefix, "SGD"], data),
    ]);

    expect(queriesIn(raw)).toEqual([]);
  });

  // Not this filter's business: anything that is not a rate table is left
  // exactly as it was found.
  it("leaves a query under another key alone, whatever it holds", () => {
    const raw = snapshot([persistedQuery(["accounts"], { anything: true })]);

    expect(queriesIn(raw)).toHaveLength(1);
  });

  it("leaves an entry that does not look like a query alone", () => {
    const raw = snapshot([{ unexpected: "shape" }]);

    expect(queriesIn(raw)).toHaveLength(1);
  });

  // `JSON.stringify` drops an `undefined` property outright, so such an entry
  // no longer matches the query shape and is left alone. Harmless either way:
  // there is no rate table to be corrupt, and `shouldDehydrateQuery` never
  // writes a data-less query to disk in the first place.
  it("leaves a rate entry whose data key is absent alone", () => {
    const raw = snapshot([
      {
        queryKey: [exchangeRatesQueryPrefix, "SGD"],
        state: { dataUpdatedAt: 0 },
      },
    ]);

    expect(queriesIn(raw)).toHaveLength(1);
  });

  it("keeps the good rate entry while dropping the bad one", () => {
    const raw = snapshot([
      persistedQuery([exchangeRatesQueryPrefix, "SGD"], RATES),
      persistedQuery([exchangeRatesQueryPrefix, "HKD"], { SGD: 1 }),
    ]);

    expect(
      queriesIn(raw).map(
        (query) => (query as { queryKey: unknown[] }).queryKey[1],
      ),
    ).toEqual(["SGD"]);
  });

  // Throwing is the correct failure: `persistQueryClientRestore` wraps the
  // restore in a try and drops the cache, which is what an unreadable cache
  // deserves. Returning a half-built client would hydrate garbage.
  it.each([
    ["malformed JSON", "{not json"],
    ["a missing clientState", JSON.stringify({ timestamp: 0, buster: "v1" })],
    [
      "a clientState with no query array",
      JSON.stringify({
        timestamp: 0,
        buster: "v1",
        clientState: { mutations: [] },
      }),
    ],
  ])("throws on %s", (_label, raw) => {
    expect(() => deserialize(raw)).toThrow();
  });
});

describe("shouldDehydrateQuery", () => {
  const shouldDehydrate =
    queryPersistOptions.dehydrateOptions.shouldDehydrateQuery;

  // Accounts live in `asset-repository`'s versioned envelope. A second copy
  // here would be a second source of truth, written on a different schedule,
  // and a cold start would flash the older one.
  it("persists only the rate query", () => {
    const accountsQuery: {
      queryKey: readonly unknown[];
      state: { data: unknown };
    } = { queryKey: ["accounts"], state: { data: [] } };

    expect(
      shouldDehydrate({
        queryKey: [exchangeRatesQueryPrefix, "SGD"],
        state: { data: RATES },
      }),
    ).toBe(true);
    expect(shouldDehydrate(accountsQuery)).toBe(false);
  });

  // Broadened from the default `status === 'success'`: a query whose last
  // refresh failed is in 'error' while still serving the previous good rates,
  // and writes are whole-snapshot — so the default would ERASE the last known
  // rates from disk on the first write after a failed refresh.
  it("persists a query that still holds data after a failed refresh", () => {
    expect(
      shouldDehydrate({
        queryKey: [exchangeRatesQueryPrefix, "SGD"],
        state: { data: RATES },
      }),
    ).toBe(true);
  });

  it("skips a rate query that has never held data", () => {
    expect(
      shouldDehydrate({
        queryKey: [exchangeRatesQueryPrefix, "SGD"],
        state: { data: undefined },
      }),
    ).toBe(false);
  });
});
