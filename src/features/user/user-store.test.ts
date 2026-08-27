import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  USER_NAME_MAX_LENGTH,
  loadUserName,
  saveUserName,
  userNameSchema,
} from "@/features/user/user-store";
import { getItem, setItem } from "@/storage/kv-store";

vi.mock("@/storage/kv-store", () => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
}));

const getItemMock = vi.mocked(getItem);
const setItemMock = vi.mocked(setItem);

const KEY = "whole.user.name";

beforeEach(() => {
  vi.resetAllMocks();
  setItemMock.mockResolvedValue(undefined);
});

describe("userNameSchema", () => {
  it("accepts a name and trims it", () => {
    expect(userNameSchema.parse("  Jack  ")).toBe("Jack");
  });

  it("accepts a name of exactly the maximum length", () => {
    const name = "x".repeat(USER_NAME_MAX_LENGTH);

    expect(userNameSchema.parse(name)).toBe(name);
  });

  it.each([
    ["empty", ""],
    ["whitespace only", "   "],
  ])("rejects a %s name", (_label, value) => {
    expect(userNameSchema.safeParse(value).success).toBe(false);
  });

  it("rejects a name past the maximum length", () => {
    expect(
      userNameSchema.safeParse("x".repeat(USER_NAME_MAX_LENGTH + 1)).success,
    ).toBe(false);
  });

  // The trim happens BEFORE the length check, so padding does not push an
  // otherwise-valid name over the limit.
  it("measures length after trimming", () => {
    const padded = ` ${"x".repeat(USER_NAME_MAX_LENGTH)} `;

    expect(userNameSchema.safeParse(padded).success).toBe(true);
  });
});

describe("loadUserName", () => {
  it("returns the stored name", async () => {
    getItemMock.mockResolvedValue("Jack");

    expect(await loadUserName()).toBe("Jack");
    expect(getItemMock).toHaveBeenCalledWith(KEY);
  });

  // "" rather than null, so the home screen falls back to a generic greeting
  // instead of rendering an empty interpolation.
  it("returns an empty string when unset", async () => {
    getItemMock.mockResolvedValue(null);

    expect(await loadUserName()).toBe("");
  });
});

describe("saveUserName", () => {
  it("writes the name to its namespaced key", async () => {
    await saveUserName("Jack");

    expect(setItemMock).toHaveBeenCalledWith(KEY, "Jack");
  });
});
