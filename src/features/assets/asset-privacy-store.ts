import { z } from "zod";

import { createAsyncSerializer } from "@/features/assets/async-serializer";
import { createCachedPreferenceStore } from "@/storage/cached-preference-store";

// Whether the home screen masks asset amounts behind a fixed string. A pure
// view preference, so it follows the display-currency pattern: not persisted
// until the user first switches it, and a failed read/write stays on its
// fallback — neither is worth an alert over a view setting.

// Fixed mask rendered in place of hidden digits while privacy mode masks the
// home screen. The asterisk matches the redaction the app already uses for
// account numbers ("**** 1234" — see AccountRow/AccountEditorFields), so masked
// amounts and masked card digits read as one consistent hiding convention
// instead of two unrelated glyphs.
export const ASSET_AMOUNT_MASK = "****";

// Renders a formatted figure, hiding only its digits when privacy mode is on.
// The figure's non-digit chrome stays readable — the currency symbol ("$",
// "S$", "HK$", "CN¥") and sign/percent markers ("+", "-", "%") — so a masked
// amount still reads as money rather than an unrelated string
// ("$1,234.56" → "$****", "+12.3%" → "+****%").
//
// The caller keeps *missing* figures readable: compute the formatted amount (or
// its "—" placeholder) and call this only on the real-value branch, exactly as
// AccountRow gates on `convertedTotal !== null`. An all-dash "—" has no digits,
// so it round-trips unchanged when privacy mode is on.
export function maskAssetAmount(displayValue: string, hide: boolean): string {
  if (!hide) {
    return displayValue;
  }
  // Collapse every run of digits plus the thousands/decimal separators (",",
  // ".") into the mask — the digit span of the figure — leaving the currency
  // symbol, sign, and percent markers in place.
  return displayValue.replace(/[0-9.,]+/g, ASSET_AMOUNT_MASK);
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
