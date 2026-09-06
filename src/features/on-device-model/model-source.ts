// Resolves the path the on-device runtime loads a model from.
//
// The weights live in filesDir — downloaded there on demand by
// `model-download.ts` — under a per-model directory named by the catalog id.
// The same path serves both platforms:
//
//   - iOS: llama.rn accepts an absolute `file://` URI with
//     `is_model_asset: false` (the asset flag is only its NSBundle lookup).
//   - Android: a filesDir path is what it has always taken.
import { File, Paths } from "expo-file-system";

import {
  type OnDeviceModel,
  type OnDeviceModelId,
  onDeviceModel,
} from "@/features/on-device-model/on-device-catalog";

/** The root directory every model downloads under. */
export const MODEL_DIR_NAME = "whole_models";

/**
 * The path to hand the on-device runtime: the model's weights file.
 *
 * Throws when the model is not fully present, rather than handing the runtime
 * a path that fails deep inside the loader: the caller (a recognition or the
 * settings Test) can only say "download the model first", and the message
 * says exactly that. Presence is judged by SIZE — the same rule
 * `model-download.ts` downloads under — because a wrong-sized file loads
 * nothing and must not read as present.
 */
export function resolveOnDeviceModelPath(id: OnDeviceModelId): string {
  const model = onDeviceModel(id);
  const file = new File(
    Paths.document,
    MODEL_DIR_NAME,
    model.id,
    model.fileName,
  );
  if (!file.exists || file.size !== model.sizeBytes) {
    throw new Error(
      `${model.name} is not downloaded. Open Settings to download it.`,
    );
  }
  return file.uri;
}

/**
 * What one model's weights actually cost the device: the file, one copy, on
 * both platforms — it is read in place from filesDir. The UI's "storage"
 * line reads this; the "memory" line reads the catalog's `ramBytes`, which is
 * a different number and a different promise.
 */
export function onDeviceModelStorageBytes(model: OnDeviceModel): number {
  return model.sizeBytes;
}
