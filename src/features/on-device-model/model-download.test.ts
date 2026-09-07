import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import {
  DEFAULT_ON_DEVICE_MODEL,
  ON_DEVICE_MODELS,
  onDeviceModel,
} from "@/features/on-device-model/on-device-catalog";

// The module under test is required FRESH in beforeEach (jest.resetModules +
// require, per AGENTS.md): its download store is deliberately module-scope —
// that is what makes a download survive the settings screen — so state from
// one test would leak into the next through the static import.
let modelDirectory: typeof import("@/features/on-device-model/model-download").modelDirectory;
let modelFile: typeof import("@/features/on-device-model/model-download").modelFile;
let modelPresence: typeof import("@/features/on-device-model/model-download").modelPresence;
let modelDownloadState: typeof import("@/features/on-device-model/model-download").modelDownloadState;
let observeModelDownload: typeof import("@/features/on-device-model/model-download").observeModelDownload;
let startModelDownload: typeof import("@/features/on-device-model/model-download").startModelDownload;
let reattachModelDownloads: typeof import("@/features/on-device-model/model-download").reattachModelDownloads;
let deleteModel: typeof import("@/features/on-device-model/model-download").deleteModel;

// Two seams, each faked inside its jest.mock factory (class bindings outside
// a factory are not initialized when the factory runs):
//
// - `expo-file-system` for the disk: presence, `.part` cleanup, the rename.
//   The fake's state lives in mock-prefixed bindings so tests can stage
//   per-file state from outside. The fake File keys on the LAST constructor
//   segment, and the fake Directory on the second-to-last (…/<modelId>),
//   which is exactly the real layout: document/whole_models/<modelId>/<fileName>.
// - `@kesha-antonov/react-native-background-downloader` for the transfer:
//   a fake DownloadTask whose handlers tests fire by hand, so the store's
//   reaction to progress/done/error is what's under test — the native side
//   is the library's to guarantee.
const mockFiles = new Map<
  string,
  { exists: boolean; size: number; deleted: boolean }
>();
const mockDirectories = new Set<string>();

type FakeHandlers = {
  progress?: (info: { bytesDownloaded: number }) => void;
  done?: () => void;
  error?: (info: { error: string; errorCode: number }) => void;
};

// The task the last createDownloadTask call returned, so a test can fire its
// handlers; null until one exists. The class itself lives INSIDE the jest.mock
// factory (jest hoists factory calls above class declarations — an out-of-scope
// class is a TDZ error even with the mock- prefix allowance); this helper is
// how tests construct the same fake for `getExistingDownloadTasks`.
let mockLastTask: ReturnType<typeof mockMakeTask> | null = null;
let mockMakeTask: (id: string) => {
  id: string;
  handlers: FakeHandlers;
  started: boolean;
  stopped: boolean;
};
const mockExistingTasks: ReturnType<typeof mockMakeTask>[] = [];
const mockCompleteHandler = jest.fn<(jobId: string) => Promise<void>>();

jest.mock("@kesha-antonov/react-native-background-downloader", () => {
  class MockDownloadTask {
    readonly id: string;
    readonly handlers: FakeHandlers = {};
    started = false;
    stopped = false;
    constructor(id: string) {
      this.id = id;
    }
    progress(handler: FakeHandlers["progress"]): this {
      this.handlers.progress = handler;
      return this;
    }
    done(handler: FakeHandlers["done"]): this {
      this.handlers.done = handler;
      return this;
    }
    error(handler: FakeHandlers["error"]): this {
      this.handlers.error = handler;
      return this;
    }
    start(): void {
      this.started = true;
    }
    stop(): Promise<void> {
      this.stopped = true;
      return Promise.resolve();
    }
  }
  mockMakeTask = (id: string) => new MockDownloadTask(id);
  return {
    createDownloadTask: ({ id }: { id: string }) => {
      const task = new MockDownloadTask(id);
      mockLastTask = task;
      return task;
    },
    getExistingDownloadTasks: async () => mockExistingTasks.slice(),
    completeHandler: (jobId: string) => mockCompleteHandler(jobId),
  };
});

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

// Delivers one model's download to a completed state through the fake task:
// fires progress ticks, lands the `.part`, and invokes the done handler —
// what the native layer would do for a successful transfer.
// Delivers one model's download to a completed state through the fake task:
// fires progress ticks, lands the `.part`, and awaits the done handler —
// which is async in the store (the rename awaits the bridge) — so the
// assertions after it see the settled state.
const deliver = async (
  task: ReturnType<typeof mockMakeTask>,
  id: "gemma-4-e2b" | "gemma-4-e4b",
) => {
  const model = onDeviceModel(id);
  task.handlers.progress?.({
    bytesDownloaded: Math.floor(model.sizeBytes / 2),
  });
  stage(`${model.fileName}.part`, model.sizeBytes);
  await task.handlers.done?.();
};

