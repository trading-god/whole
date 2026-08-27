import { beforeEach, describe, expect, it, vi } from "vitest";

// `vi.hoisted` so the same two mock functions survive `vi.resetModules()` —
// see the note in `base-currency-store.test.ts`.
const { getItemMock, setItemMock } = vi.hoisted(() => ({
  getItemMock: vi.fn<(key: string) => Promise<string | null>>(),
  setItemMock: vi.fn<(key: string, value: string) => Promise<void>>(),
}));

vi.mock("@/storage/kv-store", () => ({
  getItem: getItemMock,
  setItem: setItemMock,
}));

const KEY = "whole.displayCurrency";

const importStore = () => import("@/features/assets/display-currency-store");

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  setItemMock.mockResolvedValue(undefined);
});

describe("the display currency", () => {
  it("reads the stored currency", async () => {
    getItemMock.mockResolvedValue("HKD");
    const { loadDisplayCurrency } = await importStore();

    expect(await loadDisplayCurrency("SGD")).toBe("HKD");
    expect(getItemMock).toHaveBeenCalledWith(KEY);
  });

  it("writes through", async () => {
    const { saveDisplayCurrency } = await importStore();

    await saveDisplayCurrency("USD");

    expect(setItemMock).toHaveBeenCalledWith(KEY, "USD");
  });

  // Unlike the base currency this one is NOT pinned on first use: until the
  // user picks a currency it keeps following the device locale, so the
  // locale-derived fallback must never be written to storage behind their back.
  it("does not persist the locale-derived fallback", async () => {
    getItemMock.mockResolvedValue(null);
    const { loadDisplayCurrency } = await importStore();

    expect(await loadDisplayCurrency("SGD")).toBe("SGD");

    expect(setItemMock).not.toHaveBeenCalled();
  });

  // A stored value the app no longer ships (a currency removed from the enum)
  // must not crash the home screen — it degrades to the locale default.
  it("falls back when the stored currency no longer validates", async () => {
    getItemMock.mockResolvedValue("XAU");
    const { loadDisplayCurrency } = await importStore();

    expect(await loadDisplayCurrency("SGD")).toBe("SGD");
  });
});
