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

const KEY = "whole.assetPrivacyMode";

const importStore = () => import("@/features/assets/asset-privacy-store");

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  setItemMock.mockResolvedValue(undefined);
});

describe("maskAssetAmount", () => {
  it("returns the value untouched when not hiding", async () => {
    const { maskAssetAmount } = await importStore();

    expect(maskAssetAmount("S$4,766.92", false)).toBe("S$4,766.92");
  });

  // The chrome that makes a figure read as money survives; only the digit span
  // is replaced. Otherwise a masked amount would look like an unrelated string.
  it.each([
    ["a currency symbol", "S$4,766.92", "S$****"],
    ["a plain dollar sign", "$1,234.56", "$****"],
    ["the CNY symbol", "CN¥76,007.05", "CN¥****"],
    ["a negative sign", "-S$1,745.52", "-S$****"],
    ["a signed percentage", "+12.3%", "+****%"],
  ])("keeps %s while masking the digits", async (_label, input, expected) => {
    const { maskAssetAmount } = await importStore();

    expect(maskAssetAmount(input, true)).toBe(expected);
  });

  it("uses the same mask the redacted account number uses", async () => {
    const { ASSET_AMOUNT_MASK } = await importStore();

    expect(ASSET_AMOUNT_MASK).toBe("****");
  });

  // The caller only masks the real-value branch, but "—" has no digits, so it
  // round-trips unchanged if one ever reaches here.
  it("leaves a placeholder with no digits unchanged", async () => {
    const { maskAssetAmount } = await importStore();

    expect(maskAssetAmount("—", true)).toBe("—");
  });
});

describe("the persisted privacy mode", () => {
  it("reads the stored mode", async () => {
    getItemMock.mockResolvedValue("hidden");
    const { loadAssetPrivacyMode } = await importStore();

    expect(await loadAssetPrivacyMode("visible")).toBe("hidden");
    expect(getItemMock).toHaveBeenCalledWith(KEY);
  });

  it("writes through", async () => {
    const { saveAssetPrivacyMode } = await importStore();

    await saveAssetPrivacyMode("hidden");

    expect(setItemMock).toHaveBeenCalledWith(KEY, "hidden");
  });

  // A view preference: an unreadable value stays on the fallback rather than
  // failing, because nothing here is data.
  it("falls back when the stored mode no longer validates", async () => {
    getItemMock.mockResolvedValue("masked");
    const { loadAssetPrivacyMode } = await importStore();

    expect(await loadAssetPrivacyMode("visible")).toBe("visible");
  });

  // The eye toggle double-taps, firing two fire-and-forget writes at the same
  // key. sqlite would order them nondeterministically, so the writes are
  // serialized and the LAST tap has to be the one that lands.
  it("lets the most recent toggle win a double tap", async () => {
    const writes: string[] = [];
    setItemMock.mockImplementation(async (_key, value) => {
      writes.push(value);
    });
    const { saveAssetPrivacyMode } = await importStore();

    await Promise.all([
      saveAssetPrivacyMode("hidden"),
      saveAssetPrivacyMode("visible"),
    ]);

    expect(writes).toEqual(["hidden", "visible"]);
  });
});
