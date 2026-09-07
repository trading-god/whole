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

/** The `.part` file a download lands in before the rename into place. */
function partialFile(id: OnDeviceModelId): File {
  const model = onDeviceModel(id);
  // Derived through the same `modelDirectory` every other path in this module
  // uses, so the layout has one source: a hand-built string beside it is how
  // the native destination and the JS-side rename drift apart.
  return new File(modelDirectory(id), `${model.fileName}.part`);
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
  phase: "idle" | "downloading" | "paused" | "failed";
  /** 0..1 across the model's `sizeBytes`. */
  fraction: number;
};

const IDLE: DownloadSnapshot = { phase: "idle", fraction: 0 };

const snapshots = new Map<OnDeviceModelId, DownloadSnapshot>();
const listeners = new Map<
  OnDeviceModelId,
  Set<(snapshot: DownloadSnapshot) => void>
>();
const presenceListeners = new Map<
  OnDeviceModelId,
  Set<(presence: ModelPresence) => void>
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

/**
 * Subscribes to one model's presence on disk — the same contract
 * `observeModelDownload` carries for the snapshot: the listener fires
 * immediately with the current presence, then after every change this module
 * makes of the model's file (a settled download's rename, a delete). The
 * settings row rides this instead of re-reading on a download-phase proxy or
 * remembering a manual refresh per call site, so the row is a pure view over
 * the same disk the recognition gate reads.
 */
export function observeModelPresence(
  id: OnDeviceModelId,
  listener: (presence: ModelPresence) => void,
): () => void {
  const set = presenceListeners.get(id) ?? new Set();
  set.add(listener);
  presenceListeners.set(id, set);
  listener(modelPresence(id));
  return () => {
    set.delete(listener);
    if (set.size === 0) {
      presenceListeners.delete(id);
    }
  };
}

/** Tells presence listeners the model's file on disk just changed. */
function publishPresence(id: OnDeviceModelId): void {
  const presence = modelPresence(id);
  for (const listener of presenceListeners.get(id) ?? []) {
    listener(presence);
  }
}

function publish(id: OnDeviceModelId, snapshot: DownloadSnapshot): void {
  const current = snapshots.get(id);
  if (
    current?.phase === snapshot.phase &&
    current?.fraction === snapshot.fraction
  ) {
    return;
  }
  snapshots.set(id, snapshot);
  for (const listener of listeners.get(id) ?? []) {
    listener(snapshot);
  }
}

/** Flips the phase while keeping the fraction the row already renders. */
function publishPhase(
  id: OnDeviceModelId,
  phase: DownloadSnapshot["phase"],
): void {
  publish(id, { phase, fraction: modelDownloadState(id).fraction });
}

/** Bytes → the 0..1 fraction across the model's size, clamped both ways. */
function fractionOf(id: OnDeviceModelId, bytesDownloaded: number): number {
  const { sizeBytes } = onDeviceModel(id);
  return Math.min(Math.max(bytesDownloaded, 0), sizeBytes) / sizeBytes;
}

function reportProgress(id: OnDeviceModelId, bytesDownloaded: number): void {
  // A paused row ignores progress: events already in flight when the pause
  // landed (the bridge delivers in order, but the pause call itself is async)
  // would otherwise flip the row straight back to "downloading".
  if (modelDownloadState(id).phase === "paused") {
    return;
  }
  publish(id, {
    phase: "downloading",
    fraction: fractionOf(id, bytesDownloaded),
  });
}

/**
 * The marker a USER pause leaves in the model's directory: a task found
 * PAUSED after a relaunch is parked at rest only when this marker says the
 * pause was deliberate. Without it, Android's force-stop recovery — the
 * library parks a transfer the system killed as PAUSED so `resumeTask`
 * works (`restoreRecoverableDownloads`, Downloader.kt) — would be
 * indistinguishable from the user's own pause, and a killed-mid-transfer
 * download would silently stall instead of continuing. Named with the
 * model id so no two models' markers can be confused (each lives in its
 * own directory; the id keeps the name unique on its own).
 */
function userPausedMarker(id: OnDeviceModelId): File {
  return new File(modelDirectory(id), `${id}.user-paused`);
}

/** Marks the model's download as paused BY THE USER (best-effort). */
function markUserPaused(id: OnDeviceModelId): void {
  try {
    const marker = userPausedMarker(id);
    if (!marker.exists) {
      marker.create();
    }
  } catch {
    // The marker only refines the relaunch path; a failed write must not
    // fail the pause itself.
  }
}

/** Clears the user-pause marker (best-effort): resume, restart, settle. */
function clearUserPaused(id: OnDeviceModelId): void {
  try {
    const marker = userPausedMarker(id);
    if (marker.exists) {
      marker.delete();
    }
  } catch {
    // A stale marker parks a reattached task one launch too long; the
    // next transition clears it.
  }
}

