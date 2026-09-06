// Resolves the path the on-device runtime loads the model from.
//
// The weights live in filesDir — downloaded there on demand by
// `model-download.ts` (they once shipped inside the native bundles, but the
// base APK's 150 MB Play cap and a 3 GB iOS download made bundling a dead end
// for distribution). The same path serves both platforms:
//
//   - iOS: llama.rn accepts an absolute `file://` URI with
//     `is_model_asset: false` (the asset flag is only its NSBundle lookup).
//   - Android: a filesDir path is what it has always taken.
import { File, Paths } from "expo-file-system";

import { BUNDLED_MODEL } from "@/features/on-device-model/on-device-catalog";

/** The directory the model's shards are downloaded into. */
export const MODEL_DIR_NAME = "whole_models";

/**
 * What the weights actually cost the device: `BUNDLED_MODEL.sizeBytes`, one
 * copy, on both platforms — the file is read in place from filesDir. (When the
 * weights were bundled, Android held TWO copies — APK plus the filesDir
 * extraction — which is why this used to multiply by platform.)
 */
export function bundledModelStorageBytes(): number {
  return BUNDLED_MODEL.sizeBytes;
}

/**
 * The path to hand the on-device runtime: the FIRST shard, whose siblings
 * llama.cpp resolves by name.
 *
 * Throws when the model is not fully present, rather than handing the runtime
 * a path that fails deep inside the loader: the caller (a recognition or the
 * settings Test) can only say "download the model first", and the message
 * says exactly that. Presence is judged shard-by-shard by SIZE — the same rule
 * `model-download.ts` downloads under — because a wrong-sized file loads
 * nothing and must not read as present.
 */
export function resolveBundledModelPath(): string {
  for (const shard of BUNDLED_MODEL.shards) {
    const file = new File(Paths.document, MODEL_DIR_NAME, shard.fileName);
    if (!file.exists || file.size !== shard.sizeBytes) {
      throw new Error(
        "The recognition model is not downloaded. Open Settings to download it.",
      );
    }
  }
  return new File(Paths.document, MODEL_DIR_NAME, BUNDLED_MODEL.fileName).uri;
}
