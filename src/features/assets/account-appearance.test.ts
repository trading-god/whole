import { describe, expect, it, vi } from "vitest";

import {
  ASSET_KIND_CHART_LABEL_KEYS,
  ASSET_KIND_DISTRIBUTION_COLORS,
  ASSET_KIND_PICKER_LABEL_KEYS,
  assetKindPickerOptions,
  getAccountAppearance,
  getAccountInitial,
  knownAssetKinds,
} from "@/features/assets/account-appearance";

describe("getAccountAppearance", () => {
  it("gives every kind an accent and a tint", () => {
    for (const kind of knownAssetKinds) {
      const appearance = getAccountAppearance(kind);

      expect(appearance.color).toMatch(/^#[0-9A-F]{6}$/i);
      expect(appearance.tint).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });

  it("gives each kind its own accent", () => {
    const colors = knownAssetKinds.map(
      (kind) => getAccountAppearance(kind).color,
    );

    expect(new Set(colors).size).toBe(knownAssetKinds.length);
  });
});

// The three maps are collected in this module so adding a kind updates
// appearance, both label contexts, and the distribution color in one place
// rather than drifting across screen-local maps. These assert that property
// directly, so a half-added kind fails here rather than at render time.
describe("the per-kind maps", () => {
  it.each([
    ["distribution colors", ASSET_KIND_DISTRIBUTION_COLORS],
    ["picker label keys", ASSET_KIND_PICKER_LABEL_KEYS],
    ["chart label keys", ASSET_KIND_CHART_LABEL_KEYS],
  ])("cover every kind: %s", (_label, map) => {
    expect(Object.keys(map).sort()).toEqual([...knownAssetKinds].sort());
  });
});

describe("assetKindPickerOptions", () => {
  it("builds one option per kind, in the vocabulary's order", () => {
    const t = vi.fn((key: string) => `translated:${key}`);

    expect(assetKindPickerOptions(t)).toEqual(
      knownAssetKinds.map((value) => ({
        label: `translated:${ASSET_KIND_PICKER_LABEL_KEYS[value]}`,
        value,
      })),
    );
  });

  // The translator is injected so this module stays free of an i18n dependency
  // while the kind → label mapping still lives in one place.
  it("asks the caller's translator for each label", () => {
    const t = vi.fn(() => "label");

    assetKindPickerOptions(t);

    expect(t).toHaveBeenCalledTimes(knownAssetKinds.length);
    expect(t).toHaveBeenCalledWith("accountForm.kindCash");
  });
});

describe("getAccountInitial", () => {
  it("takes the first two characters, upper-cased", () => {
    expect(getAccountInitial("360 Account")).toBe("36");
    expect(getAccountInitial("global savings")).toBe("GL");
  });

  it("ignores surrounding whitespace", () => {
    expect(getAccountInitial("  dbs  ")).toBe("DB");
  });

  it("handles a one-character name", () => {
    expect(getAccountInitial("A")).toBe("A");
  });

  // The avatar must never render empty.
  it.each([
    ["an empty name", ""],
    ["a whitespace-only name", "   "],
  ])("falls back to A for %s", (_label, name) => {
    expect(getAccountInitial(name)).toBe("A");
  });

  it("keeps a non-Latin name as it is", () => {
    expect(getAccountInitial("招商银行")).toBe("招商");
  });
});
