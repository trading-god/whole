import { z } from "zod";

// Account visual identity per asset kind. `color` is the accent used for the
// avatar glyph; `tint` is the soft background behind it. Kept here so the
// repository no longer hard-codes a single appearance for every new account.
const ASSET_KIND_APPEARANCE = {
  cash: { color: "#12815F", tint: "#E2F3ED" },
  investment: { color: "#215AA8", tint: "#E7EFFB" },
  crypto: { color: "#5A48A8", tint: "#EEEAFB" },
} as const;

export const knownAssetKinds = ["cash", "investment", "crypto"] as const;

export type AssetKind = (typeof knownAssetKinds)[number];

// Schema for a known asset kind, owned alongside `knownAssetKinds` so
// `asset-repository.ts` and `ocr-parser.ts` validate against one enum
// instead of each re-declaring `z.enum(knownAssetKinds)`.
export const assetKindSchema = z.enum(knownAssetKinds);

const LAST_FOUR_DIGITS_PATTERN = /^\d{4}$/;

// Schema for a 4-digit last-four string. Owned here (alongside the pattern) so
// `asset-repository.ts`'s account identity schema and the OCR parser share one
// definition of "what is a valid last four" instead of each re-declaring the
// regex.
export const lastFourDigitsSchema = z.string().regex(LAST_FOUR_DIGITS_PATTERN);

export type AccountAppearance = {
  color: string;
  tint: string;
};

export function getAccountAppearance(kind: AssetKind): AccountAppearance {
  return ASSET_KIND_APPEARANCE[kind];
}

// Distribution-bar segment color per asset kind on the home composition chart.
// Kept alongside the avatar appearance so a new kind adds both in one place
// instead of drifting in a screen-local color map.
export const ASSET_KIND_DISTRIBUTION_COLORS: Record<AssetKind, string> = {
  cash: "#A9E0C9",
  investment: "#7CBFA8",
  crypto: "#F0C781",
};

// i18n keys for each asset kind's display label, split by context: the picker
// (new-account kind selector) and the chart (home distribution legend).
// Collected here alongside the visual identity so adding a kind updates
// appearance, label keys and distribution color in one place instead of
// drifting across screen-local maps. `as const satisfies Record<AssetKind,
// string>` keeps the values as literal key unions (so the strictly-typed `t()`
// accepts them) and forces every kind to provide a key in both contexts.
export const ASSET_KIND_PICKER_LABEL_KEYS = {
  cash: "accountForm.kindCash",
  investment: "accountForm.kindInvestment",
  crypto: "accountForm.kindCrypto",
} as const satisfies Record<AssetKind, string>;

// Builds the kind-picker options (label + value) for the account form's
// ChoiceChipGroup, co-located with the label keys. Takes a translator so this
// module stays free of an i18n dependency while the kind → label mapping lives
// in one place.
// The literal label-key union (e.g. "accountForm.kindCash" | …), derived from
// the key map so the translator parameter accepts exactly those keys. Typing
// the param as `(key: string) => string` would reject i18next's strictly-typed
// `t` (whose parameter is the union of ALL known keys, not arbitrary strings);
// narrowing to the label keys lets `t` flow in while staying type-safe.
type AssetKindPickerLabelKey = (typeof ASSET_KIND_PICKER_LABEL_KEYS)[AssetKind];

export function assetKindPickerOptions(
  t: (key: AssetKindPickerLabelKey) => string,
): { label: string; value: AssetKind }[] {
  return knownAssetKinds.map((value) => ({
    label: t(ASSET_KIND_PICKER_LABEL_KEYS[value]),
    value,
  }));
}

export const ASSET_KIND_CHART_LABEL_KEYS = {
  cash: "home.cash",
  investment: "home.investments",
  crypto: "home.digitalAssets",
} as const satisfies Record<AssetKind, string>;

// Two-letter avatar initial derived from the account name. Falls back to "A"
// when the name is blank so the avatar never renders empty.
export function getAccountInitial(name: string): string {
  return name.trim().slice(0, 2).toUpperCase() || "A";
}
