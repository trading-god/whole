// The llama.cpp context over the on-device model weights: load, keep warm, free.
//
// The context is expensive to build (seconds, and gigabytes of RAM) but cheap
// to keep warm, and a recognition may take up to three attempts against it. So
// the context is a module-level singleton, created on first use and held
// behind an idle-release timer: it is freed only after the timer has run out
// unused, so consecutive recognitions skip the init cost while a forgotten
// context does not park gigabytes indefinitely. Inference never happens in the
// background, so a released context is always the right answer eventually.
//
// "Eventually" is why there are TWO paths to a release: the idle timer only
// runs while the app is in the foreground, so backgrounding frees the context
// as well.
//
// The singleton is bound to ONE model at a time — the id in
// `contextModelId`. `selectOnDeviceModel` swaps it: a model switch releases
// the old context (the E2B context is useless for running E4B, and holding
// both is exactly the memory crunch the lifecycle exists to avoid) and the
// next completion loads the new weights.
//
// It lives in the on-device-model feature (not recognition) because it is the
// weights' lifecycle, not the recognizer's: the settings screen's Test button
// loads and probes the same context without touching the recognition pipeline,
// and recognition builds its `RunModel` on top of it.
import { ANNOTATION_INFERENCE } from "@whole/ocr";
import { AppState } from "react-native";
import {
  initLlama,
  installJsi,
  type CompletionParams,
  type LlamaContext,
} from "llama.rn";

import {
  OnDeviceModelError,
  errorMessage,
} from "@/features/on-device-model/model-error";
import {
  type OnDeviceModelId,
  onDeviceModel,
} from "@/features/on-device-model/on-device-catalog";
import { resolveOnDeviceModelPath } from "@/features/on-device-model/model-source";

// ── Context singleton ──────────────────────────────────────────────────────

// llama.rn's own `installJsi` guard (`isJsiInstalled`) is only set AFTER its
// await resolves, so two overlapping calls both reach the native `install()`.
// On Android that starts the shard extraction twice, and two threads writing
// the same `.part` produce a full-length shard of interleaved garbage that
// passes every later size check and is never re-extracted. The install is then
// permanently unable to load the model.
//
// The window is real on this path: a prewarm can still be loading when the
// recognition that did not need it releases the context, and the next
// screenshot then starts a second load. One promise, shared, closes it.
let jsiInstall: Promise<void> | null = null;

function ensureJsiInstalled(): Promise<void> {
  jsiInstall ??= installJsi().catch((error: unknown) => {
    // Not cached as a failure: `installJsi` is retryable, and a load that
    // failed here must not make every later load fail with the same error.
    jsiInstall = null;
    throw error;
  });
  return jsiInstall;
}

// Backgrounding frees the context, because the idle timer cannot: iOS suspends
// JS timers shortly after the app goes away, so a user who recognizes a
// screenshot and switches apps inside the minute leaves ~3 GB held with nothing
// running that will ever release it. A suspended app that big is what gets
// jetsammed, and the half-filled account form goes with it.
//
// Registered on the first load rather than at import: there is nothing to free
// until then. Never removed — the singleton it guards is process-lifetime too.
// `releaseOnDeviceContext` is lease-aware, so a completion still in flight is
// not freed out from under itself.
let appStateWatch: { remove: () => void } | null = null;

function watchAppStateForRelease(): void {
  appStateWatch ??= AppState.addEventListener("change", (state) => {
    if (state === "background") {
      // A no-op while a lease is open — freeing a context a completion is
      // running on would pull it out from under llama.cpp. The last lease out
      // covers that case by reading the app state itself (see the lease's
      // `finally`), which is why nothing is latched here.
      void releaseOnDeviceContext().catch(() => {});
    }
  });
}

// Contexts whose release has already failed once. A second failure means the
// handle is not coming back, so it is dropped rather than restored: restoring
// it again hands every later completion a context llama.cpp no longer holds,
// and the idle timer and the background handler each retry the same failing
// release forever — on-device recognition wedged for the life of the process,
// with "free up memory" as the advice. Letting go costs the memory it was
// already holding; holding on costs every recognition.
const releaseFailedOnce = new WeakSet<LlamaContext>();

