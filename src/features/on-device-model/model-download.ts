// Downloads an on-device model's weights into filesDir, on demand.
//
// The weights never ship inside the install: even the small model is a 3.1 GB
// bundle, past Google Play's 150 MB base-APK cap and unreasonable as an iOS
// download for a feature a user may never use. Instead the settings screen
// offers the download; this module performs it and owns everything about the
// files on disk.
//
// The seam is `expo-file-system`'s `File`/`Directory` API plus
// `File.downloadFileAsync` — one import surface, mockable as a single module,
// which is what keeps this testable under Jest (see test-boundary.mjs: this
// file is NOT Node-importable; it lives on the Jest side of the boundary).
//
// Each model lands under its own directory named by the model id, so two
// downloaded models never fight over file names and deleting one leaves the
// other whole.
//
// Integrity is by SIZE, not checksum: the catalog's byte count is the same
// value the presence check and the post-download verification use, and a
// wrong-sized file is deleted so a retry can replace it. A content-hash
// would be stronger, but reading the whole file back through the JS bridge
// to hash it costs more than the failure mode it rules out.
import { Directory, File, Paths } from "expo-file-system";

import {
  type OnDeviceModelId,
  onDeviceModel,
} from "@/features/on-device-model/on-device-catalog";

/** The root directory every model downloads under. */
export const MODEL_DIR_NAME = "whole_models";

/** The directory one model's weights live in. */
export function modelDirectory(id: OnDeviceModelId): Directory {
  return new Directory(Paths.document, MODEL_DIR_NAME, id);
}

/** The file one model's weights are. */
export function modelFile(id: OnDeviceModelId): File {
  const model = onDeviceModel(id);
  return new File(modelDirectory(id), model.fileName);
}

export type ModelPresence =
  | { status: "absent" }
  | {
      /** The file is there at the right size — the model is loadable. */
      status: "present";
      /** Bytes on disk (equal to the model's `sizeBytes`). */
      sizeBytes: number;
    }
  | {
      /**
       * A file is there but the size is wrong — a truncated or stale download.
       * Reported apart from absent so the settings screen can say "the copy
       * is broken, download again" instead of "never downloaded".
       */
      status: "partial";
      sizeBytes: number;
    };

/**
 * Reads one model's presence from the filesystem — the single truth, never a
 * stored flag. A "downloaded" boolean in kv-store would drift from disk the
 * first time iOS reclaimed space or a user cleared it; the file either loads
 * or it does not.
 *
 * A wrong-SIZED file reads as partial and is deleted: the next download
 * retries it, rather than every launch finding a "present" model that fails
 * deep inside the loader.
 */
export function modelPresence(id: OnDeviceModelId): ModelPresence {
  const model = onDeviceModel(id);
  const file = modelFile(id);
  if (!file.exists) {
    return { status: "absent" };
  }
  // Read ONCE, before the delete below: `size` is a native stat per access,
  // and a stat of a deleted file is 0 by the API's contract — so a re-read
  // would report a partial file's size as nothing, discarding the number the
  // comparison just measured.
  const sizeBytes = file.size;
  if (sizeBytes === model.sizeBytes) {
    return { status: "present", sizeBytes };
  }
  try {
    file.delete();
  } catch {
    // Reported as partial either way; the next download retries.
  }
  return { status: "partial", sizeBytes };
}

/** Deletes one model's directory. No-op when absent. */
export function deleteModel(id: OnDeviceModelId): void {
  const dir = modelDirectory(id);
  if (dir.exists) {
    dir.delete();
  }
}

/**
 * Downloads the model's weights.
 *
 * The file lands at `<name>.part` and is MOVED into place only after its
 * size checks out, so an interrupted download never leaves a truncated file
 * the presence check would have to disambiguate. (`File.downloadFileAsync`
 * itself already stages on iOS; the explicit `.part` covers Android, where
 * the response streams straight into the destination.)
 */
export async function downloadModel(
  id: OnDeviceModelId,
  onProgress: (fraction: number) => void,
): Promise<void> {
  const model = onDeviceModel(id);
  const dir = modelDirectory(id);
  dir.create({ intermediates: true, idempotent: true });

  const destination = modelFile(id);
  // A wrong-sized leftover (a download interrupted at rename time, a
  // partially reclaimed file) would make `move` below throw rather than
  // replace — remove it so the fresh file can land.
  if (destination.exists) {
    destination.delete();
  }
  const partial = new File(dir, `${model.fileName}.part`);
  // A stale `.part` (an interrupted earlier run) must not block the fresh
  // download: `downloadFileAsync` rejects when the destination exists.
  if (partial.exists) {
    partial.delete();
  }

  const downloaded = await File.downloadFileAsync(model.url, partial, {
    onProgress: ({ bytesWritten }) => {
      onProgress(Math.min(bytesWritten, model.sizeBytes) / model.sizeBytes);
    },
  });
  const actual = downloaded.size;
  if (actual !== model.sizeBytes) {
    partial.delete();
    throw new Error(
      `Downloaded ${model.name} as ${actual} bytes, expected ${model.sizeBytes}.`,
    );
  }
  // `move`: same directory, so a rename — atomic, no second copy of the file.
  // Awaited because it crosses the bridge (`File.move` returns a promise): a
  // download that resolved before the rename landed would have the caller's
  // presence re-check stat a file that is still named `.part`, and report the
  // just-downloaded model as absent.
  await downloaded.move(destination);
  onProgress(1);
}