/**
 * Pauses the model's in-flight download — the transfer keeps its bytes and
 * its task (`resumeModelDownload` continues from them; a `.part` on disk is
 * never a restart). Only a DOWNLOADING task can pause: anything else is a
 * no-op, which is what a double-press of the button lands as.
 */
export function pauseModelDownload(id: OnDeviceModelId): void {
  if (modelDownloadState(id).phase !== "downloading") {
    return;
  }
  const task = activeTasks.get(id);
  if (!task) {
    return;
  }
  // Publish first: the phase flip is what the row renders NOW, and a pause
  // event arriving after this point is already covered by `reportProgress`
  // ignoring progress while paused.
  publishPhase(id, "paused");
  markUserPaused(id);
  void task.pause().catch(() => {
    // A pause that failed means one of two things. Either the task settled
    // first — its done/error handler publishes the real next state over
    // this one — or the transfer is still running and the pause simply did
    // not take (the library marks the task PAUSED before the native call
    // and never rolls it back). In that second case the phase flip above
    // would swallow every further progress tick (`reportProgress` ignores
    // progress while paused) and freeze the row at "Paused" for the rest
    // of the transfer: un-pause it, so the ticks flow again — and drop
    // the marker, so a later relaunch does not park a transfer that was
    // never really paused.
    if (modelDownloadState(id).phase === "paused") {
      clearUserPaused(id);
      publishPhase(id, "downloading");
    }
  });
}

/**
 * Continues a paused download from where it stopped. Only a PAUSED task can
 * resume; anything else is a no-op (the same double-press guard).
 */
