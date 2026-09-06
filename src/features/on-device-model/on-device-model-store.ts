import { z } from "zod";

import { createCachedPreferenceStore } from "@/storage/cached-preference-store";
import {
  type OnDeviceModelId,
  onDeviceModel,
} from "@/features/on-device-model/on-device-catalog";

// Which of the catalog's models the on-device engine runs. A preference
// distinct from the ENGINE choice (`engine-store.ts`): the engine says WHERE
// recognition runs (this phone or the user's service), this says WHICH
// weights the local engine loads. Kept apart so switching engines never
// rewrites the model the user downloaded, and switching models never touches
// a remote config.
//
// The stored value is the catalog id. An unknown id (a model removed from a
// later catalog) resolves to the DEFAULT through `onDeviceModel`, so a stale
// preference degrades to the small model rather than crashing a launch.
const MODEL_KEY = "whole.recognition.onDeviceModel";

export const ON_DEVICE_MODEL_SCHEMA = z.enum(["gemma-4-e2b", "gemma-4-e4b"]);

const modelStore = createCachedPreferenceStore(
  MODEL_KEY,
  ON_DEVICE_MODEL_SCHEMA,
);

export async function loadOnDeviceModelId(): Promise<OnDeviceModelId> {
  return modelStore.load("gemma-4-e2b");
}

export async function saveOnDeviceModelId(id: OnDeviceModelId): Promise<void> {
  return modelStore.save(id);
}

/** The selected model, resolved — the default when the stored id is unknown. */
export async function loadSelectedOnDeviceModel() {
  return onDeviceModel(await loadOnDeviceModelId());
}