// llama.cpp refuses a second completion on a context already predicting
// (`RNLlamaJSI.cpp` throws "Context is busy"), and the two callers here can
// genuinely overlap: the settings Test button's probe takes seconds to load,
// and a recognition started behind it parks on the SAME context promise, so
// both resume in the same tick. Queued rather than left to race — the loser
// would surface as `modelLoadFailed`, which is advice fitting neither the
// cause nor the fix.
let completionQueue: Promise<unknown> = Promise.resolve();

let contextPromise: Promise<LlamaContext> | null = null;
// The release in progress, if any: a load starting inside its window awaits it
// rather than building a second multi-gigabyte context beside one still being
// freed.
let releasing: Promise<void> | null = null;

// Which model the singleton context is (being) built over. Read at LOAD
// time, never after: a completion in flight keeps its context whatever this
// says now, and the next load reads whatever this says then. Null until the
// first load or selection — the default model a null state implies is NOT
// written here, so "select the default" on a cold module is a real no-op
// rather than a release of a context that was never loaded.
let contextModelId: OnDeviceModelId | null = null;

function ensureContext(): Promise<LlamaContext> {
  if (contextPromise === null) {
    // Captured HERE, not read inside the body: this load waits for a release
    // that was already in flight when it started, which is the whole point of
    // `releasing`. Reading the variable later would also pick up a release
    // started AFTER this load — and that release waits on this load's promise,
    // so the two would wait on each other and neither would ever settle.
    const priorRelease = releasing;
    watchAppStateForRelease();
    // Same capture discipline: the id this load binds to, read before any
    // await, so a `selectOnDeviceModel` landing mid-load cannot rewrite the
    // goalposts under a load already running. Null (nothing selected yet)
    // means the default — and the load CLAIMS it, so a later select of a
    // different model releases this context rather than assuming none.
    const modelId = contextModelId ?? "gemma-4-e2b";
    contextModelId = modelId;
    const load = (async () => {
      try {
        await ensureJsiInstalled();
        // Swallowed: a release that FAILED is not this load's problem, and
        // rethrowing it here would report a perfectly loadable model as
        // unloadable. The wait is only for the memory to come back.
        await priorRelease?.catch(() => {});
        const modelPath = resolveOnDeviceModelPath(modelId);
        return await initLlama({
          model: modelPath,
          // A downloaded filesDir path on both platforms; the flag is llama.rn's
          // NSBundle asset lookup, which no longer applies — the weights are not
          // bundle resources.
          is_model_asset: false,
          n_ctx: ANNOTATION_INFERENCE.contextWindow,
          // All layers on the accelerator. Metal takes the whole model; on
          // Android (CPU in v1) the engine clamps this to what it can use.
          n_gpu_layers: 99,
        });
      } catch (error) {
        // Path resolution and the native load are the same failure to every
        // caller — the weights cannot be loaded on this device.
        throw error instanceof OnDeviceModelError
          ? error
          : new OnDeviceModelError(
              `the ${onDeviceModel(modelId).name} context would not load: ${errorMessage(error)}`,
            );
      }
    })();
    contextPromise = load;
    // A failed load must not poison the singleton: the next call retries (the
    // user may have freed memory in between). Cleared only while this load is
    // still the current one — a release plus a fresh load can have replaced it
    // while this one was failing, and clearing then would strand a live
    // context with nothing left to release it.
    //
    // A separate handler, not part of the body above, so the rejection the
    // caller awaits is untouched.
    void load.catch(() => {
      if (contextPromise === load) {
        contextPromise = null;
      }
    });
  }
  return contextPromise;
}

/**
 * Loads the context if it is cold, without running anything against it.
 *
 * For a caller that knows a completion is coming and has other work to do
 * first: the load is seconds of CPU that depends on nothing, so starting it
 * beside that work takes it off the user's visible wait. The singleton makes
 * this safe to call any number of times, and `completeOnDevice` awaits the same
 * promise rather than starting a second load.
 *
 * It arms the idle release on its own, because the completion it was warming
 * for may never arrive — the OCR pass beside it can fail, or the user can back
 * out — and a context nothing ever leases would otherwise sit on gigabytes with
 * no timer to free it. Skipped while a lease is open: `withOnDeviceContext`
 * owns the timer for as long as it holds the context.
 *
 * Fire-and-forget: a failure here is reported by the completion that follows,
 * which is the caller that can do something about it. That costs a second full
 * load on the device where a load fails at all, because `ensureContext` clears
 * a failed load rather than caching it — deliberately: pinning the rejection is
 * how one bad load turned into every later recognition failing with it, and
 * paying the wait twice is the cheaper of the two mistakes.
 */
