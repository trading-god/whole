// Resolves the path the on-device runtime loads a model from.
//
// The weights live in filesDir — downloaded there on demand by
// `model-download.ts`, which owns everything about those files: the directory
// layout, the presence rule. The same path serves both platforms:
//
//   - iOS: llama.rn accepts an absolute `file://` URI with
//     `is_model_asset: false` (the asset flag is only its NSBundle lookup).
//   - Android: a filesDir path is what it has always taken.
import {
  modelFile,
  modelPresence,
} from "@/features/on-device-model/model-download";
import {
  type OnDeviceModelId,
  onDeviceModel,
} from "@/features/on-device-model/on-device-catalog";

/**
 * The path to hand the on-device runtime: the model's weights file.
 *
 * Throws when the model is not fully present, rather than handing the runtime
 * a path that fails deep inside the loader: the caller (a recognition or the
 * settings Test) can only say "download the model first", and the message
 * says exactly that. Presence is judged by the downloader's own rule — one
 * definition of "the model is on disk", shared by the recognition gate and
 * this path resolution.
 */
export function resolveOnDeviceModelPath(id: OnDeviceModelId): string {
  if (modelPresence(id).status !== "present") {
    throw new Error(
      `${onDeviceModel(id).name} is not downloaded. Open Settings to download it.`,
    );
  }
  return modelFile(id).uri;
}
