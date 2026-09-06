import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import { BUNDLED_MODEL } from "@/features/on-device-model/on-device-catalog";
import {
  bundledModelStorageBytes,
  resolveBundledModelPath,
} from "@/features/on-device-model/model-source";

// expo-file-system is the single native seam; the fake below keeps the real
// constructor's joining semantics (a directory as a uri, then path segments)
// so the tests assert the ACTUAL directory name, not one invented here.
const mockFile = {
  exists: false,
  // Keyed by file name so a test can make ONE shard wrong; anything absent
  // from the map reports nothing (a missing file).
  sizes: new Map<string, number>(),
  deleted: [] as string[],
};

jest.mock("expo-file-system", () => {
  class FakeFile {
    private readonly segments: string[];
    constructor(...segments: (string | { uri: string })[]) {
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
  // Every shard healthy by default; a test that wants a corrupt or missing
  // one deletes/overwrites its entry.
  mockFile.sizes = new Map(
    BUNDLED_MODEL.shards.map((shard) => [shard.fileName, shard.sizeBytes]),
  );
  mockFile.deleted = [];
});

describe("bundledModelStorageBytes", () => {
  it("reports one copy — the same number on both platforms", () => {
    // The weights are downloaded to filesDir and read in place; the bundled
    // era's Android double copy (APK + extraction) is gone, which is the whole
    // point of the download flow.
    expect(bundledModelStorageBytes()).toBe(BUNDLED_MODEL.sizeBytes);
  });
});

describe("resolveBundledModelPath", () => {
  it("hands over the first shard's filesDir path when every shard is present", () => {
    mockFile.exists = true;

    const path = resolveBundledModelPath();

    // The REAL directory name — `model-download.ts` writes into
    // `whole_models`, and nothing re-declares it; a rename here must fail this
    // test rather than silently diverge.
    expect(path).toBe(`file:///docs/whole_models/${BUNDLED_MODEL.fileName}`);
  });

  it("refuses to proceed when a shard is missing", () => {
    mockFile.exists = true;
    mockFile.sizes.delete(BUNDLED_MODEL.shards[2].fileName);

    expect(() => resolveBundledModelPath()).toThrow(/not downloaded/);
  });

  it("refuses to proceed when a shard is the wrong size", () => {
    mockFile.exists = true;
    mockFile.sizes.set(BUNDLED_MODEL.shards[1].fileName, 12);

    // A truncated file would fail deep inside the loader with a message about
    // GGUF headers; this says what the user can act on.
    expect(() => resolveBundledModelPath()).toThrow(/not downloaded/);
  });
});
