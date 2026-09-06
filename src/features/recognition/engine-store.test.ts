import { beforeEach, describe, expect, it, vi } from "vitest";

// The store caches its value at module level (cached-preference-store), so
// each case imports a FRESH module graph — the same discipline the Jest
// suites apply to their singletons.
const freshStore = async () => {
  return import("@/features/recognition/engine-store");
};

const kv = vi.hoisted(() => ({ getItem: vi.fn(), setItem: vi.fn() }));

vi.mock("@/storage/kv-store", () => ({
  getItem: kv.getItem,
  setItem: kv.setItem,
}));

beforeEach(() => {
  // The store caches at MODULE level, which is the behaviour under test — so
  // each case needs its own module instance, or the first cached read leaks
  // into every case after it (the same discipline base-currency-store's tests
  // apply).
  vi.resetModules();
  vi.clearAllMocks();
});

describe("the recognition engine store", () => {
  it("loads the stored engine", async () => {
    kv.getItem.mockResolvedValue("remote");
    const { loadRecognitionEngine } = await freshStore();

    await expect(loadRecognitionEngine("on-device")).resolves.toBe("remote");
  });

  it("falls back when nothing is stored", async () => {
    kv.getItem.mockResolvedValue(null);
    const { loadRecognitionEngine } = await freshStore();

    await expect(loadRecognitionEngine("on-device")).resolves.toBe("on-device");
  });

  it("falls back on a value the schema rejects", async () => {
    kv.getItem.mockResolvedValue("turbo");
    const { loadRecognitionEngine } = await freshStore();

    await expect(loadRecognitionEngine("on-device")).resolves.toBe("on-device");
  });

  it("saves the engine and reads it back through the module cache", async () => {
    kv.getItem.mockResolvedValue(null);
    const { loadRecognitionEngine, saveRecognitionEngine } = await freshStore();

    await saveRecognitionEngine("remote");
    await expect(loadRecognitionEngine("on-device")).resolves.toBe("remote");
    expect(kv.setItem).toHaveBeenCalledWith(
      "whole.recognition.engine",
      "remote",
    );
  });
});
