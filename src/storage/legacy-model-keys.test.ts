import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import { removeLegacyModelKeys } from "@/storage/legacy-model-keys";

const mockGetItem = jest.fn<(key: string) => Promise<string | null>>();
const mockSetItem = jest.fn<(key: string, value: string) => Promise<void>>();
const mockRemoveItem = jest.fn<(key: string) => Promise<void>>();
const mockDeleteItemAsync = jest.fn<(key: string) => Promise<void>>();
const mockWithTransaction = jest.fn();

jest.mock("@/storage/kv-store", () => ({
  getItem: (key: string) => mockGetItem(key),
  setItem: (key: string, value: string) => mockSetItem(key, value),
  removeItem: (key: string) => mockRemoveItem(key),
  // The real transaction runs its work; the tests assert what the work did.
  withTransaction: async (work: () => Promise<void>) => {
    mockWithTransaction();
    await work();
  },
}));

jest.mock("expo-secure-store", () => ({
  deleteItemAsync: (key: string) => mockDeleteItemAsync(key),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockGetItem.mockResolvedValue(null);
  mockSetItem.mockResolvedValue(undefined);
  mockRemoveItem.mockResolvedValue(undefined);
  mockDeleteItemAsync.mockResolvedValue(undefined);
});

describe("removeLegacyModelKeys", () => {
  it("sweeps the endpoint era's keys and credential, then marks the sweep done", async () => {
    await removeLegacyModelKeys();

    expect(mockRemoveItem).toHaveBeenCalledTimes(2);
    expect(mockRemoveItem).toHaveBeenCalledWith("whole.model.provider");
    expect(mockRemoveItem).toHaveBeenCalledWith("whole.model.consentHost");
    expect(mockDeleteItemAsync).toHaveBeenCalledWith("whole.model.apiKey");
    expect(mockSetItem).toHaveBeenCalledWith(
      "whole.model.legacyKeysSwept",
      "1",
    );
  });

  it("sweeps once per install: a completed marker skips the deletes", async () => {
    mockGetItem.mockResolvedValue("1");

    await removeLegacyModelKeys();

    expect(mockWithTransaction).not.toHaveBeenCalled();
    expect(mockRemoveItem).not.toHaveBeenCalled();
    expect(mockDeleteItemAsync).not.toHaveBeenCalled();
  });

  it("propagates a storage failure to the caller's best-effort handling", async () => {
    mockRemoveItem.mockRejectedValue(new Error("db locked"));

    await expect(removeLegacyModelKeys()).rejects.toThrow("db locked");
  });

  it("sweeps the kv rows even when the Keychain delete fails", async () => {
    // A Keychain error is not the kind a later launch fixes. Letting it abort
    // the sweep would not retry the credential — it would only leave the two
    // kv rows and the marker unwritten on every launch, forever.
    mockDeleteItemAsync.mockRejectedValue(new Error("keychain unavailable"));

    await expect(removeLegacyModelKeys()).resolves.toBeUndefined();

    expect(mockRemoveItem).toHaveBeenCalledTimes(2);
    expect(mockSetItem).toHaveBeenCalledWith(
      "whole.model.legacyKeysSwept",
      "1",
    );
  });

  it("commits the deletes and the marker together", async () => {
    // The marker can only retire the sweep by actually having run: a rollback
    // takes it with the deletes, and the next launch tries again. Reading the
    // rows back instead would not work — the read shares the connection and
    // sees the uncommitted deletes.
    await removeLegacyModelKeys();

    expect(mockWithTransaction).toHaveBeenCalledTimes(1);
  });
});
