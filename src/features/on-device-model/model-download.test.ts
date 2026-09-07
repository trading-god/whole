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
  // The real handler is async (the settlement awaits the rename), so a test
  // firing it awaits the settled state.
  done?: () => void | Promise<void>;
  error?: (info: { error: string; errorCode: number }) => void;
};

type FakeTask = {
  id: string;
  handlers: FakeHandlers;
  started: boolean;
  stopped: boolean;
  resumed: boolean;
  /** The library's task.state, as getExistingDownloadTasks reports it. */
  state: "PENDING" | "DOWNLOADING" | "PAUSED" | "DONE" | "FAILED" | "STOPPED";
  bytesDownloaded: number;
};

// The task the last createDownloadTask call returned, so a test can fire its
// handlers; null until one exists. The class itself lives INSIDE the jest.mock
// factory (jest hoists factory calls above class declarations — an out-of-scope
// class is a TDZ error even with the mock- prefix allowance); this helper is
// how tests construct the same fake for `getExistingDownloadTasks`.
let mockLastTask: FakeTask | null = null;
// When set, the next createDownloadTask call throws — the native module
// failing to initialize, as a stale dev client would.
let mockCreateTaskShouldThrow: Error | null = null;
let mockMakeTask: (
  id: string,
  state?: FakeTask["state"],
  bytesDownloaded?: number,
) => FakeTask;
const mockExistingTasks: FakeTask[] = [];
const mockCompleteHandler = jest.fn<(jobId: string) => Promise<void>>();

