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
type ModelDownload = typeof import("@/features/on-device-model/model-download");
let modelDirectory: ModelDownload["modelDirectory"];
let modelFile: ModelDownload["modelFile"];
let modelPresence: ModelDownload["modelPresence"];
let modelDownloadState: ModelDownload["modelDownloadState"];
let observeModelDownload: ModelDownload["observeModelDownload"];
let observeModelPresence: ModelDownload["observeModelPresence"];
let startModelDownload: ModelDownload["startModelDownload"];
let pauseModelDownload: ModelDownload["pauseModelDownload"];
let resumeModelDownload: ModelDownload["resumeModelDownload"];
let reattachModelDownloads: ModelDownload["reattachModelDownloads"];
let deleteModel: ModelDownload["deleteModel"];

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
  paused: boolean;
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
// When set, the next task.start() call throws AFTER the task exists — a
// bridge method missing on a stale dev client, the case that poisons the
// one-download guard if the start's catch does not retire the task.
let mockStartShouldThrow: Error | null = null;
// When set, the next task.resume() call rejects — the transfer refusing to
// continue (a session invalidated under us, an expired resume token).
let mockResumeShouldReject: Error | null = null;
// When set, the next task.resume() stays pending until the test calls the
// `reject` it receives — the "rejection lands late" race (after whatever
// ran meanwhile, e.g. the transfer's own settlement).
let mockResumeDeferred: { reject?: (error: Error) => void } | null = null;
// When set, the next task.pause() call rejects — the pause failing to take
// while the transfer keeps running.
let mockPauseShouldReject: Error | null = null;
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
    paused = false;
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
      if (mockStartShouldThrow) {
        const error = mockStartShouldThrow;
        mockStartShouldThrow = null;
        throw error;
      }
      this.started = true;
    }
    stop(): Promise<void> {
      this.stopped = true;
      return Promise.resolve();
    }
    pause(): Promise<void> {
      this.paused = true;
      if (mockPauseShouldReject) {
        const error = mockPauseShouldReject;
        mockPauseShouldReject = null;
        return Promise.reject(error);
      }
      return Promise.resolve();
    }
    resume(): Promise<void> {
      this.resumed = true;
      if (mockResumeShouldReject) {
        const error = mockResumeShouldReject;
        mockResumeShouldReject = null;
        return Promise.reject(error);
      }
      if (mockResumeDeferred) {
        const deferred = mockResumeDeferred;
        mockResumeDeferred = null;
        return new Promise((_resolve, reject) => {
          deferred.reject = reject;
        });
      }
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
    create(): void {
      mockFiles.set(this.name, { exists: true, size: 0, deleted: false });
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

// The marker file a user pause leaves beside the `.part` (`userPausedMarker`
// in the module): staged like any other file when a test needs a pause the
// app itself wrote before the process died.
const userPausedMarkerName = (id: "gemma-4-e2b" | "gemma-4-e4b") =>
  `${id}.user-paused`;

// Delivers one model's download to a completed state through the fake task:
// fires progress ticks, lands the `.part`, and awaits the done handler —
// which is async in the store (the rename awaits the bridge) — so the
// assertions after it see the settled state.
const deliver = async (task: FakeTask) => {
  const model = onDeviceModel(task.id as "gemma-4-e2b" | "gemma-4-e4b");
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
  mockStartShouldThrow = null;
  mockResumeShouldReject = null;
  mockResumeDeferred = null;
  mockPauseShouldReject = null;
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
  observeModelPresence = fresh.observeModelPresence;
  startModelDownload = fresh.startModelDownload;
  pauseModelDownload = fresh.pauseModelDownload;
  resumeModelDownload = fresh.resumeModelDownload;
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
    await deliver(mockLastTask!);

    expect(mockFiles.get(model.fileName)?.exists).toBe(true);
    expect(modelPresence("gemma-4-e2b").status).toBe("present");
    expect(modelDownloadState("gemma-4-e2b")).toEqual({
      phase: "idle",
      fraction: 1,
    });
  });

  it("signals the OS the job is over once the file lands", async () => {
    startModelDownload("gemma-4-e2b");
    await deliver(mockLastTask!);

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
    await deliver(mockLastTask!);

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

  it("releases the one-download guard when start() throws after the task exists", () => {
    // A bridge method missing on a stale dev client throws from
    // task.start() AFTER the task was booked into activeTasks: without a
    // retirement in the catch, every later start would no-op at the guard
    // with no done/error event ever coming to clear it — Download dead
    // until an app restart.
    mockStartShouldThrow = new Error("download is not a function");

    expect(() => startModelDownload("gemma-4-e2b")).not.toThrow();
    expect(modelDownloadState("gemma-4-e2b").phase).toBe("failed");

    // The poisoned entry is gone: a retry creates and starts a fresh task.
    startModelDownload("gemma-4-e2b");
    expect(mockLastTask?.started).toBe(true);
  });

  it("keeps a settled model instead of re-downloading it", async () => {
    startModelDownload("gemma-4-e2b");
    await deliver(mockLastTask!);
    const settled = mockLastTask;

    // A start landing on a present model — a stale render's Download button,
    // a programmatic caller — keeps the verified weights: the gigabytes on
    // disk are the point of the download.
    startModelDownload("gemma-4-e2b");

    expect(mockLastTask).toBe(settled);
    expect(modelDownloadState("gemma-4-e2b")).toEqual({
      phase: "idle",
      fraction: 1,
    });
  });

  it("starts fresh once the previous download settled and the model was removed", async () => {
    startModelDownload("gemma-4-e2b");
    await deliver(mockLastTask!);
    const settled = mockLastTask;
    // The fake's directory delete does not cascade into its file map, so the
    // file entry goes by hand — the point is that the model is gone.
    mockFiles.delete(onDeviceModel("gemma-4-e2b").fileName);
    deleteModel("gemma-4-e2b");

    // The settle released the one-download guard: with the model gone, a
    // new start creates and starts its own task.
    startModelDownload("gemma-4-e2b");
    expect(mockLastTask).not.toBe(settled);
    expect(mockLastTask?.started).toBe(true);
  });

  it("reports a failed transfer as failed and sheds the dead partial", () => {
    const model = onDeviceModel("gemma-4-e2b");
    startModelDownload("gemma-4-e2b");
    stage(`${model.fileName}.part`, 7);

    mockLastTask?.handlers.error?.({ error: "network", errorCode: 0 });

    // The partial file GOES with the failure: nothing resumes a FAILED
    // task (the OS session dropped it; resume continues only a PAUSED one)
    // and the recovery — retry — starts from zero, so the bytes would be
    // storage no UI path reclaims: Delete is offered only for a PRESENT
    // model, and this row offers nothing but Download.
    expect(mockFiles.get(`${model.fileName}.part`)?.deleted).toBe(true);
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

describe("pauseModelDownload and resumeModelDownload", () => {
  it("pauses a downloading task at its current fraction", () => {
    const model = onDeviceModel("gemma-4-e2b");
    startModelDownload("gemma-4-e2b");
    mockLastTask?.handlers.progress?.({
      bytesDownloaded: Math.floor(model.sizeBytes / 3),
    });

    pauseModelDownload("gemma-4-e2b");

    expect(mockLastTask?.paused).toBe(true);
    expect(modelDownloadState("gemma-4-e2b")).toEqual({
      phase: "paused",
      fraction: 1 / 3,
    });
  });

  it("ignores progress events that raced the pause", () => {
    const model = onDeviceModel("gemma-4-e2b");
    startModelDownload("gemma-4-e2b");
    mockLastTask?.handlers.progress?.({
      bytesDownloaded: Math.floor(model.sizeBytes / 3),
    });
    pauseModelDownload("gemma-4-e2b");

    // In flight when the pause landed — the bridge delivers in order, but
    // the pause call itself is async: the row must not flip straight back.
    mockLastTask?.handlers.progress?.({
      bytesDownloaded: Math.floor(model.sizeBytes / 2),
    });

    expect(modelDownloadState("gemma-4-e2b").phase).toBe("paused");
    expect(modelDownloadState("gemma-4-e2b").fraction).toBeCloseTo(1 / 3);
  });

  it("is a no-op unless the download is running — a double-press", () => {
    pauseModelDownload("gemma-4-e2b");
    expect(modelDownloadState("gemma-4-e2b").phase).toBe("idle");

    startModelDownload("gemma-4-e2b");
    pauseModelDownload("gemma-4-e2b");
    pauseModelDownload("gemma-4-e2b");
    expect(modelDownloadState("gemma-4-e2b").phase).toBe("paused");
  });

  it("resumes a paused task, continuing at its fraction", () => {
    const model = onDeviceModel("gemma-4-e2b");
    startModelDownload("gemma-4-e2b");
    mockLastTask?.handlers.progress?.({
      bytesDownloaded: Math.floor(model.sizeBytes / 3),
    });
    pauseModelDownload("gemma-4-e2b");

    resumeModelDownload("gemma-4-e2b");

    expect(mockLastTask?.resumed).toBe(true);
    expect(modelDownloadState("gemma-4-e2b")).toEqual({
      phase: "downloading",
      fraction: 1 / 3,
    });
  });

  it("is a no-op unless the download is paused — a double-press", () => {
    startModelDownload("gemma-4-e2b");

    resumeModelDownload("gemma-4-e2b");

    expect(modelDownloadState("gemma-4-e2b").phase).toBe("downloading");
    expect(mockLastTask?.resumed).toBe(false);
  });

  it("lands in failed when the transfer refuses to resume", async () => {
    startModelDownload("gemma-4-e2b");
    pauseModelDownload("gemma-4-e2b");
    mockResumeShouldReject = new Error("session gone");

    resumeModelDownload("gemma-4-e2b");
    await Promise.resolve(); // let the rejection land

    expect(modelDownloadState("gemma-4-e2b").phase).toBe("failed");
    // The refused task is retired: a fresh start runs instead of resuming
    // the dead one forever.
    startModelDownload("gemma-4-e2b");
    expect(mockLastTask?.started).toBe(true);
  });

  it("still settles a download that finished as the pause landed", async () => {
    const model = onDeviceModel("gemma-4-e2b");
    startModelDownload("gemma-4-e2b");
    pauseModelDownload("gemma-4-e2b");

    // The pause raced the transfer's own completion: the done event is the
    // truth, and the row must land on present — not sit "paused" beside a
    // finished file.
    stage(`${model.fileName}.part`, model.sizeBytes);
    await mockLastTask?.handlers.done?.();

    expect(modelPresence("gemma-4-e2b").status).toBe("present");
    expect(modelDownloadState("gemma-4-e2b")).toEqual({
      phase: "idle",
      fraction: 1,
    });
    // The settle also cleared the pause's marker: the transfer finished,
    // so a later relaunch must not reattach it as at-rest.
    expect(mockFiles.get(userPausedMarkerName("gemma-4-e2b"))?.exists).toBe(
      false,
    );
  });

  it("un-pauses the row when the pause fails to take, so progress flows again", async () => {
    const model = onDeviceModel("gemma-4-e2b");
    startModelDownload("gemma-4-e2b");
    mockLastTask?.handlers.progress?.({
      bytesDownloaded: Math.floor(model.sizeBytes / 3),
    });

    // The library marks the task PAUSED before the native call and never
    // rolls back: a rejected pause with the transfer still running would
    // otherwise freeze the row at "Paused" — reportProgress ignores
    // progress while paused — for the rest of the transfer.
    mockPauseShouldReject = new Error("pause refused");
    pauseModelDownload("gemma-4-e2b");
    await Promise.resolve(); // let the rejection land

    expect(modelDownloadState("gemma-4-e2b").phase).toBe("downloading");

    // And the ticks flow again.
    mockLastTask?.handlers.progress?.({
      bytesDownloaded: Math.floor(model.sizeBytes / 2),
    });
    expect(modelDownloadState("gemma-4-e2b").phase).toBe("downloading");
    expect(modelDownloadState("gemma-4-e2b").fraction).toBeCloseTo(0.5);
  });

  it("does not publish failed over a settle that landed while the resume was in flight", async () => {
    const model = onDeviceModel("gemma-4-e2b");
    startModelDownload("gemma-4-e2b");
    pauseModelDownload("gemma-4-e2b");

    // The user taps Resume; the transfer was already finishing. The done
    // event settles the model (moves the file, publishes idle), and only
    // THEN the resume rejects — the task is over. The rejection must not
    // flip the row to "failed" for a model that is present on disk.
    mockResumeDeferred = {};
    const lateRejection = mockResumeDeferred;
    resumeModelDownload("gemma-4-e2b");
    stage(`${model.fileName}.part`, model.sizeBytes);
    await mockLastTask?.handlers.done?.();
    expect(modelPresence("gemma-4-e2b").status).toBe("present");
    expect(modelDownloadState("gemma-4-e2b")).toEqual({
      phase: "idle",
      fraction: 1,
    });

    lateRejection.reject?.(new Error("task already completed"));
    await Promise.resolve(); // let the rejection land

    expect(modelDownloadState("gemma-4-e2b").phase).toBe("idle");
  });
});

describe("observeModelPresence", () => {
  it("reports the current presence on subscribe and after a settle", async () => {
    const seen: string[] = [];
    observeModelPresence("gemma-4-e2b", (presence) =>
      seen.push(presence.status),
    );

    // The immediate current-state delivery: nothing is on disk yet.
    expect(seen).toEqual(["absent"]);

    startModelDownload("gemma-4-e2b");
    await deliver(mockLastTask!);

    // The settle's rename is the change that ends in present — and the
    // listener saw it without anyone re-reading by hand.
    expect(seen).toEqual(["absent", "present"]);
  });

  it("notifies after a delete, and lets the subscriber go", () => {
    const model = onDeviceModel("gemma-4-e2b");
    mockDirectories.add(model.id);
    stage(model.fileName, model.sizeBytes);
    const seen: string[] = [];
    const unsubscribe = observeModelPresence("gemma-4-e2b", (presence) =>
      seen.push(presence.status),
    );

    // The fake's file map is separate from its directory set, so the file
    // entry goes by hand — a real Directory.delete removes everything under
    // it, and the delete's re-read lands on absent.
    mockFiles.delete(model.fileName);
    deleteModel("gemma-4-e2b");
    expect(seen).toEqual(["present", "absent"]);

    unsubscribe();
    stage(model.fileName, model.sizeBytes);
    mockFiles.delete(model.fileName);
    deleteModel("gemma-4-e2b");

    // Unsubscribed: the second delete's re-read never arrives.
    expect(seen).toEqual(["present", "absent"]);
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
    // The settled task was stopped — AFTER the rename: Android's DownloadManager
    // record and persisted config survive a completion the dead process
    // never broadcast-received, and without the stop every later launch
    // would re-report the DONE task and re-run a settlement that finds no
    // `.part` and publishes "failed" over this idle.
    expect(mockExistingTasks[0]?.stopped).toBe(true);
    // And the session-wide handshake ran: a background relaunch woken to
    // deliver the completion is released the moment the JS work finishes,
    // not held to the OS's own timeout.
    expect(mockCompleteHandler).toHaveBeenCalledWith("gemma-4-e2b");
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

  it("keeps a task the user paused AT REST across a relaunch", async () => {
    const model = onDeviceModel("gemma-4-e2b");
    mockDirectories.add("whole_models");
    stage(`${model.fileName}.part`, Math.floor(model.sizeBytes / 4));
    // The pause was the user's: the app wrote its marker before dying.
    stage(userPausedMarkerName("gemma-4-e2b"), 0);
    mockExistingTasks.push(
      mockMakeTask!("gemma-4-e2b", "PAUSED", Math.floor(model.sizeBytes / 4)),
    );

    await reattachModelDownloads();

    // Auto-resuming here would undo the user's pause the moment they next
    // opened the app. The row offers Resume.
    expect(mockExistingTasks[0]?.resumed).toBe(false);
    expect(modelDownloadState("gemma-4-e2b").phase).toBe("paused");
    expect(modelDownloadState("gemma-4-e2b").fraction).toBeCloseTo(0.25);

    // And resuming later continues the SAME task, from the bytes it
    // reports, clearing the marker so a later relaunch does not park the
    // download again.
    resumeModelDownload("gemma-4-e2b");
    expect(mockExistingTasks[0]?.resumed).toBe(true);
    expect(modelDownloadState("gemma-4-e2b").phase).toBe("downloading");
    expect(mockFiles.get(userPausedMarkerName("gemma-4-e2b"))?.exists).toBe(
      false,
    );
  });

  it("resumes a transfer the system killed mid-flight, not one the user paused", async () => {
    const model = onDeviceModel("gemma-4-e2b");
    mockDirectories.add("whole_models");
    stage(`${model.fileName}.part`, Math.floor(model.sizeBytes / 4));
    // NO user-pause marker: the library parked a force-stopped transfer as
    // PAUSED (Android's restoreRecoverableDownloads) precisely so
    // resumeTask can continue it.
    mockExistingTasks.push(
      mockMakeTask!("gemma-4-e2b", "PAUSED", Math.floor(model.sizeBytes / 4)),
    );

    await reattachModelDownloads();

    // The download the user started is supposed to survive the process
    // dying — parking it here would stall a multi-GB transfer until the
    // user happened to open Settings.
    expect(mockExistingTasks[0]?.resumed).toBe(true);
    expect(modelDownloadState("gemma-4-e2b").phase).toBe("downloading");
    expect(modelDownloadState("gemma-4-e2b").fraction).toBeCloseTo(0.25);
  });

  it("does not publish failed over a settle that landed while an adopted resume was in flight", async () => {
    const model = onDeviceModel("gemma-4-e2b");
    mockDirectories.add("whole_models");
    stage(`${model.fileName}.part`, Math.floor(model.sizeBytes / 4));
    // No marker: the reattach auto-resumes this task — and the resume stays
    // pending until the test says otherwise.
    const task = mockMakeTask!(
      "gemma-4-e2b",
      "PAUSED",
      Math.floor(model.sizeBytes / 4),
    );
    mockExistingTasks.push(task);
    mockResumeDeferred = {};
    const lateRejection = mockResumeDeferred;

    await reattachModelDownloads();

    // The transfer finished under the in-flight resume: the done handler
    // settles the model, and only THEN the resume rejects — the adopted
    // task's catch must carry the same liveness guard
    // `resumeModelDownload`'s does, or it publishes "failed" over the
    // settle (and re-fires the session handshake for a dead task).
    stage(`${model.fileName}.part`, model.sizeBytes);
    await task.handlers.done?.();
    expect(modelPresence("gemma-4-e2b").status).toBe("present");
    expect(modelDownloadState("gemma-4-e2b")).toEqual({
      phase: "idle",
      fraction: 1,
    });

    lateRejection.reject?.(new Error("task already completed"));
    await Promise.resolve(); // let the rejection land

    expect(modelDownloadState("gemma-4-e2b").phase).toBe("idle");
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

  it("keeps the model a DONE reattach settled when a queued start re-enters", async () => {
    // The DONE variant of the launch-time hole: the reattach settles a
    // transfer that finished while the app was dead — moving the file
    // into place, publishing idle — and only then does the Download tap
    // that queued behind it re-enter. The re-entry must recognize the
    // settle instead of deleting the freshly installed weights and
    // re-downloading every byte.
    const model = onDeviceModel("gemma-4-e2b");
    mockDirectories.add("whole_models");
    stage(`${model.fileName}.part`, model.sizeBytes);
    mockExistingTasks.push(
      mockMakeTask!("gemma-4-e2b", "DONE", model.sizeBytes),
    );

    const reattaching = reattachModelDownloads();
    startModelDownload("gemma-4-e2b"); // queues behind the reattach
    expect(mockLastTask).toBeNull();

    await reattaching;

    // The settle stands: no second task was created and the file is
    // present — not "Downloading… 0%" over a deleted model.
    expect(mockLastTask).toBeNull();
    expect(modelPresence("gemma-4-e2b").status).toBe("present");
    expect(modelDownloadState("gemma-4-e2b")).toEqual({
      phase: "idle",
      fraction: 1,
    });
  });

  it("defers a delete that lands mid-reattach instead of racing it", async () => {
    // The delete variant of the launch-time hole: without the gate, the
    // delete would run before the adoption lands, find no task to stop,
    // remove the directory — and the adoption would then re-book the task,
    // re-publish "downloading" over the delete, and leave a transfer the
    // user just removed running (its eventual settle re-installing the
    // model).
    const model = onDeviceModel("gemma-4-e2b");
    mockDirectories.add("whole_models");
    mockDirectories.add(model.id);
    stage(model.fileName, model.sizeBytes);
    mockExistingTasks.push(mockMakeTask!("gemma-4-e2b", "DOWNLOADING", 0));

    const reattaching = reattachModelDownloads();
    deleteModel("gemma-4-e2b");
    // Still mid-reattach: nothing has been removed yet — the delete waits
    // behind the adoption it must see.
    expect(mockDirectories.has(model.id)).toBe(true);

    await reattaching;

    // The re-entered delete found the adopted task: stopped, retired, the
    // directory gone, and the row idle — not "downloading" over a model the
    // user removed.
    expect(mockExistingTasks[0]?.stopped).toBe(true);
    expect(mockDirectories.has(model.id)).toBe(false);
    expect(modelDownloadState("gemma-4-e2b")).toEqual({
      phase: "idle",
      fraction: 0,
    });
  });

  it("joins an in-flight reattach instead of racing it with a second run", async () => {
    // A remount behind the error boundary can call reattachModelDownloads
    // while the first run's bridge query is still in flight: the second
    // call must JOIN it, not start a parallel adoption — two runs would
    // double-settle a DONE task (the second finds the `.part` already
    // moved and publishes "failed" over the first's idle).
    const model = onDeviceModel("gemma-4-e2b");
    mockDirectories.add("whole_models");
    stage(`${model.fileName}.part`, model.sizeBytes);
    mockExistingTasks.push(
      mockMakeTask!("gemma-4-e2b", "DONE", model.sizeBytes),
    );

    const first = reattachModelDownloads();
    const second = reattachModelDownloads();
    await Promise.all([first, second]);

    expect(modelPresence("gemma-4-e2b").status).toBe("present");
    expect(modelDownloadState("gemma-4-e2b")).toEqual({
      phase: "idle",
      fraction: 1,
    });
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

  it("prunes the models root once the last model directory is gone", () => {
    const model = onDeviceModel("gemma-4-e2b");
    mockDirectories.add("whole_models");
    mockDirectories.add(model.id);
    stage(model.fileName, model.sizeBytes);

    deleteModel("gemma-4-e2b");

    expect(mockDirectories.has(model.id)).toBe(false);
    // The emptied root went with it: `reattachModelDownloads` gates its
    // native query on the root's existence, and a root that outlived every
    // model would make that query a cost of every launch for the rest of
    // the install's life.
    expect(mockDirectories.has("whole_models")).toBe(false);
  });

  it("keeps the models root while another model's directory remains", () => {
    const model = onDeviceModel("gemma-4-e2b");
    mockDirectories.add("whole_models");
    mockDirectories.add(model.id);
    mockDirectories.add(onDeviceModel("gemma-4-e4b").id);

    deleteModel("gemma-4-e2b");

    expect(mockDirectories.has(model.id)).toBe(false);
    expect(mockDirectories.has("whole_models")).toBe(true);
  });
});
