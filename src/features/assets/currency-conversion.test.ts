import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type ExchangeRates,
  convertCurrency,
  convertCurrencyOrThrow,
  exchangeRatesSchema,
  fetchFreshRates,
  ratesForBaseOnly,
} from "@/features/assets/currency-conversion";

// "base per foreign": one USD is 1.35 SGD, one HKD is 0.17 SGD.
const RATES: ExchangeRates = { SGD: 1, USD: 1.35, HKD: 0.17, CNY: 0.19 };

describe("ratesForBaseOnly", () => {
  it("gives the base a rate of 1 and every other currency no data", () => {
    expect(ratesForBaseOnly("HKD")).toEqual({
      SGD: 0,
      USD: 0,
      HKD: 1,
      CNY: 0,
    });
  });
});

describe("exchangeRatesSchema", () => {
  it("accepts a complete rate table", () => {
    expect(exchangeRatesSchema.parse(RATES)).toEqual(RATES);
  });

  // Exhaustive by construction: a cache written before a currency was added no
  // longer parses, so it is refetched rather than served with a hole in it.
  it("rejects a table missing a currency", () => {
    expect(
      exchangeRatesSchema.safeParse({ SGD: 1, USD: 1.35, HKD: 0.17 }).success,
    ).toBe(false);
  });

  // zod v4 rejects NaN and Infinity by default, which is what keeps a corrupt
  // snapshot from turning into NaN totals.
  it.each([
    ["a negative rate", { ...RATES, USD: -1 }],
    ["NaN", { ...RATES, USD: Number.NaN }],
    ["Infinity", { ...RATES, USD: Number.POSITIVE_INFINITY }],
  ])("rejects %s", (_label, table) => {
    expect(exchangeRatesSchema.safeParse(table).success).toBe(false);
  });

  // 0 is legal and MEANS "no data" — it is how `ratesForBaseOnly` reports an
  // unavailable currency, so the schema has to let it through.
  it("accepts zero, which means no data", () => {
    expect(exchangeRatesSchema.safeParse({ ...RATES, USD: 0 }).success).toBe(
      true,
    );
  });
});

describe("convertCurrency", () => {
  // Short-circuits without consulting rates, so a same-currency balance
  // converts even before any rates have loaded.
  it("returns the amount unchanged when the currencies match", () => {
    expect(convertCurrency(100, "USD", "USD", ratesForBaseOnly("SGD"))).toBe(
      100,
    );
  });

  it("converts to the base currency with one multiply", () => {
    expect(convertCurrency(100, "USD", "SGD", RATES)).toBeCloseTo(135, 10);
  });

  it("converts from the base currency with one divide", () => {
    expect(convertCurrency(135, "SGD", "USD", RATES)).toBeCloseTo(100, 10);
  });

  // Directly, not through the base: routing every account through a pivot
  // accumulates rounding error across a portfolio.
  it("converts between two foreign currencies directly", () => {
    expect(convertCurrency(100, "USD", "HKD", RATES)).toBeCloseTo(
      (100 * 1.35) / 0.17,
      10,
    );
  });

  it("carries the sign through, so a debt stays a debt", () => {
    expect(convertCurrency(-4766.92, "USD", "SGD", RATES)).toBeCloseTo(
      -4766.92 * 1.35,
      10,
    );
  });

  // null, never 0. Substituting zero would understate the total and distort
  // every percentage on the home screen.
  it.each([
    ["the source", { ...RATES, USD: 0 }, "USD" as const, "SGD" as const],
    ["the target", { ...RATES, HKD: 0 }, "USD" as const, "HKD" as const],
  ])("returns null when %s currency has no data", (_label, rates, from, to) => {
    expect(convertCurrency(100, from, to, rates)).toBeNull();
  });

  it("returns null rather than NaN for a corrupt rate", () => {
    expect(
      convertCurrency(100, "USD", "SGD", { ...RATES, USD: Number.NaN }),
    ).toBeNull();
  });
});