beforeEach(() => {
  jest.clearAllMocks();
  mockFiles.clear();
  mockDirectories.clear();
  mockLastTask = null;
  mockExistingTasks.length = 0;
  jest.resetModules();
  const fresh = jest.requireActual(
    "@/features/on-device-model/model-download",
  ) as typeof import("@/features/on-device-model/model-download");
  modelDirectory = fresh.modelDirectory;
  modelFile = fresh.modelFile;
  modelPresence = fresh.modelPresence;
  modelDownloadState = fresh.modelDownloadState;
  observeModelDownload = fresh.observeModelDownload;
  startModelDownload = fresh.startModelDownload;
  reattachModelDownloads = fresh.reattachModelDownloads;
  deleteModel = fresh.deleteModel;
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

describe("startModelDownload", () => {
  it("starts one task and reports progress into the store", () => {
    const model = onDeviceModel("gemma-4-e2b");
    const snapshots: string[] = [];
    observeModelDownload("gemma-4-e2b", (snapshot) =>
      snapshots.push(snapshot.phase),
    );

    startModelDownload("gemma-4-e2b");

    expect(mockLastTask?.started).toBe(true);
    expect(modelDownloadState("gemma-4-e2b")).toEqual({
      phase: "downloading",
      fraction: 0,
    });

    mockLastTask?.handlers.progress?.({
      bytesDownloaded: Math.floor(model.sizeBytes * 0.75),
    });
    expect(modelDownloadState("gemma-4-e2b").fraction).toBeCloseTo(0.75);
    expect(snapshots).toContain("downloading");
  });

  it("never reports more than the whole file", () => {
    const model = onDeviceModel("gemma-4-e2b");
    startModelDownload("gemma-4-e2b");

    mockLastTask?.handlers.progress?.({ bytesDownloaded: model.sizeBytes + 5 });

    expect(modelDownloadState("gemma-4-e2b").fraction).toBe(1);
  });

  it("moves the completed .part into place and settles to idle", async () => {
    const model = onDeviceModel("gemma-4-e2b");
    startModelDownload("gemma-4-e2b");

    await deliver(mockLastTask!, "gemma-4-e2b");

    expect(mockFiles.get(model.fileName)?.exists).toBe(true);
    expect(modelPresence("gemma-4-e2b").status).toBe("present");
    expect(modelDownloadState("gemma-4-e2b")).toEqual({
      phase: "idle",
      fraction: 1,
    });
  });

  it("signals the OS the job is over once the file lands", async () => {
    startModelDownload("gemma-4-e2b");
    await deliver(mockLastTask!, "gemma-4-e2b");

    expect(mockCompleteHandler).toHaveBeenCalledWith("gemma-4-e2b");
  });

  it("fails without installing a wrong-sized download", () => {
    const model = onDeviceModel("gemma-4-e2b");
    startModelDownload("gemma-4-e2b");

    mockLastTask?.handlers.progress?.({ bytesDownloaded: 100 });
    stage(`${model.fileName}.part`, 999);
    mockLastTask?.handlers.done?.();

    expect(mockFiles.get(`${model.fileName}.part`)?.deleted).toBe(true);
    expect(modelPresence("gemma-4-e2b").status).toBe("absent");
    expect(modelDownloadState("gemma-4-e2b").phase).toBe("failed");
  });

  it("removes a stale .part and a wrong-sized file before downloading", async () => {
    const model = onDeviceModel("gemma-4-e2b");
    stage(model.fileName, 5); // wrong-sized leftover
    stage(`${model.fileName}.part`, 7); // stale partial

    startModelDownload("gemma-4-e2b");
    await deliver(mockLastTask!, "gemma-4-e2b");

    expect(mockLastTask?.started).toBe(true);
    expect(modelPresence("gemma-4-e2b").status).toBe("present");
  });

  it("does not start a second task while one is in flight", () => {
    startModelDownload("gemma-4-e2b");
    const first = mockLastTask;
    startModelDownload("gemma-4-e2b");

    // A second task would race the first's `.part` — the start is a no-op.
    expect(mockLastTask).toBe(first);
    expect(first?.started).toBe(true);
  });

  it("starts fresh once the previous download settled", async () => {
    startModelDownload("gemma-4-e2b");
    await deliver(mockLastTask!, "gemma-4-e2b");

    startModelDownload("gemma-4-e2b");
    expect(mockLastTask).not.toBeNull();
    expect(mockLastTask?.started).toBe(true);
  });

  it("reports a failed transfer as failed, keeping the .part for a resume", () => {
    const model = onDeviceModel("gemma-4-e2b");
    startModelDownload("gemma-4-e2b");
    stage(`${model.fileName}.part`, 7);

    mockLastTask?.handlers.error?.({ error: "network", errorCode: 0 });

    // The partial file SURVIVES the failure: iOS resume data and Android's
    // paused-state recovery both build on the bytes already on disk.
    expect(mockFiles.get(`${model.fileName}.part`)?.deleted).toBeFalsy();
    expect(modelDownloadState("gemma-4-e2b").phase).toBe("failed");
    expect(mockCompleteHandler).toHaveBeenCalledWith("gemma-4-e2b");
  });

  it("keeps subscriptions informed and lets them go", () => {
    const seen: number[] = [];
    const unsubscribe = observeModelDownload("gemma-4-e2b", (snapshot) => {
      if (snapshot.phase === "downloading") {
        seen.push(snapshot.fraction);
      }
    });
    // The immediate current-state delivery: the store is idle before any
    // download, so the listener's first call carries phase "idle" and no
    // fraction is recorded yet.
    expect(seen).toEqual([]);

    startModelDownload("gemma-4-e2b");
    const model = onDeviceModel("gemma-4-e2b");
    mockLastTask?.handlers.progress?.({ bytesDownloaded: model.sizeBytes / 4 });
    unsubscribe();

    mockLastTask?.handlers.progress?.({ bytesDownloaded: model.sizeBytes / 2 });
    expect(seen).toEqual([0, 0.25]);
  });
});

describe("reattachModelDownloads", () => {
  it("adopts a task the OS kept running across a relaunch", async () => {
    const model = onDeviceModel("gemma-4-e2b");
    // A leftover from a previous process: the native session was still
    // transferring, half the file is already in the `.part`.
    stage(`${model.fileName}.part`, Math.floor(model.sizeBytes / 2));
    mockExistingTasks.push(mockMakeTask!("gemma-4-e2b"));

    await reattachModelDownloads();

    expect(modelDownloadState("gemma-4-e2b").phase).toBe("downloading");
    // The reattached task was NOT restarted — it is the same task, with new
    // handlers wired, and the download can continue from where it is.
    expect(mockExistingTasks[0]?.started).toBe(false);

    mockExistingTasks[0]?.handlers.progress?.({
      bytesDownloaded: model.sizeBytes,
    });
    stage(`${model.fileName}.part`, model.sizeBytes);
    mockExistingTasks[0]?.handlers.done?.();

    expect(modelPresence("gemma-4-e2b").status).toBe("present");
  });

  it("ignores ids the catalog no longer knows", async () => {
    mockExistingTasks.push(mockMakeTask!("gemma-3-nano"));

    await reattachModelDownloads();

    expect(modelDownloadState("gemma-4-e2b").phase).toBe("idle");
    expect(mockExistingTasks[0]?.handlers.done).toBeUndefined();
  });

  it("does not double-adopt a model that is already active", async () => {
    startModelDownload("gemma-4-e2b");
    const live = mockLastTask;
    mockExistingTasks.push(mockMakeTask!("gemma-4-e2b"));

    await reattachModelDownloads();

    // The live task keeps its handlers; the stale reattach record does not
    // rewire them.
    expect(live?.handlers.done).toBeDefined();
    expect(mockExistingTasks[0]?.handlers.done).toBeUndefined();
  });
});

describe("deleteModel", () => {
  it("stops an in-flight download and removes the model's directory", () => {
    const model = onDeviceModel("gemma-4-e2b");
    startModelDownload("gemma-4-e2b");
    const task = mockLastTask!;
    mockDirectories.add(model.id);
    stage(model.fileName, model.sizeBytes);

    deleteModel("gemma-4-e2b");

    expect(task.stopped).toBe(true);
    expect(mockDirectories.has(model.id)).toBe(false);
    expect(modelDownloadState("gemma-4-e2b").phase).toBe("idle");
  });

  it("is a no-op when the model is absent", () => {
    expect(() => deleteModel("gemma-4-e4b")).not.toThrow();
  });
});