export function resumeModelDownload(id: OnDeviceModelId): void {
  if (modelDownloadState(id).phase !== "paused") {
    return;
  }
  const task = activeTasks.get(id);
  if (!task) {
    return;
  }
  publishPhase(id, "downloading");
  clearUserPaused(id);
  void task.resume().catch(() => {
    // A resume that failed surfaces as failed: the retry offer is the
    // recovery, the same discipline the transfer-error path follows. But
    // only for THIS task: a rejection landing after the task already
    // settled (the done handler ran while the resume was in flight) must
    // not publish "failed" over the settle.
    if (activeTasks.get(id) === task) {
      failTask(id, task);
    }
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
    // The reattach is mid-flight: its task list is what makes the guards
    // below truthful. Wait for it to settle — either way it settles — then
    // re-enter through this same entry; the guards turn a start for a model
    // the reattach adopted (or one whose transfer settled while the app was
    // dead) into the no-op it should be.
    const run = reattachRun;
    const reEnter = () => startModelDownload(id);
    void run.then(reEnter, reEnter);
    return;
  }
  if (activeTasks.has(id)) {
    return;
  }
  // Presence is the truth: a start landing on an already-present model (a
  // download that settled between the row's render and the tap, or any
  // programmatic caller) keeps the verified weights instead of deleting and
  // re-downloading every byte. A wrong-sized leftover reads as partial and
  // is deleted by `modelPresence` itself, so the transfer below starts from
  // a clean destination either way.
  if (modelPresence(id).status === "present") {
    return;
  }
  const model = onDeviceModel(id);
  const dir = modelDirectory(id);
  dir.create({ intermediates: true, idempotent: true });

  // A stale `.part` would make the native download land beside it, so it
  // goes before the fresh transfer starts. The user-pause marker goes too: a
  // fresh start is not a pause.
  const stalePartial = partialFile(id);
  if (stalePartial.exists) {
    stalePartial.delete();
  }
  clearUserPaused(id);

  publish(id, { phase: "downloading", fraction: 0 });
  try {
    const task = createDownloadTask({
      id,
      url: model.url,
      destination: partialFile(id).uri,
    });
    activeTasks.set(id, task);
    wireTaskHandlers(task);
    task.start();
  } catch {
    // A task that could not even be created (the native module not linked —
    // a stale dev client — or a bridge failure), or one whose `start()`
    // threw after the bookkeeping above, must land in the same failed
    // phase a transfer error does — and must RELEASE the one-download
    // guard: a task that threw after `activeTasks.set` would otherwise
    // block every later start with no done/error event ever coming to
    // clear it. The prologue above already cleaned the disk, so a retry
    // starts clean.
    activeTasks.delete(id);
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
 * Retires a task that can no longer make progress and lands the row in the
 * failed phase: the one recovery the settings row offers for every failure
 * is retrying the download. Shared by the transfer-error path and the
 * refused-resume paths, so they cannot drift apart.
 */
function failTask(id: OnDeviceModelId, task: DownloadTask): void {
  activeTasks.delete(id);
  publish(id, { phase: "failed", fraction: 0 });
  signalJobDone(task);
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
        // A retired task's tail (iOS delivers deleteModel's stop as
        // `downloadFailed`) still owes the session-wide handshake — a
        // background wake that delivered it would otherwise idle to the
        // OS's own timeout instead of being released here.
        signalJobDone(task);
        return;
      }
      // The technical reason stays out of the UI — localized copy only
      // (AGENTS.md), and the recovery does not depend on which byte range
      // failed: retry the download. The `.part` is deliberately KEPT: iOS
      // holds resume data inside the background session itself, and Android
      // recovers a force-stopped download's paused state from the on-disk
      // byte count (see Downloader.kt) — deleting the partial file here
      // would throw away exactly the bytes a resume needs.
      failTask(id, task);
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
  // starts run fresh. The gate is also idempotent: a second call while one
  // run is still in flight (a layout remount behind the error boundary)
  // JOINS it rather than starting a parallel adoption — two runs would
  // double-settle a DONE task (the second finds the `.part` already moved
  // and publishes "failed" over the first's idle) and the first's cleanup
  // would clear the gate while the second is still running.
  const run = reattachRun ?? adoptExistingTasks();
  reattachRun = run;
  try {
    await run;
  } finally {
    if (reattachRun === run) {
      reattachRun = null;
    }
  }
}

async function adoptExistingTasks(): Promise<void> {
  const tasks = await getExistingDownloadTasks();
  // DONE tasks settled below, in list order: their session-wide handshake
  // is owed only after the whole pass, when `activeTasks` reflects every
  // live task this run adopted (signalling mid-pass would tell iOS "all
  // events processed" while adoptions are still pending).
  const settledTasks: DownloadTask[] = [];
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
      settledTasks.push(task);
      continue;
    }
    // Where the transfer already is: a live task reports its own byte count,
    // so the first rendered fraction is the truth on disk, not a restart to 0.
    activeTasks.set(id, task);
    wireTaskHandlers(task);
    // A pause THIS app wrote (see `userPausedMarker`): the user asked for
    // at-rest, and a relaunch must not undo it — the row offers Resume,
    // continuing from the bytes on disk.
    const atRest = task.state === "PAUSED" && userPausedMarker(id).exists;
    if (atRest) {
      publish(id, {
        phase: "paused",
        fraction: fractionOf(id, task.bytesDownloaded),
      });
      continue;
    }
    reportProgress(id, task.bytesDownloaded);
    if (task.state === "PAUSED") {
      // No marker: the pause is the library's own recovery, not a choice.
      // Android parks a transfer the system killed mid-flight as PAUSED
      // precisely so `resumeTask` can continue it
      // (`restoreRecoverableDownloads`, Downloader.kt) — on iOS the
      // equivalent task surfaces as still running, and a user pause always
      // leaves the marker. Continuing the download is what "background
      // downloads survive the app" promises; parking it here would stall a
      // multi-GB transfer until the user happened to open Settings.
      void task.resume().catch(() => {
        // A resume that failed surfaces as failed: the retry offer is
        // the recovery, the same discipline the transfer-error path
        // follows.
        failTask(id, task);
      });
    }
  }
  for (const task of settledTasks) {
    signalJobDone(task);
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
  try {
    const partial = partialFile(id);
    const actual = partial.size;
    if (actual !== model.sizeBytes) {
      partial.delete();
      throw new Error(
        `Downloaded ${model.name} as ${actual} bytes, expected ${model.sizeBytes}.`,
      );
    }
    // The rename from `.part` to the loadable file, overwriting any leftover
    // at the destination (a wrong-sized file an interrupted settlement
    // stranded there) — `move` does not overwrite by default, and the throw
    // would strand a fully-downloaded file behind it. Same directory, so a
    // rename: atomic, no second copy of the file.
    await partial.move(modelFile(id), { overwrite: true });
    publish(id, { phase: "idle", fraction: 1 });
    // The disk changed — presence listeners re-read, which is what swaps the
    // settings row's progress bar for its Test/Delete actions.
    publishPresence(id);
  } catch {
    publish(id, { phase: "failed", fraction: 0 });
  } finally {
    // The transfer finished — even one that raced a pause (the wt case:
    // done landing after the user pressed Pause) is no longer paused, and
    // a marker left behind would park the next relaunch's reattach.
    clearUserPaused(id);
  }
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
  // The disk changed — or did not, for an absent model: the re-read keeps
  // subscribed rows current (the row swaps back to its download offer)
  // without any caller remembering a manual refresh.
  publishPresence(id);
}