jest.mock("@kesha-antonov/react-native-background-downloader", () => {
  class MockDownloadTask {
    readonly id: string;
    readonly handlers: FakeHandlers = {};
    started = false;
    stopped = false;
    resumed = false;
    state: FakeTask["state"] = "PENDING";
    bytesDownloaded = 0;
    constructor(
      id: string,
      state: FakeTask["state"] = "PENDING",
      bytesDownloaded = 0,
    ) {
      this.id = id;
      this.state = state;
      this.bytesDownloaded = bytesDownloaded;
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
    resume(): Promise<void> {
      this.resumed = true;
      return Promise.resolve();
    }
  }
  mockMakeTask = (id, state, bytesDownloaded) =>
    new MockDownloadTask(id, state, bytesDownloaded);
  return {
    createDownloadTask: ({ id }: { id: string }) => {
      if (mockCreateTaskShouldThrow) {
        const error = mockCreateTaskShouldThrow;
        mockCreateTaskShouldThrow = null;
        throw error;
      }
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
// fires progress ticks, lands the `.part`, and awaits the done handler —
// which is async in the store (the rename awaits the bridge) — so the
// assertions after it see the settled state.
const deliver = async (task: FakeTask, id: "gemma-4-e2b" | "gemma-4-e4b") => {
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
  mockCreateTaskShouldThrow = null;
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

  it("lands in failed when the task cannot even be created", () => {
    // The native module not linked (a stale dev client) throws inside
    // createDownloadTask: the store must settle to failed — re-offering
    // Download — rather than sticking at "downloading" with nothing that
    // will ever tick.
    mockCreateTaskShouldThrow = new Error("not linked");

    expect(() => startModelDownload("gemma-4-e2b")).not.toThrow();
    expect(modelDownloadState("gemma-4-e2b").phase).toBe("failed");

    // And the failed start does not poison the next one.
    startModelDownload("gemma-4-e2b");
    expect(mockLastTask?.started).toBe(true);
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
    mockDirectories.add("whole_models");
    stage(`${model.fileName}.part`, Math.floor(model.sizeBytes / 2));
    mockExistingTasks.push(
      mockMakeTask!(
        "gemma-4-e2b",
        "DOWNLOADING",
        Math.floor(model.sizeBytes / 2),
      ),
    );

    await reattachModelDownloads();

    expect(modelDownloadState("gemma-4-e2b").phase).toBe("downloading");
    // The first rendered fraction is the transfer's own byte count, not a
    // restart to 0 — the row must not claim progress was lost.
    expect(modelDownloadState("gemma-4-e2b").fraction).toBeCloseTo(0.5);
    // The reattached task was NOT restarted — it is the same task, with new
    // handlers wired, and the download can continue from where it is.
    expect(mockExistingTasks[0]?.started).toBe(false);

    mockExistingTasks[0]?.handlers.progress?.({
      bytesDownloaded: model.sizeBytes,
    });
    stage(`${model.fileName}.part`, model.sizeBytes);
    await mockExistingTasks[0]?.handlers.done?.();

    expect(modelPresence("gemma-4-e2b").status).toBe("present");
  });

  it("settles a download that completed while the app was dead", async () => {
    const model = onDeviceModel("gemma-4-e2b");
    // The transfer finished with no JS attached: the bytes are all in the
    // `.part`, and no event will ever fire for the task again.
    mockDirectories.add("whole_models");
    stage(`${model.fileName}.part`, model.sizeBytes);
    mockExistingTasks.push(
      mockMakeTask!("gemma-4-e2b", "DONE", model.sizeBytes),
    );

    await reattachModelDownloads();

    // The settlement ran on the spot: the file moved into place and the
    // store settled — not a phantom "downloading" that can never finish.
    expect(modelPresence("gemma-4-e2b").status).toBe("present");
    expect(modelDownloadState("gemma-4-e2b")).toEqual({
      phase: "idle",
      fraction: 1,
    });
  });

  it("fails a dead-completed download whose bytes do not check out", async () => {
    const model = onDeviceModel("gemma-4-e2b");
    mockDirectories.add("whole_models");
    stage(`${model.fileName}.part`, 999);
    mockExistingTasks.push(mockMakeTask!("gemma-4-e2b", "DONE", 999));

    await reattachModelDownloads();

    expect(modelDownloadState("gemma-4-e2b").phase).toBe("failed");
    expect(modelPresence("gemma-4-e2b").status).toBe("absent");
  });

  it("resumes a paused task instead of parking it", async () => {
    const model = onDeviceModel("gemma-4-e2b");
    mockDirectories.add("whole_models");
    stage(`${model.fileName}.part`, Math.floor(model.sizeBytes / 4));
    mockExistingTasks.push(
      mockMakeTask!("gemma-4-e2b", "PAUSED", Math.floor(model.sizeBytes / 4)),
    );

    await reattachModelDownloads();

    // A paused task never reports another event on its own — the resume is
    // what makes the adoption live rather than a bar frozen at its starting
    // fraction.
    expect(mockExistingTasks[0]?.resumed).toBe(true);
    expect(modelDownloadState("gemma-4-e2b").phase).toBe("downloading");
    expect(modelDownloadState("gemma-4-e2b").fraction).toBeCloseTo(0.25);
  });

  it("stops ids the catalog no longer knows", async () => {
    mockDirectories.add("whole_models");
    const orphan = mockMakeTask!("gemma-3-nano", "DOWNLOADING", 0);
    mockExistingTasks.push(orphan);

    await reattachModelDownloads();

    // An orphaned native transfer is stopped, not silently left running for
    // a model this build can neither install nor clean up after.
    expect(orphan.stopped).toBe(true);
    expect(modelDownloadState("gemma-4-e2b").phase).toBe("idle");
    expect(orphan.handlers.done).toBeUndefined();
  });

  it("does not double-adopt a model that is already active", async () => {
    mockDirectories.add("whole_models");
    startModelDownload("gemma-4-e2b");
    const live = mockLastTask;
    mockExistingTasks.push(mockMakeTask!("gemma-4-e2b", "DOWNLOADING", 0));

    await reattachModelDownloads();

    // The live task keeps its handlers; the stale reattach record does not
    // rewire them.
    expect(live?.handlers.done).toBeDefined();
    expect(mockExistingTasks[0]?.handlers.done).toBeUndefined();
  });

  it("defers a start that lands mid-reattach instead of racing it", async () => {
    // The launch-time hole: the user reaches Settings before the reattach's
    // bridge call resolves and taps Download. A start that ran immediately
    // would delete the OS-resident task's `.part` and start a second native
    // task beside it — the queue behind the reattach closes the window.
    mockDirectories.add("whole_models");
    mockExistingTasks.push(mockMakeTask!("gemma-4-e2b", "DOWNLOADING", 0));
    const reattaching = reattachModelDownloads();

    startModelDownload("gemma-4-e2b");
    // Still mid-reattach: no task was created, and the OS-resident one was
    // not disturbed.
    expect(mockLastTask).toBeNull();

    await reattaching;

    // The queued start found the adopted task and became a no-op.
    expect(mockLastTask).toBeNull();
    expect(modelDownloadState("gemma-4-e2b").phase).toBe("downloading");
  });

  it("runs a queued start fresh when the reattach found nothing for it", async () => {
    mockDirectories.add("whole_models");
    const reattaching = reattachModelDownloads();
    startModelDownload("gemma-4-e2b");
    await reattaching;

    // No OS-resident task for the model: the queued start ran after the
    // reattach settled, creating its own.
    expect(mockLastTask?.started).toBe(true);
  });

  it("skips the native query entirely when no download ever ran", async () => {
    // The models root does not exist: nothing was ever downloaded, so there
    // is no OS-side session to consult — the launch-path cost is skipped.
    reattachModelDownloads();
    await Promise.resolve();
    expect(modelDownloadState("gemma-4-e2b").phase).toBe("idle");
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

  it("ignores the stopped task's late events instead of re-publishing", () => {
    // iOS delivers the cancel as `downloadFailed`, and a done event may
    // already be queued when the user taps Delete: a retired task's tail
    // must not flip the row back to a progress bar or a spurious failure.
    const model = onDeviceModel("gemma-4-e2b");
    startModelDownload("gemma-4-e2b");
    const task = mockLastTask!;

    deleteModel("gemma-4-e2b");
    task.handlers.error?.({ error: "cancelled", errorCode: -999 });
    task.handlers.progress?.({ bytesDownloaded: model.sizeBytes });
    stage(`${model.fileName}.part`, model.sizeBytes);
    void task.handlers.done?.();

    expect(modelDownloadState("gemma-4-e2b")).toEqual({
      phase: "idle",
      fraction: 0,
    });
    // And the directory the delete removed was not resurrected by a late
    // settlement re-creating it for the move.
    expect(mockFiles.get(model.fileName)?.exists).toBeFalsy();
  });

  it("is a no-op when the model is absent", () => {
    expect(() => deleteModel("gemma-4-e4b")).not.toThrow();
  });
});
