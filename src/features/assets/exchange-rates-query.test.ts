import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  exchangeRatesQueryKey,
  exchangeRatesQueryOptions,
  exchangeRatesQueryPrefix,
} from "@/features/assets/exchange-rates-query";

// The rate cache used to be ~120 hand-written lines of memo + persisted cache +
// TTL + multi-level fallback, with no tests. TanStack owns that ladder now, but
// the CONTRACT is still ours and it is the part that fails silently: totals stop
// converting, or a cached rate quietly disappears. Each case pins one rung.

function ratesResponse(rates: Record<string, number>) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ rates }),
  } as Response;
}

// retryDelay 0 keeps failures instant — the rate query asks for one retry, and
// the default backoff would add a second of real time to each case.
function testClient() {
  return new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
}

function ratesOf(client: QueryClient, base: "SGD" | "USD") {
  return client.getQueryData<Record<string, number>>(
    exchangeRatesQueryKey(base),
  );
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the exchange-rate query", () => {
  it("inverts the API's rates into base-per-foreign", async () => {
    // The API answers "1 SGD = 5.6 CNY"; conversion wants "how much SGD is one
    // CNY", so the stored figure has to be 1/5.6. Getting this backwards still
    // produces plausible-looking totals, just wrong by a square factor.
    fetchMock.mockResolvedValue(ratesResponse({ CNY: 5.6 }));
    const client = testClient();

    await client.fetchQuery(exchangeRatesQueryOptions("SGD"));

    expect(ratesOf(client, "SGD")?.SGD).toBe(1);
    expect(ratesOf(client, "SGD")?.CNY).toBeCloseTo(1 / 5.6, 10);
  });

  it("serves the cached rates within the staleness window", async () => {
    fetchMock.mockResolvedValue(ratesResponse({ CNY: 5.6 }));
    const client = testClient();

    await client.fetchQuery(exchangeRatesQueryOptions("SGD"));
    await client.fetchQuery(exchangeRatesQueryOptions("SGD"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the last good rates when a refresh fails", async () => {
    // The whole point of the fallback: a failed refresh degrades to stale data,
    // never to "no data" — which would blank every foreign-currency total.
    const client = testClient();
    fetchMock.mockResolvedValue(ratesResponse({ CNY: 5.6 }));
    await client.fetchQuery(exchangeRatesQueryOptions("SGD"));

    fetchMock.mockRejectedValue(new Error("offline"));
    await client.refetchQueries({ queryKey: [exchangeRatesQueryPrefix] });

    expect(ratesOf(client, "SGD")?.CNY).toBeCloseTo(1 / 5.6, 10);
  });

  it("holds no rates at all when the very first fetch fails", async () => {
    // The screen's own fallback (`ratesForBaseOnly`) covers this case; what
    // matters here is that nothing bogus is cached in its place.
    fetchMock.mockRejectedValue(new Error("offline"));
    const client = testClient();

    await client
      .fetchQuery(exchangeRatesQueryOptions("SGD"))
      .catch(() => undefined);

    expect(ratesOf(client, "SGD")).toBeUndefined();
  });

  it("treats a 200 with no usable rates as a failure", async () => {
    // A captive portal or a proxy that drops the `rates` field answers 200 with
    // a body that parses. Caching that would pin every foreign total to "—" for
    // the full six hours.
    fetchMock.mockResolvedValue(ratesResponse({}));
    const client = testClient();

    await client
      .fetchQuery(exchangeRatesQueryOptions("SGD"))
      .catch(() => undefined);

    expect(ratesOf(client, "SGD")).toBeUndefined();
  });

  it("keeps each base in its own cache entry", async () => {
    // The base is part of the queryKey. If it were only closed over by the
    // fetcher, a base switch would be served the previous base's rates — the
    // bug the old code prevented by hand with `stored.base !== base`.
    const client = testClient();
    fetchMock.mockResolvedValue(ratesResponse({ CNY: 5.6 }));
    await client.fetchQuery(exchangeRatesQueryOptions("SGD"));

    fetchMock.mockResolvedValue(ratesResponse({ CNY: 0.72 }));
    await client.fetchQuery(exchangeRatesQueryOptions("USD"));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(ratesOf(client, "SGD")).not.toStrictEqual(ratesOf(client, "USD"));
  });

  it("is reachable by prefix, so a refresh can hit every base at once", async () => {
    // `refetchQueries({ queryKey: [prefix] })` is how pull-to-refresh and the
    // focus effect reach the rates. Passing the key BUILDER instead of the
    // prefix type-checks (queryKey is unknown[]) and silently matches nothing,
    // so this asserts the match actually happens.
    const client = testClient();
    fetchMock.mockResolvedValue(ratesResponse({ CNY: 5.6 }));
    await client.fetchQuery(exchangeRatesQueryOptions("SGD"));

    await client.refetchQueries({ queryKey: [exchangeRatesQueryPrefix] });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
