import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import {
  DEFAULT_ON_DEVICE_MODEL,
  ON_DEVICE_MODELS,
  onDeviceModel,
} from "@/features/on-device-model/on-device-catalog";
import {
  deleteModel,
  downloadModel,
  modelDirectory,
  modelFile,
  modelPresence,
} from "@/features/on-device-model/model-download";
import { deferred } from "@/test-support/deferred";

// expo-file-system is the single seam, faked inside the jest.mock factory
// (class bindings outside it are not initialized when the factory runs).
// The fake's state lives in these mock-prefixed bindings so tests can stage
// per-file state from outside. The fake File keys on the LAST constructor
// segment, and the fake Directory on the second-to-last (…/<modelId>), which
// is exactly the real layout: document/whole_models/<modelId>/<fileName>.
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
      const last = segments[segments.length - 1];
      this.name = typeof last === "string" ? last : "";
    }
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
      return `file:///docs/whole_models/<model>/${this.name}`;
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
      // The model id: the segment AFTER the root directory name, i.e. the
      // last one when the constructor is (Paths.document, root, modelId).
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
  // The download lands a `.part` the caller moves into place; a test that
  // wants a truncated or failing download overrides these. Size is per
  // MODEL, taken from the catalog by the `.part` name.
  mockDownloads.mockImplementation(
    async (_url: string, destination: string) => {
      if (mockDownloadShouldFail) {
        throw new Error("network");
      }
      const fileName = destination.replace(/\.part$/, "");
      const model = ON_DEVICE_MODELS.find(
        (candidate) => candidate.fileName === fileName,
      );
      const size = mockDownloadedSize ?? model?.sizeBytes ?? 0;
      // The REAL return shape: a File, so the caller's `move`/`size` calls work.
      const { File } = jest.requireMock("expo-file-system") as {
        File: { fromDownload: (name: string, size: number) => unknown };
      };
      return File.fromDownload(destination, size);
    },
  );
});

describe("the model layout", () => {
  it("gives each model its own directory under the model root", () => {
    // The directory name is the model id: two downloaded models never fight
    // over file names, and deleting one leaves the other whole.
    for (const model of ON_DEVICE_MODELS) {
      expect(modelDirectory(model.id)).toBeTruthy();
    }
  });

  it("names the model's file after the catalog's fileName", () => {
    expect(modelFile(DEFAULT_ON_DEVICE_MODEL.id).uri).toContain(
      DEFAULT_ON_DEVICE_MODEL.fileName,
    );
  });
});

describe("modelPresence", () => {
  it("reports absent when nothing is on disk", () => {
    expect(modelPresence("gemma-4-e2b")).toEqual({ status: "absent" });
  });

  it("reports present when the file is there at the right size", () => {
    const model = onDeviceModel("gemma-4-e2b");
    stage(model.fileName, model.sizeBytes);

    expect(modelPresence("gemma-4-e2b")).toEqual({
      status: "present",
      sizeBytes: model.sizeBytes,
    });
  });

  it("deletes a wrong-sized file so the next download retries it", () => {
    const model = onDeviceModel("gemma-4-e4b");
    stage(model.fileName, 12);

    const presence = modelPresence("gemma-4-e4b");

    expect(presence).toEqual({ status: "partial", sizeBytes: 12 });
    expect(mockFiles.get(model.fileName)?.deleted).toBe(true);
  });

  it("keeps the two models' presence independent", () => {
    const e2b = onDeviceModel("gemma-4-e2b");
    stage(e2b.fileName, e2b.sizeBytes);

    expect(modelPresence("gemma-4-e2b").status).toBe("present");
    expect(modelPresence("gemma-4-e4b").status).toBe("absent");
  });
});

