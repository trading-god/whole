import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { Platform } from "react-native";

import { BUNDLED_MODEL } from "@/features/on-device-model/on-device-catalog";
import {
  bundledModelStorageBytes,
  canLoadBundledModelDirectly,
  resolveBundledModelPath,
} from "@/features/on-device-model/model-source";

// expo-file-system is the single native seam left (the Android copy check);
// llama.rn's bundle-path resolution and the patched module's extraction are
// native behavior, not something the JS can fake.
const mockFile = {
  exists: false,
  // Keyed by file name so a test can make ONE shard wrong; anything absent
  // from the map reports the catalog's size, i.e. a healthy copy.
  sizes: new Map<string, number>(),
  deleted: [] as string[],
};

jest.mock("expo-file-system", () => {
  class FakeFile {
    private readonly segments: string[];
    constructor(...segments: (string | { uri: string })[]) {
      // The same joining the real File performs: a directory (as a uri)
      // followed by plain path segments. Keeping it real means the Android
      // test below asserts the actual directory name, not one invented here.
      this.segments = segments.map((segment) =>
        typeof segment === "string" ? segment : segment.uri,
      );
    }
    get exists(): boolean {
      return mockFile.exists;
    }
    get size(): number {
      // Seeded per test from the catalog; a factory may not reach a
      // non-`mock`-prefixed binding, so the sizes arrive through `mockFile`.
      return mockFile.sizes.get(this.segments[this.segments.length - 1]) ?? 0;
    }
    delete(): void {
      mockFile.deleted.push(this.segments[this.segments.length - 1]);
    }
    get uri(): string {
      return this.segments.join("/");
    }
  }
  return {
    File: FakeFile,
    Paths: { document: { uri: "file:///docs" } },
  };
});

beforeEach(() => {
  jest.clearAllMocks();
  mockFile.exists = false;
  // Every shard healthy by default; a test that wants a corrupt one overwrites
  // its entry.
  mockFile.sizes = new Map(
    BUNDLED_MODEL.shards.map((shard) => [shard.fileName, shard.sizeBytes]),
  );
  mockFile.deleted = [];
});

// The Platform branch is covered by the two jest-expo projects: the iOS
// project runs the iOS arms, the Android project the Android ones, and the
// merged coverage sees both without an ignore comment.
describe("canLoadBundledModelDirectly", () => {
  it("matches the platform it runs on", () => {
    expect(canLoadBundledModelDirectly()).toBe(Platform.OS === "ios");
  });
});

describe("bundledModelStorageBytes", () => {
  it("counts the copy Android keeps in the APK as well as the extracted one", () => {
    // The number the settings card prints. On Android the shards are read out
    // of the APK into filesDir and the APK keeps its own, so the device holds
    // two copies; telling the user one would understate it by ~3 GB.
    expect(bundledModelStorageBytes()).toBe(
      canLoadBundledModelDirectly()
        ? BUNDLED_MODEL.sizeBytes
        : BUNDLED_MODEL.sizeBytes * 2,
    );
  });
});

describe("resolveBundledModelPath", () => {
  it("on iOS hands over the bundle resource name", async () => {
    if (!canLoadBundledModelDirectly()) {
      return;
    }

    const path = await resolveBundledModelPath();

    // The BARE name: llama.rn's `is_model_asset` resolves it against the
    // main bundle natively, so the JS side never needs the absolute path.
    expect(path).toBe(BUNDLED_MODEL.fileName);
  });

  it("on Android hands over the extracted copy's path", async () => {
    if (canLoadBundledModelDirectly()) {
      return;
    }
    mockFile.exists = true;

    const path = await resolveBundledModelPath();

    // The REAL directory name — the patched llama.rn module extracts into
    // `whole_models`, and the prebuild plugin hardcodes the same name (it
    // cannot import this module); a rename here must fail this test rather
    // than silently diverge from the plugin.
    expect(path).toBe(`file:///docs/whole_models/${BUNDLED_MODEL.fileName}`);
  });

  it("on Android deletes a wrong-sized shard so the next launch re-extracts it", async () => {
    if (canLoadBundledModelDirectly()) {
      return;
    }
    mockFile.exists = true;
    const truncated = BUNDLED_MODEL.shards[1].fileName;
    mockFile.sizes.set(truncated, 12);

    // The native extraction skips any shard already present, so a truncated
    // copy left in place would be permanent. Reporting it is not enough.
    await expect(resolveBundledModelPath()).rejects.toThrow(
      /has not been extracted/,
    );
    expect(mockFile.deleted).toEqual([truncated]);
  });

  it("on Android refuses to proceed before the shards are extracted", async () => {
    if (canLoadBundledModelDirectly()) {
      return;
    }

    await expect(resolveBundledModelPath()).rejects.toThrow(
      /has not been extracted/,
    );
  });
});