export function prewarmOnDeviceContext(): void {
  void ensureContext().then(
    () => {
      // Nothing holding it, and nothing already freeing it. A release started
      // while this load was still running cancelled the timer synchronously
      // and is now awaiting this very promise — arming here would leave a
      // timer behind for a context that is about to be gone.
      if (leases === 0 && contextPromise !== null && releasing === null) {
        armIdleRelease();
      }
    },
    () => {},
  );
}

/**
 * Frees the on-device context, if there is one and nothing is using it.
 *
 * A NO-OP while a lease is open. Releasing under a running completion would
 * free the context natively out from under it, and there is no caller that
 * wants that: the idle timer only fires with the count at zero, and the
 * recognition path's "the model was never asked, drop the prewarm" call can
 * land while the settings screen's Test is still loading.
 *
 * Safe to call more than once, and safe to call during a load — the release
 * waits for the load to finish and then frees what it produced, and a load
 * that starts inside the release window waits for it (`releasing`) rather than
 * doubling the model's footprint beside a context still being freed.
 */
export async function releaseOnDeviceContext(): Promise<void> {
  if (leases > 0) {
    return;
  }
  cancelIdleRelease();
  const pending = contextPromise;
  if (pending === null) {
    return;
  }
  contextPromise = null;
  const thisRelease = (async () => {
    // A rejection HERE is a failed load, not a failed release: there is no
    // context, nothing leaked, and the slot must stay empty so the next call
    // retries. Restoring a rejected load would pin its error to the singleton
    // and fail every recognition for the life of the process.
    const context = await pending;
    try {
      await context.release();
    } catch (error) {
      // A rejection here is the opposite case: the context is still allocated
      // and `contextPromise` was already cleared, so without this it has no
      // reference left and the next load builds a second one beside it. Put it
      // back, unless a newer load already claimed the slot — and only the
      // FIRST time this context fails to free (see `releaseFailedOnce`).
      if (!releaseFailedOnce.has(context)) {
        releaseFailedOnce.add(context);
        contextPromise ??= pending;
      }
      throw error;
    }
  })();
  releasing = thisRelease;
  try {
    await thisRelease;
  } finally {
    // Only if no LATER release has taken the slot. Clearing unconditionally
    // would drop a newer release's guard while it is still freeing, and the
    // next load would then build a second multi-gigabyte context beside it —
    // the exact thing `releasing` exists to prevent.
    if (releasing === thisRelease) {
      releasing = null;
    }
  }
}

/**
 * Points the context at a different model, releasing whatever is loaded.
 *
 * Called by the settings screen when the user switches models (and by nobody
 * else). A no-op when the id is already current — including when a load of it
 * is still running. When it changes, the current context is released exactly
 * as the idle timer would, and the NEXT completion loads the new weights:
 * releasing here rather than loading keeps the swap O(1) for the caller and
 * means a switched-away model is never sitting warm beside a load of the new
 * one — the memory crunch this lifecycle exists to avoid.
 *
 * Lease-aware like every release: a recognition still running on the old
 * model finishes on it, and the swap takes effect on the next load.
 */
export async function selectOnDeviceModel(id: OnDeviceModelId): Promise<void> {
  // A null `contextModelId` means nothing is loaded or selected yet —
  // selecting anything then just records the choice (the next load reads
  // it), with no context to release.
  if (contextModelId === id || contextModelId === null) {
    contextModelId = id;
    return;
  }
  contextModelId = id;
  await releaseOnDeviceContext().catch(() => {
    // The release's own failure handling (restore-or-drop) already ran; the
    // swap itself is not undone by a context that would not free.
  });
}

// ── Idle release ───────────────────────────────────────────────────────────

/** How long a warm context waits unused before it is freed. */
export const ON_DEVICE_CONTEXT_IDLE_RELEASE_MS = 60_000;

