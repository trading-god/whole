import { z } from "zod";

import { createAsyncSerializer } from "@/features/assets/async-serializer";
import { createCachedPreferenceStore } from "@/storage/cached-preference-store";

// Whether the home screen masks asset amounts behind a fixed string. A pure
// view preference, so it follows the display-currency pattern: not persisted
// until the user first switches it, and a failed read/write stays on its
// fallback — neither is worth an alert over a view setting.

// Fixed string rendered in place of asset figures while privacy mode masks the
// home screen. Uses the same U+2022 bullet glyph the app already redacts
// account numbers with (•••• — see AccountRow/AccountEditorFields), so masked
// amounts and masked card digits read as one consistent hiding convention
// instead of two unrelated glyphs.
export const ASSET_AMOUNT_MASK = "••••";

// Renders a formatted asset figure, hiding it behind ASSET_AMOUNT_MASK when
// privacy mode is on. The caller keeps *missing* figures readable: compute the
// formatted amount (or its "—" placeholder) and call this only on the
// real-value branch, exactly as AccountRow gates on `convertedTotal !== null`.
// This is a blind string swap — it cannot tell a loaded value from a
// placeholder — so the "unavailable figure must stay readable" rule lives in
// the caller's gate, not here.
export function maskAssetAmount(displayValue: string, hide: boolean): string {
  return hide ? ASSET_AMOUNT_MASK : displayValue;
}

const ASSET_PRIVACY_MODE_KEY = "whole.assetPrivacyMode";

const assetPrivacyModeSchema = z.enum(["visible", "hidden"]);

const assetPrivacyModeStore = createCachedPreferenceStore(
  ASSET_PRIVACY_MODE_KEY,
  assetPrivacyModeSchema,
);

// The eye toggle can double-tap, firing two fire-and-forget writes to the same
// key. Native sqlite executes them in nondeterministic order, so the later tap
// could win the race and persist the value the UI already switched away from.
// Serialize the writes (the same pattern the asset/snapshot/remove writers use)
// so the most recent toggle always lands last.
const serializeAssetPrivacyWrite = createAsyncSerializer();

export const loadAssetPrivacyMode = assetPrivacyModeStore.load;
export const saveAssetPrivacyMode = (value: AssetPrivacyMode): Promise<void> =>
  serializeAssetPrivacyWrite(() => assetPrivacyModeStore.save(value));

export type AssetPrivacyMode = z.infer<typeof assetPrivacyModeSchema>;
