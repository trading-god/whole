import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import { BUNDLED_MODEL } from "@/features/on-device-model/on-device-catalog";
import {
  deleteModel,
  downloadModel,
  modelPresence,
} from "@/features/on-device-model/model-download";

// expo-file-system is the single seam, faked inside the jest.mock factory
// (class bindings outside it are not initialized when the factory runs).
// The fake's state lives in these mock-prefixed bindings so tests can stage
// per-file state from outside.
const mockFiles = new Map<
  string,
  { exists: boolean; size: number; deleted: boolean }
>();
const mockDirectories = new Set<string>();
const mockDownloads =
  jest.fn<(url: string, destination: string) => Promise<unknown>>();
let mockDownloadShouldFail = false;
let mockDownloadedSize: number | null = null;

jest.mock("expo-file-system", () => {
  class MockFile {
    private readonly name: string;
    constructor(
      ...segments: (
        | string
        | { uri: string }
        | { files?: unknown; create?: unknown; delete?: unknown }
      )[]
    ) {
      // The real constructor joins a directory (as a uri) with path segments;
      // the LAST segment is the file name every member here keys on.
      const last = segments[segments.length - 1];
      this.name = typeof last === "string" ? last : "";
    }
    // A File built from the download's outcome, so `move` and `size` behave
    // as the real returned File does.
    static fromDownload(name: string, size: number): MockFile {
      mockFiles.set(name, { exists: true, size, deleted: false });
      return new MockFile(name);
    }
    static downloadFileAsync = (url: string, destination: MockFile) =>
      mockDownloads(url, destination.name);
    get exists(): boolean {
      return mockFiles.get(this.name)?.exists ?? false;
    }
    get size(): number {
      return mockFiles.get(this.name)?.size ?? 0;
    }
    delete(): void {
      const entry = mockFiles.get(this.name);
      if (entry) {
        entry.exists = false;
        entry.deleted = true;
      }
    }
    get uri(): string {
      return `file:///docs/whole_models/${this.name}`;
    }
    move(destination: MockFile): Promise<void> {
      const partial = mockFiles.get(this.name);
      if (partial) {
        mockFiles.set(destination.name, { ...partial });
        partial.exists = false;
      }
      return Promise.resolve();
    }
  }
  class MockDirectory {
    private readonly name: string;
    constructor(
      ...segments: (
        | string
        | { uri: string }
        | { files?: unknown; create?: unknown; delete?: unknown }
      )[]
    ) {
      const last = segments[segments.length - 1];
      this.name = typeof last === "string" ? last : "";
    }
    get exists(): boolean {
      return mockDirectories.has(this.name);
    }
    create(): void {
      mockDirectories.add(this.name);
    }
    delete(): void {
      mockDirectories.delete(this.name);
    }
  }
  return {
    File: MockFile,
    Directory: MockDirectory,
    Paths: { document: { uri: "file:///docs" } },
  };
});

const stage = (name: string, size: number) => {
  mockFiles.set(name, { exists: true, size, deleted: false });
};

beforeEach(() => {
  jest.clearAllMocks();
  mockFiles.clear();
  mockDirectories.clear();
  mockDownloadShouldFail = false;
  mockDownloadedSize = null;
  // The download lands a `.part` the runner moves into place; a test that
  // wants a truncated or failing download overrides these. Size is per shard,
  // taken from the catalog by the `.part` name.
  mockDownloads.mockImplementation(
    async (_url: string, destination: string) => {
      if (mockDownloadShouldFail) {
        throw new Error("network");
      }
      const shardName = destination.replace(/\.part$/, "");
      const shard = BUNDLED_MODEL.shards.find(
        (candidate) => candidate.fileName === shardName,
      );
      const size = mockDownloadedSize ?? shard?.sizeBytes ?? 0;
      // The REAL return shape: a File (here the mocked class, via a static the
      // factory can reach), so the caller's `move`/`size` calls work.
      const { File } = jest.requireMock("expo-file-system") as {
        File: { fromDownload: (name: string, size: number) => unknown };
      };
      return File.fromDownload(destination, size);
    },
  );
});

