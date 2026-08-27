import { beforeEach, describe, expect, it, vi } from "vitest";

// `vi.hoisted` so the same two mock functions survive `vi.resetModules()`. The
// factory runs again on every re-import, and inline `vi.fn()`s would hand back
// fresh spies each time, leaving the assertions below watching an instance the
// module under test no longer calls.
const { getItemMock, setItemMock } = vi.hoisted(() => ({
  getItemMock: vi.fn<(key: string) => Promise<string | null>>(),
  setItemMock: vi.fn<(key: string, value: string) => Promise<void>>(),
}));

vi.mock("@/storage/kv-store", () => ({
  getItem: getItemMock,
  setItem: setItemMock,
}));

const KEY = "whole.baseCurrency";

// The store caches at MODULE level, which is the behaviour under test — so each
// case needs its own module instance, or the first cached read leaks into every
// case after it.
const importStore = () => import("@/features/assets/base-currency-store");

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  setItemMock.mockResolvedValue(undefined);
});

describe("loadBaseCurrency", () => {
  it("reads the stored base", async () => {
    getItemMock.mockResolvedValue("HKD");
    const { loadBaseCurrency } = await importStore();

    expect(await loadBaseCurrency("SGD")).toBe("HKD");
    expect(getItemMock).toHaveBeenCalledWith(KEY);
  });

  // The base is the unit every net-worth snapshot is stored in, so it is
  // pinned on first launch and must not follow a later locale change — the
  // opposite of the display currency.
  it("pins the locale-derived fallback on first launch", async () => {
    getItemMock.mockResolvedValue(null);
    const { loadBaseCurrency } = await importStore();

    expect(await loadBaseCurrency("SGD")).toBe("SGD");

    expect(setItemMock).toHaveBeenCalledWith(KEY, "SGD");
  });
});

describe("baseCurrencyQueryOptions", () => {
  // The fallback is part of the key, not something the fetcher closes over:
  // a different locale-derived default has to be its own cache entry rather
  // than being served the previous one's answer.
  it("keys on the fallback", async () => {
    const { baseCurrencyQueryOptions } = await importStore();

    expect(baseCurrencyQueryOptions("SGD").queryKey).toEqual([
      "baseCurrency",
      "SGD",
    ]);
    expect(baseCurrencyQueryOptions("HKD").queryKey).toEqual([
      "baseCurrency",
      "HKD",
    ]);
  });

  // It never goes stale: the value is pinned on first launch, and a refetch
  // that produced a different base would break comparability of every stored
  // snapshot.
  it("never goes stale and is never garbage collected", async () => {
    const { baseCurrencyQueryOptions } = await importStore();
    const options = baseCurrencyQueryOptions("SGD");

    expect(options.staleTime).toBe(Infinity);
    expect(options.gcTime).toBe(Infinity);
  });

  // Local reads must not sit behind the online gate — there is no network
  // involved in reading a preference out of sqlite.
  it("stays off the online gate", async () => {
    const { baseCurrencyQueryOptions } = await importStore();

    expect(baseCurrencyQueryOptions("SGD").networkMode).toBe("always");
  });

  it("resolves through the store", async () => {
    getItemMock.mockResolvedValue("USD");
    const { baseCurrencyQueryOptions } = await importStore();
    const { queryFn } = baseCurrencyQueryOptions("SGD");

    if (typeof queryFn !== "function") {
      throw new TypeError("baseCurrencyQueryOptions must supply a queryFn");
    }

    await expect(queryFn({} as never)).resolves.toBe("USD");
  });
});