describe("downloadModel", () => {
  it("downloads the model's file and reports progress to exactly 1", async () => {
    const model = onDeviceModel("gemma-4-e2b");
    const progress: number[] = [];

    await downloadModel("gemma-4-e2b", (fraction) => progress.push(fraction));

    expect(mockFiles.get(model.fileName)?.exists).toBe(true);
    // The final tick is exactly 1, and no tick ever claims more.
    expect(progress[progress.length - 1]).toBe(1);
    for (const fraction of progress) {
      expect(fraction).toBeLessThanOrEqual(1);
    }
    expect(modelPresence("gemma-4-e2b").status).toBe("present");
  });

  it("downloads from the catalog's URL", async () => {
    await downloadModel("gemma-4-e4b", () => {
      // progress ignored
    });

    expect(mockDownloads).toHaveBeenCalledWith(
      onDeviceModel("gemma-4-e4b").url,
      expect.any(String),
    );
  });

  it("throws when the download fails", async () => {
    mockDownloadShouldFail = true;

    await expect(
      downloadModel("gemma-4-e2b", () => {
        // progress ignored
      }),
    ).rejects.toThrow("network");
  });

  it("deletes a wrong-sized download rather than installing it", async () => {
    mockDownloadedSize = 999;

    await expect(
      downloadModel("gemma-4-e2b", () => {
        // progress ignored
      }),
    ).rejects.toThrow(/expected/);

    // The `.part` is gone and nothing was moved into place.
    expect(modelPresence("gemma-4-e2b").status).toBe("absent");
  });

  it("removes a stale .part and a wrong-sized file before downloading", async () => {
    const model = onDeviceModel("gemma-4-e2b");
    stage(model.fileName, 5); // wrong-sized leftover
    stage(`${model.fileName}.part`, 7); // stale partial

    await downloadModel("gemma-4-e2b", () => {
      // progress ignored
    });

    // `downloadFileAsync` ran (it would reject over an existing file) and
    // the model is complete.
    expect(mockDownloads).toHaveBeenCalled();
    expect(modelPresence("gemma-4-e2b").status).toBe("present");
  });

  it("joins an in-flight download instead of restarting it", async () => {
    const model = onDeviceModel("gemma-4-e2b");
    const { File } = jest.requireMock("expo-file-system") as {
      File: { fromDownload: (name: string, size: number) => unknown };
    };
    const gate = deferred<unknown>();
    mockDownloads.mockReturnValue(gate.promise);

    const firstProgress: number[] = [];
    const secondProgress: number[] = [];
    const first = downloadModel("gemma-4-e2b", (fraction) =>
      firstProgress.push(fraction),
    );
    const second = downloadModel("gemma-4-e2b", (fraction) =>
      secondProgress.push(fraction),
    );

    // A second `downloadFileAsync` for the same model would delete the
    // `.part` the first is still writing into — the join must not start one.
    expect(mockDownloads).toHaveBeenCalledTimes(1);

    gate.resolve(File.fromDownload(`${model.fileName}.part`, model.sizeBytes));
    await Promise.all([first, second]);

    // Both callers ride the one download, progress included.
    expect(firstProgress).toEqual([1]);
    expect(secondProgress).toEqual([1]);
    expect(modelPresence("gemma-4-e2b").status).toBe("present");

    // The guard is per-download, not forever: once settled, the next start
    // runs fresh.
    mockDownloads.mockImplementation(
      async (_url: string, destination: string) =>
        File.fromDownload(destination, model.sizeBytes),
    );
    await downloadModel("gemma-4-e2b", () => {
      // progress ignored
    });
    expect(mockDownloads).toHaveBeenCalledTimes(2);
  });
});

describe("deleteModel", () => {
  it("removes the model's directory", () => {
    const model = onDeviceModel("gemma-4-e2b");
    mockDirectories.add(model.id);
    stage(model.fileName, model.sizeBytes);

    deleteModel("gemma-4-e2b");

    expect(mockDirectories.has(model.id)).toBe(false);
  });

  it("is a no-op when the model is absent", () => {
    expect(() => deleteModel("gemma-4-e4b")).not.toThrow();
  });
});
