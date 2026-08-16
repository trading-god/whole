// The asset-kind and last-four vocabulary the recognizer and the app share.
//
// Only the *schema* half of the app's `account-appearance.ts` lives here — the
// enum, its zod schema, and the last-four pattern — because those are what the
// recognizer must agree with the app on. The visual half (colors, tints, i18n
// label keys, avatar initials) stays in the app, which re-exports these so app
// code keeps its existing import path and there is still one definition.
import { z } from "zod";

export const knownAssetKinds = ["cash", "investment", "crypto"] as const;

export type AssetKind = (typeof knownAssetKinds)[number];

// Schema for a known asset kind, owned alongside `knownAssetKinds` so
// `asset-repository.ts` and the OCR parser validate against one enum instead of
// each re-declaring `z.enum(knownAssetKinds)`.
export const assetKindSchema = z.enum(knownAssetKinds);

const LAST_FOUR_DIGITS_PATTERN = /^\d{4}$/;

// Schema for a 4-digit last-four string. Owned here (alongside the pattern) so
// `asset-repository.ts`'s account identity schema and the OCR parser share one
// definition of "what is a valid last four" instead of each re-declaring the
// regex.
export const lastFourDigitsSchema = z.string().regex(LAST_FOUR_DIGITS_PATTERN);

// Form-input variant: the last four is optional (brokerage/stock accounts may
// not have a card number), so an empty string is also valid. Shared by every
// account form's save gate so "empty or exactly 4 digits" is defined once.
//
// It sits here rather than in the app because the draft layer that consumes it
// (`account-draft.ts`) is otherwise pure: leaving this one schema in
// `asset-repository.ts` dragged the whole storage module — and with it
// `expo-crypto` — into anything that wanted to validate a draft, which is what
// kept those rules untestable outside a React Native runtime. `contract/`
// already owns the last-four pattern, so the optional form belongs beside it.
export const optionalLastFourDigitsSchema = lastFourDigitsSchema.or(
  z.literal(""),
);