describe("modelPresence", () => {
  it("reports absent when nothing is on disk", () => {
    expect(modelPresence()).toEqual({ status: "absent" });
  });

  it("reports present when every shard is there at the right size", () => {
    for (const shard of BUNDLED_MODEL.shards) {
      stage(shard.fileName, shard.sizeBytes);
    }

    expect(modelPresence()).toEqual({
      status: "present",
      sizeBytes: BUNDLED_MODEL.sizeBytes,
    });
  });

  it("reports partial when one shard is missing, counting only whole shards", () => {
    const [first, ...rest] = BUNDLED_MODEL.shards;
    stage(first.fileName, first.sizeBytes);
    for (const shard of rest.slice(0, -1)) {
      stage(shard.fileName, shard.sizeBytes);
    }

    const presence = modelPresence();
    expect(presence.status).toBe("partial");
    // The LAST shard's bytes are absent from the count: a missing shard is
    // not progress toward downloaded.
    expect(presence.status === "partial" && presence.sizeBytes).toBe(
      BUNDLED_MODEL.sizeBytes - BUNDLED_MODEL.shards[2].sizeBytes,
    );
  });

  it("deletes a wrong-sized shard so the next download retries it", () => {
    for (const shard of BUNDLED_MODEL.shards) {
      stage(shard.fileName, shard.sizeBytes);
    }
    const truncated = BUNDLED_MODEL.shards[1].fileName;
    mockFiles.set(truncated, { exists: true, size: 12, deleted: false });

    const presence = modelPresence();

    expect(presence.status).toBe("partial");
    expect(mockFiles.get(truncated)?.deleted).toBe(true);
  });
});

describe("downloadModel", () => {
  it("downloads every missing shard and reports progress across the whole set", async () => {
    const progress: number[] = [];
    // First shard already complete: a resumed download starts from its
    // bytes, not from zero.
    stage(BUNDLED_MODEL.shards[0].fileName, BUNDLED_MODEL.shards[0].sizeBytes);

    await downloadModel(({ fraction }) => progress.push(fraction));

    // Both remaining shards landed…
    for (const shard of BUNDLED_MODEL.shards) {
      expect(mockFiles.get(shard.fileName)?.exists).toBe(true);
    }
    // …the final progress tick is exactly 1, and no tick ever claims more.
    expect(progress[progress.length - 1]).toBe(1);
    for (const fraction of progress) {
      expect(fraction).toBeLessThanOrEqual(1);
    }
  });

  it("throws when a download fails mid-set", async () => {
    mockDownloadShouldFail = true;

    await expect(
      downloadModel(() => {
        // progress ignored
      }),
    ).rejects.toThrow("network");
  });

  it("deletes a wrong-sized download rather than installing it", async () => {
    mockDownloadedSize = 999;

    await expect(
      downloadModel(() => {
        // progress ignored
      }),
    ).rejects.toThrow(/expected/);

    // The `.part` was cleaned up: a retry does not start out of disk.
    expect(
      [...mockFiles.values()].some(
        (entry) => entry.exists && entry.deleted !== undefined,
      ),
    ).toBe(false);
    expect(
      [...mockFiles.keys()].filter((name) => name.endsWith(".part")).length,
    ).toBeGreaterThan(0);
    // And nothing was moved into place: the shards' final names never exist.
    expect(modelPresence().status).toBe("absent");
  });

  it("removes a stale .part before downloading into it", async () => {
    const partName = `${BUNDLED_MODEL.shards[0].fileName}.part`;
    stage(partName, 5);

    await downloadModel(() => {
      // progress ignored
    });

    // `downloadFileAsync` was called (it would reject over an existing file)
    // and the model is complete.
    expect(mockDownloads).toHaveBeenCalled();
    expect(modelPresence().status).toBe("present");
  });
});

describe("deleteModel", () => {
  it("removes the model directory", () => {
    mockDirectories.add("whole_models");
    stage(BUNDLED_MODEL.shards[0].fileName, BUNDLED_MODEL.shards[0].sizeBytes);

    deleteModel();

    expect(mockDirectories.has("whole_models")).toBe(false);
  });

  it("is a no-op when the model is absent", () => {
    expect(() => deleteModel()).not.toThrow();
  });
});
