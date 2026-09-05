// Resolves the path the on-device runtime loads the bundled model from.
//
// The weights ship inside the NATIVE app bundles — copied there at prebuild
// by `plugins/with-whole-model.js`, never through Metro (the JS asset
// pipeline cannot carry multi-gigabyte files; see the catalog for the
// history). The two platforms hand them to llama.cpp differently:
//
//   - iOS: the shards are Xcode resources, and llama.rn's `is_model_asset`
//     flag resolves the FIRST shard against the app's main bundle natively.
//     The bare file name is all the JS side has to supply.
//   - Android: the shards are APK assets, which llama.cpp cannot
//     `std::ifstream`. The patched llama.rn module (see patches/) extracts
//     them into filesDir at install time; this module returns that path.
//
// The copy on Android is one-time and idempotent — the patch skips files
// already extracted, and a subsequent launch finds them there.
import { File, Paths } from "expo-file-system";
import { Platform } from "react-native";

import { BUNDLED_MODEL } from "@/features/on-device-model/on-device-catalog";

// iOS loads the model from the bundle by name (via llama.rn's asset flag);
// Android loads it from the filesDir copy the patched llama.rn module
// extracts into. Both arms of this branch are exercised by the Jest project
// split (one run per platform).
export function canLoadBundledModelDirectly(): boolean {
  return Platform.OS === "ios";
}

/** The directory the patched llama.rn module extracts the shards into. */
const ANDROID_MODEL_DIR = "whole_models";

/**
 * What the weights actually cost the device, which is not the same number on
 * both platforms.
 *
 * iOS reads the shards in place, as bundle resources: one copy. Android cannot
 * — llama.cpp needs a filesystem path, so the patched module extracts a second
 * copy into filesDir and the originals stay inside the installed APK. The
 * settings card prints this rather than `BUNDLED_MODEL.sizeBytes`, because a
 * user deciding whether they have room should be told the whole bill.
 */
export function bundledModelStorageBytes(): number {
  return canLoadBundledModelDirectly()
    ? BUNDLED_MODEL.sizeBytes
    : BUNDLED_MODEL.sizeBytes * 2;
}

/**
 * The path to hand the on-device runtime: the FIRST shard, whose siblings
 * llama.cpp resolves by name.
 *
 * On iOS this is the bare bundle-resource name. On Android it is the
 * first shard's filesDir path, where the patched llama.rn module extracted
 * every shard at install time.
 */
export async function resolveBundledModelPath(): Promise<string> {
  if (canLoadBundledModelDirectly()) {
    return BUNDLED_MODEL.fileName;
  }

  // EVERY shard, and by SIZE rather than existence. The extraction can stop
  // part-way — running out of disk with the first shard already in place is the
  // realistic case — and llama.cpp resolves the siblings itself, so checking
  // only the first would hand it a path that opens and then fails deep inside
  // the loader instead of here, where the message says what to do.
  //
  // A wrong-sized copy is DELETED rather than merely reported: the native
  // extraction skips any shard already present, so leaving it would make the
  // fault permanent for the life of the install. The catalog is the only place
  // that knows the expected bytes, which is why the check lives here and not in
  // the patch that does the copying.
  //
  // That recovers a TRUNCATED copy, which is the failure a device produces. It
  // would not recover a wrong CATALOG — re-extracting yields the same bytes, so
  // every launch would delete and throw again. Nothing here can tell the two
  // apart, so the catalog is guarded on the other side instead:
  // `on-device-catalog.test.ts` asserts these sizes against the real files
  // wherever the weights are present, which is every machine that can build
  // the app.
  const shards = BUNDLED_MODEL.shards.map((shard) => ({
    expected: shard.sizeBytes,
    file: new File(Paths.document, ANDROID_MODEL_DIR, shard.fileName),
  }));

  let complete = true;
  for (const { expected, file } of shards) {
    if (!file.exists) {
      complete = false;
      continue;
    }
    if (file.size !== expected) {
      // Guarded: a delete that throws on one shard would abort the loop and
      // leave the rest unchecked and unrepaired, so the install would stay
      // broken across every restart with nothing having looked at it.
      try {
        file.delete();
      } catch {
        // Nothing to do here — the shard is reported as missing either way,
        // and the next launch tries again.
      }
      complete = false;
    }
  }
  if (!complete) {
    throw new Error(
      "The bundled model has not been extracted to storage yet. Restart the app once.",
    );
  }
  return shards[0].file.uri;
}
