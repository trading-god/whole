// Downloads an on-device model's weights into filesDir, on demand.
//
// The weights never ship inside the install: even the small model is a 3.1 GB
// bundle, past Google Play's 150 MB base-APK cap and unreasonable as an iOS
// download for a feature a user may never use. Instead the settings screen
// offers the download; this module performs it and owns everything about the
// files on disk.
//
// The download OUTLIVES the settings screen: status lives in this module (not
// in component state), and the transfer itself runs through
// `@kesha-antonov/react-native-background-downloader` — iOS background
// URLSession / Android foreground-service-backed downloader — so it continues
// while the user is elsewhere in the app AND while the app is backgrounded or
// terminated. `reattachModelDownloads` re-attaches JS handlers to tasks the OS
// kept running across a relaunch, so a download started in a previous process
// still lands on disk and still reports progress when the settings screen (or
// the recognition gate's presence check) looks.
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
import {
  completeHandler,
  createDownloadTask,
  getExistingDownloadTasks,
  type DownloadTask,
} from "@kesha-antonov/react-native-background-downloader";
import { Directory, File, Paths } from "expo-file-system";

import {
  type OnDeviceModelId,
  ON_DEVICE_MODEL_SCHEMA,
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

/** The native path one model's `.part` lands at, as a string the downloader takes. */
function partialPath(id: OnDeviceModelId): string {
  const model = onDeviceModel(id);
  // Derived through the same `modelDirectory` every other path in this module
  // uses, so the layout has one source: a hand-built string beside it is how
  // the native destination and the JS-side rename drift apart.
  return new File(modelDirectory(id), `${model.fileName}.part`).uri;
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

// ── The module-owned download status ──────────────────────────────────────
//
// The snapshot map is the source of truth for "what is the download doing",
// deliberately NOT component state: the settings row unmounts whenever the
// user navigates away (that unmount used to be the cancel — see
// `startModelDownload`), and the row re-mounting must find the transfer still
// running, progress included.

/** What one model's download is doing, as the settings row renders it. */
export type DownloadSnapshot = {
  phase: "idle" | "downloading" | "failed";
  /** 0..1 across the model's `sizeBytes`. */
  fraction: number;
};

const IDLE: DownloadSnapshot = { phase: "idle", fraction: 0 };

const snapshots = new Map<OnDeviceModelId, DownloadSnapshot>();
const listeners = new Map<
  OnDeviceModelId,
  Set<(snapshot: DownloadSnapshot) => void>
>();
// One task per model at a time — the same guard the settings row's
// component-local phase used to provide, now enforced where the transfer
// actually lives.
const activeTasks = new Map<OnDeviceModelId, DownloadTask>();

// The launch-time reattach, while it runs: a start that lands inside this
// window cannot yet see the OS-resident task the reattach is about to adopt,
// so it waits for the run to settle (see `startModelDownload`) instead of
// racing it.
let reattachRun: Promise<void> | null = null;

/** Reads one model's download status without subscribing. */
export function modelDownloadState(id: OnDeviceModelId): DownloadSnapshot {
  return snapshots.get(id) ?? IDLE;
}

/**
 * Subscribes to one model's download status. The listener fires immediately
 * with the current snapshot, then on every change; the returned function
 * unsubscribes (a row unmounting cancels only its SUBSCRIPTION, never the
 * download).
 */
export function observeModelDownload(
  id: OnDeviceModelId,
  listener: (snapshot: DownloadSnapshot) => void,
): () => void {
  const set = listeners.get(id) ?? new Set();
  set.add(listener);
  listeners.set(id, set);
  listener(modelDownloadState(id));
  return () => {
    set.delete(listener);
    if (set.size === 0) {
      listeners.delete(id);
    }
  };
}

function publish(id: OnDeviceModelId, snapshot: DownloadSnapshot): void {
  if (
    snapshots.get(id)?.phase === snapshot.phase &&
    snapshots.get(id)?.fraction === snapshot.fraction
  ) {
    return;
  }
  snapshots.set(id, snapshot);
  for (const listener of listeners.get(id) ?? []) {
    listener(snapshot);
  }
}

function reportProgress(id: OnDeviceModelId, bytesDownloaded: number): void {
  const { sizeBytes } = onDeviceModel(id);
  publish(id, {
    phase: "downloading",
    fraction: Math.min(Math.max(bytesDownloaded, 0), sizeBytes) / sizeBytes,
  });
}

/**
 * Starts (or re-attaches to) the model's download. Never rejects: failures
 * land in the snapshot as `phase: "failed"`, which is all the UI needs — the
 * recovery does not depend on which byte range failed, it retries.
 *
 * One download per model at a time: while one task is active, a second start
 * for the same id is a no-op (the row re-offering "Download" mid-download
 * after a re-mount is a real path, not a theory). The guard is sound across
 * the launch-time reattach: a start that lands before the reattach has
 * resolved waits for it, so it can never delete the `.part` of — or start a
 * second native task beside — a task the OS is still running.
 */
export function startModelDownload(id: OnDeviceModelId): void {
  if (reattachRun) {
    // The reattach is mid-flight: its task list is what makes the
    // `activeTasks.has` guard below truthful. Wait for it to settle —
    // either way it settles — then re-enter through this same entry; the
    // guard itself turns a start for a model the reattach adopted into the
    // no-op it should be.
    const run = reattachRun;
    void run.then(
      () => startModelDownload(id),
      () => startModelDownload(id),
    );
    return;
  }
  if (activeTasks.has(id)) {
    return;
  }
  const model = onDeviceModel(id);
  const dir = modelDirectory(id);
  dir.create({ intermediates: true, idempotent: true });

  // A wrong-sized leftover (a download interrupted at rename time) would
  // make the post-download `move` below throw rather than replace — and a
  // stale `.part` would make the native download land beside it — so both
  // go before the fresh transfer starts.
  const destination = modelFile(id);
  if (destination.exists) {
    destination.delete();
  }
  const stalePartial = new File(dir, `${model.fileName}.part`);
  if (stalePartial.exists) {
    stalePartial.delete();
  }

  publish(id, { phase: "downloading", fraction: 0 });
  try {
    const task = createDownloadTask({
      id,
      url: model.url,
      destination: partialPath(id),
    });
    activeTasks.set(id, task);
    wireTaskHandlers(task);
    task.start();
  } catch {
    // A task that could not even be created (the native module not linked —
    // a stale dev client — or a bridge failure) must land in the same
    // failed phase a transfer error does: the row re-offers Download, and
    // the store never sticks at a "downloading" nothing will settle. The
    // prologue above already cleaned the disk, so a retry starts clean.
    publish(id, { phase: "failed", fraction: 0 });
  }
}

/**
 * Tells the OS the background job is over. On iOS the completion handler is
 * SESSION-wide: invoking it means "every event for this background launch is
 * processed", and iOS may suspend the process the moment it runs — so it is
 * called only when the settling task was the LAST active one. With two models
 * downloading concurrently, the first settlement defers to the second; iOS's
 * own 30-second timeout is the backstop if a deferral never comes.
 */
function signalJobDone(task: DownloadTask): void {
  if (activeTasks.size > 0) {
    return;
  }
  // The library's `completeHandler` can return undefined (an empty jobId is
  // a logged no-op), and a rejection (task already stopped, session
  // invalidated) must not surface as unhandled — the catch discipline every
  // fire-and-forget native call here follows.
  void Promise.resolve(completeHandler(task.id)).catch(() => {});
}

/**
 * Wires the task's native callbacks to the store. Shared by
 * `startModelDownload` and `reattachModelDownloads` — a task the OS kept
 * running across a relaunch needs the same bookkeeping a fresh one gets.
 */
function wireTaskHandlers(task: DownloadTask): void {
  const id = task.id as OnDeviceModelId;
  // A handler for a task that is no longer the model's active one (deleted,
  // superseded) must not publish: the events it reacts to are the tail of a
  // transfer the user already ended.
  const isLive = () => activeTasks.get(id) === task;

  task
    .progress(({ bytesDownloaded }) => {
      if (isLive()) {
        reportProgress(id, bytesDownloaded);
      }
    })
    .done(async () => {
      // The transfer finished; the verification and the rename still run in
      // JS. `completeHandler` tells the OS the job is over only after that
      // JS work completes — before it, iOS keeps the briefly-woken process
      // alive to finish this. The `await`s are load-bearing: `File.move`
      // crosses the bridge, and a `completeHandler` that races ahead of the
      // rename lets iOS reclaim the process mid-move.
      try {
        if (!isLive()) {
          return;
        }
        await settleCompletedDownload(id);
      } finally {
        if (isLive()) {
          activeTasks.delete(id);
        }
        signalJobDone(task);
      }
    })
    .error(() => {
      if (!isLive()) {
        return;
      }
      // The technical reason stays out of the UI — localized copy only
      // (AGENTS.md), and the recovery does not depend on which byte range
      // failed: retry the download. The `.part` is deliberately KEPT: iOS
      // holds resume data inside the background session itself, and Android
      // recovers a force-stopped download's paused state from the on-disk
      // byte count (see Downloader.kt) — deleting the partial file here
      // would throw away exactly the bytes a resume needs.
      activeTasks.delete(id);
      publish(id, { phase: "failed", fraction: 0 });
      signalJobDone(task);
    });
}

/**
 * Re-attaches to downloads the OS kept running while the app was backgrounded
 * or terminated. Call once at app start: a task found here resumes reporting
 * progress into the store, so a settings row mounted later renders "still
 * downloading" instead of re-offering a download that would race the live
 * one. Tasks for ids the catalog no longer knows are stopped; a DONE task
 * (finished while the app was dead) is settled on the spot.
 */
export async function reattachModelDownloads(): Promise<void> {
  // Nothing to reattach to until a download has ever run: the OS-side session
  // holds tasks only for transfers this app started. Skipping the query when
  // the models root does not exist keeps every cold launch of every install
  // off the native bridge (iOS spins the background session and sleeps 100 ms
  // inside it; Android queries DownloadManager).
  const root = new Directory(Paths.document, MODEL_DIR_NAME);
  if (!root.exists) {
    return;
  }
  // The run is the gate starts wait behind: it is in place before the first
  // await can resolve, so no start slips past an `activeTasks` the reattach
  // has not populated yet, and it clears once the run settles so later
  // starts run fresh.
  const run = adoptExistingTasks();
  reattachRun = run;
  try {
    await run;
  } finally {
    reattachRun = null;
  }
}

async function adoptExistingTasks(): Promise<void> {
  const tasks = await getExistingDownloadTasks();
  for (const task of tasks) {
    const id = task.id as OnDeviceModelId;
    if (!ON_DEVICE_MODEL_SCHEMA.safeParse(id).success) {
      // A task the catalog no longer knows: an orphaned native transfer for a
      // model this build can never install or clean up, so stop it here.
      void task.stop().catch(() => {});
      continue;
    }
    if (activeTasks.has(id)) {
      continue;
    }
    if (task.state === "DONE") {
      // Completed while the app was dead: no event will ever fire again, so
      // run the settlement here rather than parking a phantom download in
      // `activeTasks` (which would also block a fresh start).
      await settleCompletedDownload(id);
      continue;
    }
    // Where the transfer already is: a live task reports its own byte count,
    // so the first rendered fraction is the truth on disk, not a restart to 0.
    reportProgress(id, task.bytesDownloaded);
    activeTasks.set(id, task);
    wireTaskHandlers(task);
    if (task.state === "PAUSED") {
      // A paused task never reports another event until resumed — adopting it
      // as "downloading" would strand the row at a bar that never moves.
      // Resume it instead; the wired handlers take it from there.
      void task.resume().catch(() => {
        // A resume that failed surfaces as failed: the retry offer is the
        // recovery, same as a transfer error.
        activeTasks.delete(id);
        publish(id, { phase: "failed", fraction: 0 });
        signalJobDone(task);
      });
    }
  }
}

/**
 * Verifies and installs a download whose transfer finished: the size check
 * (a wrong-sized `.part` is deleted so a retry replaces it), the rename into
 * place, and the settle-to-idle publish. Shared by the `done` handler and
 * the DONE-state reattach path — one settlement. Failures land in the
 * snapshot as `phase: "failed"`, which is all the UI needs.
 */
async function settleCompletedDownload(id: OnDeviceModelId): Promise<void> {
  const model = onDeviceModel(id);
  const dir = modelDirectory(id);
  try {
    const partial = new File(dir, `${model.fileName}.part`);
    const actual = partial.size;
    if (actual !== model.sizeBytes) {
      partial.delete();
      throw new Error(
        `Downloaded ${model.name} as ${actual} bytes, expected ${model.sizeBytes}.`,
      );
    }
    await moveIntoPlace(partial, id);
  } catch {
    publish(id, { phase: "failed", fraction: 0 });
  }
}

/**
 * The rename from `.part` to the loadable file, overwriting any leftover at
 * the destination (a wrong-sized file an interrupted settlement stranded
 * there) — `move` does not overwrite by default, and the throw would strand
 * a fully-downloaded file behind it.
 */
async function moveIntoPlace(
  partial: File,
  id: OnDeviceModelId,
): Promise<void> {
  // Same directory, so a rename — atomic, no second copy of the file.
  await partial.move(modelFile(id), { overwrite: true });
  publish(id, { phase: "idle", fraction: 1 });
}

/** Deletes one model's directory. No-op when absent. */
export function deleteModel(id: OnDeviceModelId): void {
  const task = activeTasks.get(id);
  if (task) {
    // Retire the task BEFORE the stop: the still-wired handlers would
    // otherwise re-publish over the idle reset below — iOS delivers the
    // cancel as `downloadFailed` (a spurious "download failed" for a
    // deliberate delete), and a done event already in flight would re-run
    // the settlement and re-create the directory this delete removes.
    activeTasks.delete(id);
    void task.stop().catch(() => {});
    publish(id, { phase: "idle", fraction: 0 });
  }
  const dir = modelDirectory(id);
  if (dir.exists) {
    dir.delete();
  }
}