// A plain `setTimeout`, driven in tests by Jest's fake timers. There is no
// injectable scheduler here on purpose: a runner can fake a clock, which is
// what makes this different from `__DEV__` — that one needs an injectable
// constant because nothing can fake a compile-time global.
let idleReleaseTimer: ReturnType<typeof setTimeout> | null = null;

// How many uses currently hold the context. The timer belongs to whoever holds
// it, so only a drop to zero arms one.
let leases = 0;

function cancelIdleRelease(): void {
  if (idleReleaseTimer !== null) {
    clearTimeout(idleReleaseTimer);
    idleReleaseTimer = null;
  }
}

function armIdleRelease(): void {
  cancelIdleRelease();
  idleReleaseTimer = setTimeout(() => {
    // Swallowed: `context.release()` is a native call that can reject, and an
    // unhandled rejection a minute after a recognition is a crash the user
    // cannot connect to anything they did. A context that would not free is
    // also nothing a caller could act on.
    void releaseOnDeviceContext().catch(() => {});
  }, ON_DEVICE_CONTEXT_IDLE_RELEASE_MS);
}

// ── The context lease ──────────────────────────────────────────────────────

/**
 * Runs `run` against the loaded context, re-arming the idle release once it
 * settles — on failure too, the one path that would otherwise leave a loaded
 * context with no timer ever going to free it.
 *
 * Module-private: `completeOnDevice` is the only thing anyone runs against a
 * context, and taking the lease itself is what keeps `LlamaContext` — and the
 * chance of a caller skipping the error mapping below — out of this feature's
 * surface.
 */
async function withOnDeviceContext<T>(
  run: (context: LlamaContext) => Promise<T>,
): Promise<T> {
  // Cancel any armed idle release FIRST: a use starting inside the idle
  // window can outlast it (a grammar-constrained completion runs for many
  // seconds on a CPU-only device), and the timer firing mid-use would
  // interrupt the very completion it was going to hand the context back to.
  cancelIdleRelease();
  leases += 1;
  try {
    const context = await ensureContext();
    return await run(context);
  } finally {
    // The LAST lease out arms the timer. Counting rather than arming
    // unconditionally is what keeps one use from scheduling a release in the
    // middle of another that is still running — a prewarm resolving beside a
    // recognition is exactly that shape.
    //
    // A bare `return` here would discard `run`'s result, so the three cases are
    // an if/else rather than early exits.
    leases -= 1;
    if (leases > 0) {
      // Someone else still holds it.
    } else if (AppState.currentState !== "active") {
      // The app is away and this was the last hold on the context. Free it
      // outright: a timer armed here would not fire before iOS suspends the
      // process, and a suspended app holding the weights is the jetsam this
      // whole lifecycle exists to avoid.
      //
      // READ here, not latched at the background event: a recognition retries
      // up to three times, and a flag the first attempt consumed would leave
      // the later ones rebuilding the context and then arming that dead timer.
      void releaseOnDeviceContext().catch(() => {});
    } else {
      armIdleRelease();
    }
  }
}

/**
 * Loads the context if it is cold, runs one completion against it, and hands
 * the context back to the idle timer.
 *
 * The one thing anyone does with the weights, so it is the one place a native
 * failure is mapped to `OnDeviceModelError` — every completion site (the verify
 * probe, the recognition turn) shares that policy rather than opting into it.
 * A failure here means the model could not finish, not that it misbehaved: the
 * grammar makes a malformed answer unreturnable.
 */
export async function completeOnDevice(params: CompletionParams) {
  return withOnDeviceContext(async (context) => {
    const run = completionQueue.then(async () => {
      try {
        return await context.completion(params);
      } catch (error) {
        throw new OnDeviceModelError(
          `the model could not finish a completion: ${errorMessage(error)}`,
        );
      }
    });
    // Swallowed on the queue so a failed completion does not fail the one
    // behind it; the caller still gets its own rejection through `run`.
    completionQueue = run.catch(() => {});
    return run;
  });
}

/**
 * Loads the bundled model and runs a one-token completion against it.
 *
 * The settings screen's Test button: it catches an unloadable model — an
 * out-of-memory device, a corrupted file — before the user spends a
 * screenshot finding out.
 */
export async function verifyOnDeviceModel(): Promise<void> {
  await completeOnDevice({ prompt: "1", n_predict: 1 });
}
