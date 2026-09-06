import { beforeEach, describe, expect, it, vi } from "vitest";

// The store caches its value at module level (cached-preference-store), so
// each case imports a FRESH module graph — the same discipline the other
// cached-store suites apply.
const freshStore = async () => {
  return import("@/features/on-device-model/on-device-model-store");
};

const kv = vi.hoisted(() => ({ getItem: vi.fn(), setItem: vi.fn() }));

vi.mock("@/storage/kv-store", () => ({
  getItem: kv.getItem,
  setItem: kv.setItem,
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("the on-device model store", () => {
  it("loads the stored model id", async () => {
    kv.getItem.mockResolvedValue("gemma-4-e4b");
    const { loadOnDeviceModelId } = await freshStore();

    await expect(loadOnDeviceModelId()).resolves.toBe("gemma-4-e4b");
  });

  it("defaults to the E2B model when nothing is stored", async () => {
    kv.getItem.mockResolvedValue(null);
    const { loadOnDeviceModelId } = await freshStore();

    await expect(loadOnDeviceModelId()).resolves.toBe("gemma-4-e2b");
  });

  it("falls back to the default on a value the schema rejects", async () => {
    // A model removed from a later catalog: the stored id outlives the
    // model it named, and a launch must degrade to the small model rather
    // than crash.
    kv.getItem.mockResolvedValue("gemma-4-e12b");
    const { loadOnDeviceModelId } = await freshStore();

    await expect(loadOnDeviceModelId()).resolves.toBe("gemma-4-e2b");
  });

  it("saves the model id and reads it back through the module cache", async () => {
    kv.getItem.mockResolvedValue(null);
    const { loadOnDeviceModelId, saveOnDeviceModelId } = await freshStore();

    await saveOnDeviceModelId("gemma-4-e4b");
    await expect(loadOnDeviceModelId()).resolves.toBe("gemma-4-e4b");
    expect(kv.setItem).toHaveBeenCalledWith(
      "whole.recognition.onDeviceModel",
      "gemma-4-e4b",
    );
  });
});
