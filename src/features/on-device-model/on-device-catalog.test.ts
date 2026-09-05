import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { BUNDLED_MODEL } from "@/features/on-device-model/on-device-catalog";

// The catalog is a constant; the assertions pin the invariants its consumers
// rely on — the settings card formats the size, and the prebuild plugin copies
// every shard into both native bundles.
// An LFS pointer is a few lines of text; a shard is gigabytes. Nothing in
// between exists, so the threshold does not need to be precise.
const LFS_POINTER_MAX_BYTES = 4096;

function shardsOnDisk(): { name: string; size: number }[] {
  const dir = fileURLToPath(new URL("../../../assets/models", import.meta.url));
  return readdirSync(dir)
    .filter((name) => name.endsWith(".gguf"))
    .sort()
    .map((name) => ({ name, size: statSync(join(dir, name)).size }));
}

describe("BUNDLED_MODEL", () => {
  it("points the runtime at the first shard", () => {
    // llama.cpp resolves a split model's siblings from the FIRST shard's name,
    // so the path handed to the runtime has to be that one and no other.
    expect(BUNDLED_MODEL.fileName).toBe(BUNDLED_MODEL.shards[0]?.fileName);
  });

  it("keeps every shard under the 2 GiB zip64 line", () => {
    // The split exists for two reasons (see the catalog): Android's APK is a
    // zip, where sub-2-GiB members stay clear of zip64 edge cases on older
    // extractors, and llama.cpp loads split models from the FIRST shard's
    // name. One shard over the line reintroduces exactly the zip64 edge cases
    // the split was bought to avoid.
    for (const shard of BUNDLED_MODEL.shards) {
      expect(shard.sizeBytes).toBeLessThan(2 ** 31);
    }
  });

  it("sizes the model as the sum of its shards", () => {
    const total = BUNDLED_MODEL.shards.reduce(
      (sum, shard) => sum + shard.sizeBytes,
      0,
    );
    expect(BUNDLED_MODEL.sizeBytes).toBe(total);
    expect(BUNDLED_MODEL.sizeBytes).toBeGreaterThan(3_000_000_000);
  });

  it("names exactly the shards the prebuild plugin bundles", () => {
    // The plugin derives its file list from assets/models/ at prebuild; the
    // catalog declares the same set for the app. Nothing at build time ties
    // them together, so this pins the NAMES: a new quant dropped into the
    // directory without a catalog update fails here instead of at first load
    // on device. CI checkouts hold LFS pointers, not weights — the names are
    // identical either way, and names are all this asserts.
    expect(shardsOnDisk().map(({ name }) => name)).toEqual(
      BUNDLED_MODEL.shards.map((shard) => shard.fileName),
    );
  });

  it("declares each shard's real size wherever the weights are present", () => {
    // `sizeBytes` is not decoration: on Android `resolveBundledModelPath`
    // DELETES an extracted shard whose size does not match, so a stale number
    // would make every launch extract three gigabytes and throw them away
    // again. Skipped where the checkout holds LFS pointers (CI), asserted
    // everywhere the weights actually are — which includes any machine that
    // can build the app.
    const onDisk = shardsOnDisk();
    if (onDisk.every(({ size }) => size < LFS_POINTER_MAX_BYTES)) {
      return;
    }
    expect(onDisk.map(({ size }) => size)).toEqual(
      BUNDLED_MODEL.shards.map((shard) => shard.sizeBytes),
    );
  });
});
