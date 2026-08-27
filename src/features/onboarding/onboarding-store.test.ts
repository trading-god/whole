import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  loadOnboardingCompleted,
  markOnboardingCompleted,
} from "@/features/onboarding/onboarding-store";
import { getItem, setItem } from "@/storage/kv-store";

vi.mock("@/storage/kv-store", () => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
}));

const getItemMock = vi.mocked(getItem);
const setItemMock = vi.mocked(setItem);

const KEY = "whole.onboarding.completed";

beforeEach(() => {
  vi.resetAllMocks();
  setItemMock.mockResolvedValue(undefined);
});

describe("loadOnboardingCompleted", () => {
  it("is true once the marker is written", async () => {
    getItemMock.mockResolvedValue("1");

    expect(await loadOnboardingCompleted()).toBe(true);
    expect(getItemMock).toHaveBeenCalledWith(KEY);
  });

  it("is false on a fresh install", async () => {
    getItemMock.mockResolvedValue(null);

    expect(await loadOnboardingCompleted()).toBe(false);
  });

  // The comparison is against "1" exactly. Anything else — a truthy-looking
  // legacy value, a half-written row — routes the user back through
  // onboarding rather than skipping it on a value nobody wrote deliberately.
  it.each([
    ["an unexpected value", "true"],
    ["an empty string", ""],
    ["zero", "0"],
  ])("is false for %s", async (_label, stored) => {
    getItemMock.mockResolvedValue(stored);

    expect(await loadOnboardingCompleted()).toBe(false);
  });
});

describe("markOnboardingCompleted", () => {
  it("writes the marker", async () => {
    await markOnboardingCompleted();

    expect(setItemMock).toHaveBeenCalledWith(KEY, "1");
  });
});
