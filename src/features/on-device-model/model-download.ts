// Downloads the on-device model's shards into filesDir, on demand.
//
// The weights no longer ship inside the install: a 3.1 GB bundle put the
// Android APK past Google Play's 150 MB base-module cap and made the iOS
// download unreasonably large for a feature a user may never use. Instead the
// settings screen offers the download; this module performs it and owns
// everything about the files on disk.
//
// The seam is `expo-file-system`'s new `File`/`Directory` API plus
// `File.downloadFileAsync` — one import surface, mockable as a single module,
// which is what keeps this testable under Jest (see test-boundary.mjs: this
// file is NOT Node-importable; it lives on the Jest side of the boundary).
//
// Integrity is by SIZE, not checksum: the catalog's expected bytes are the
// same values the pre-download check and the post-download verification use,
// and a wrong-sized file is deleted so a retry can replace it (the same
// policy `model-source.ts` applies to a corrupted extraction). A
// content-hash would be stronger, but reading 3.1 GB back through the JS
// bridge to hash it costs more than the failure mode it rules out.
import { Directory, File, Paths } from "expo-file-system";

import {
  BUNDLED_MODEL,
  shardUrl,
} from "@/features/on-device-model/on-device-catalog";

/** The directory every shard is downloaded into, under `Paths.document`. */
export const MODEL_DIR_NAME = "whole_models";

/** The directory the shards live in, resolved on demand (Paths.document). */
function modelDir(): Directory {
  return new Directory(Paths.document, MODEL_DIR_NAME);
}

/** One shard's file at its final resting place. */
export function shardFile(fileName: string): File {
  return new File(modelDir(), fileName);
}

export type ModelPresence =
  | { status: "absent" }
  | {
      /** Every shard is present and the right size — the model is loadable. */
      status: "present";
      /** Total bytes on disk (equal to `BUNDLED_MODEL.sizeBytes`). */
      sizeBytes: number;
    }
  | {
      /** Some shards exist but the set is incomplete or a size is wrong. */
      status: "partial";
      /**
       * Bytes on disk that BELONG to this model — a completed-shard subtotal,
       * not the raw directory size, so a wrong-sized file does not count
       * toward "how much is downloaded".
       */
      sizeBytes: number;
    };

/**
 * Reads the model's presence from the filesystem — the single truth, never a
 * stored flag. A "downloaded" boolean in kv-store would drift from disk the
 * first time iOS reclaimed space or a user cleared it; the files either load
 * or they do not.
 *
 * A wrong-SIZED shard reads as partial, and is deleted: the next download
 * retries it (see `downloadModel`), rather than every launch finding a
 * "present" model that fails deep inside the loader.
 */
export function modelPresence(): ModelPresence {
  let complete = true;
  let sizeBytes = 0;
  for (const shard of BUNDLED_MODEL.shards) {
    const file = shardFile(shard.fileName);
    if (!file.exists || file.size !== shard.sizeBytes) {
      complete = false;
      if (file.exists) {
        try {
          file.delete();
        } catch {
          // Reported as partial either way; the next download retries.
        }
      }
      continue;
    }
    sizeBytes += shard.sizeBytes;
  }
  if (complete) {
    return { status: "present", sizeBytes };
  }
  return sizeBytes === 0
    ? { status: "absent" }
    : { status: "partial", sizeBytes };
}

/** Deletes every shard (and the directory, once empty). No-op when absent. */
export function deleteModel(): void {
  const dir = modelDir();
  if (!dir.exists) {
    return;
  }
  // The whole directory rather than shard-by-shard: nothing else writes
  // here, and a stale `.part` from an interrupted download must go too.
  dir.delete();
}

export type DownloadProgress = {
  /** 0..1 across the WHOLE model — completed shards plus the active one. */
  fraction: number;
  /** Bytes of the whole model that are settled (done or downloaded). */
  sizeBytes: number;
};

/**
 * Downloads every missing shard, sequentially.
 *
 * Sequential on purpose: the shards are ~1.5 GB each and the destination is
 * the device's own storage — three parallel streams compete for the same
 * bandwidth without finishing any shard sooner, and a phone on cellular
 * throttling to a crawl is the exact case where one honest progress bar beats
 * three frozen ones.
 *
 * Each shard lands at `<name>.part` and is MOVED into place only after its
 * size checks out, so an interrupted download never leaves a truncated file
 * the presence check would have to disambiguate. (`File.downloadFileAsync`
 * itself already stages on iOS; the explicit `.part` covers Android, where
 * the response streams straight into the destination.)
 */
export async function downloadModel(
  onProgress: (progress: DownloadProgress) => void,
): Promise<void> {
  const dir = modelDir();
  dir.create({ intermediates: true, idempotent: true });

  const shards = [...BUNDLED_MODEL.shards];
  // Completed shards count toward progress before the first byte moves, so
  // the bar reflects a resumed download rather than restarting from zero.
  let settled = shards
    .filter((shard) => shardFile(shard.fileName).size === shard.sizeBytes)
    .reduce((total, shard) => total + shard.sizeBytes, 0);

  for (const shard of shards) {
    const destination = shardFile(shard.fileName);
    if (destination.exists && destination.size === shard.sizeBytes) {
      continue;
    }
    // A wrong-sized leftover (a download interrupted at rename time, a
    // partially reclaimed file) would make `move` below throw rather than
    // replace — remove it so the fresh shard can land.
    if (destination.exists) {
      destination.delete();
    }
    const partial = new File(dir, `${shard.fileName}.part`);
    // A stale `.part` (an interrupted earlier run) must not block the fresh
    // download: `downloadFileAsync` rejects when the destination exists.
    if (partial.exists) {
      partial.delete();
    }
    const downloaded = await File.downloadFileAsync(
      shardUrl(shard.fileName),
      partial,
      {
        // Progress per shard is rebased onto the whole model: a 43 MB first
        // shard is 1.4% of the download, and a bar that jumped to 100% on it
        // would be a lie the next shard immediately told on.
        onProgress: ({ bytesWritten }) => {
          onProgress({
            fraction:
              (settled + Math.min(bytesWritten, shard.sizeBytes)) /
              BUNDLED_MODEL.sizeBytes,
            sizeBytes: settled + Math.min(bytesWritten, shard.sizeBytes),
          });
        },
      },
    );
    const actual = downloaded.size;
    if (actual !== shard.sizeBytes) {
      partial.delete();
      throw new Error(
        `Downloaded shard ${shard.fileName} is ${actual} bytes, expected ${shard.sizeBytes}.`,
      );
    }
    // `move`: same directory, so a rename — atomic, no second copy of 1.5 GB.
    downloaded.move(destination);
    settled += shard.sizeBytes;
    onProgress({
      fraction: settled / BUNDLED_MODEL.sizeBytes,
      sizeBytes: settled,
    });
  }
}