// The single place the "rates are already complete" precondition is asserted.
// It exists so the callers that established that precondition stop each
// carrying a dead `?? 0` branch — one that would have silently booked capital
// at zero had the precondition ever broken.
describe("convertCurrencyOrThrow", () => {
  it("converts exactly as convertCurrency does", () => {
    expect(convertCurrencyOrThrow(100, "USD", "SGD", RATES)).toBeCloseTo(
      135,
      10,
    );
  });

  it("throws instead of returning null when a rate is missing", () => {
    expect(() =>
      convertCurrencyOrThrow(100, "USD", "SGD", { ...RATES, USD: 0 }),
    ).toThrow("No exchange rate available for USD to SGD");
  });
});

describe("fetchFreshRates", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const respondWith = (body: unknown, ok = true, status = 200) => {
    fetchMock.mockResolvedValue({
      ok,
      status,
      json: async () => body,
    } as Response);
  };

  it("asks for every currency except the base", async () => {
    respondWith({ rates: { USD: 0.74, HKD: 5.8, CNY: 5.3 } });

    await fetchFreshRates("SGD");

    const [url] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toContain("from=SGD");
    expect(String(url)).toContain("to=USD,HKD,CNY");
  });

  // The API answers "1 base = apiRate foreign"; the app stores "base per
  // foreign" so conversion is a single multiply.
  it("inverts the API rates and pins the base at 1", async () => {
    respondWith({ rates: { USD: 0.74, HKD: 5.8, CNY: 5.3 } });

    const rates = await fetchFreshRates("SGD");

    expect(rates.SGD).toBe(1);
    expect(rates.USD).toBeCloseTo(1 / 0.74, 10);
    expect(rates.HKD).toBeCloseTo(1 / 5.8, 10);
  });

  it("leaves a currency the API omitted at no-data", async () => {
    respondWith({ rates: { USD: 0.74 } });

    const rates = await fetchFreshRates("SGD");

    expect(rates.USD).toBeCloseTo(1 / 0.74, 10);
    expect(rates.HKD).toBe(0);
  });

  it("throws on a non-OK response", async () => {
    respondWith({}, false, 503);

    await expect(fetchFreshRates("SGD")).rejects.toThrow("503");
  });

  // A 200 with nothing usable — a captive portal's JSON, or a proxy that ate
  // the `rates` field. Caching base-only rates here would pin every foreign
  // total to "—" for the whole staleTime; throwing keeps the previous good
  // rates serving and retries on the next focus.
  it.each([
    ["an empty rate table", { rates: {} }],
    ["a missing rates field", {}],
    ["rates that are all unusable", { rates: { USD: 0, HKD: -1 } }],
  ])("throws on %s", async (_label, body) => {
    respondWith(body);

    await expect(fetchFreshRates("SGD")).rejects.toThrow("no usable rates");
  });

  // The 10s timeout is the other abort trigger: it bounds a server that
  // accepts the connection and then goes quiet, which no caller-side signal
  // would ever fire for.
  it("aborts the request once the timeout elapses", async () => {
    vi.useFakeTimers();
    let observed: AbortSignal | undefined;
    fetchMock.mockImplementation((_input, init) => {
      observed = init?.signal ?? undefined;
      return new Promise<Response>(() => {});
    });

    void fetchFreshRates("SGD");
    await vi.advanceTimersByTimeAsync(10_000);

    expect(observed?.aborted).toBe(true);
    vi.useRealTimers();
  });

  it("aborts the request when the caller's signal fires", async () => {
    const controller = new AbortController();
    let observed: AbortSignal | undefined;
    fetchMock.mockImplementation((_input, init) => {
      observed = init?.signal ?? undefined;
      return new Promise<Response>(() => {});
    });

    void fetchFreshRates("SGD", controller.signal);
    controller.abort();

    expect(observed?.aborted).toBe(true);
  });
});
