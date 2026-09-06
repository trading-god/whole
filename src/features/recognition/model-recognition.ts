import {
  type OcrTextBlock,
  type RecognizedAccount,
  type ResolvedRecognition,
  type RunModel,
  parseOcrBlocks,
  recognizeWithModel,
} from "@whole/ocr";

import { releaseOnDeviceContext } from "@/features/on-device-model/model-context";
import { OnDeviceModelError } from "@/features/on-device-model/model-error";
import { RemoteModelError } from "@/features/recognition/remote-model-error";
import { runOnDeviceModel } from "@/features/recognition/on-device-runner";

// The app-facing entry point: a screenshot's OCR blocks in, recognized accounts
// out — or a reason why not.
//
// Recognition runs as a hybrid: the engine reads the structure on this device
// and the annotation turn adds what rules cannot know — from the downloaded
// local model, or from the user's own remote endpoint. What CAN go wrong is
// the device, the endpoint, or the model — and the causes below are kept
// apart because each asks something different of the user;
// `recognition-issue.ts` is where that argument is written down.

/** Why a recognition could not happen, in terms a screen can act on. */
export type RecognitionFailureCause =
  /**
   * The local model could not run on this device: the weights are missing,
   * the context would not load, or a completion could not finish. The advice
   * is one message because the user's move is the same for all three —
   * re-download, or free up memory.
   */
  | "load-failed"
  /**
   * The remote endpoint failed: unreachable, unauthorized (401/403 — check
   * the API key), not found (404 — check the base URL), rate-limited (429),
   * or it answered nothing usable. Kept apart from `load-failed` because the
   * advice is the opposite of "restart the app": it names the setting to fix.
   */
  | "remote-failed"
  /** The model never produced an answer holding the annotation contract. */
  | "invalid-output"
  | "unknown";

/**
 * A failed recognition still carries `accounts` — what the ENGINE read before
 * the model was asked anything.
 *
 * The annotation turn only ever ADDS to a deterministic read (a kind the
 * keywords missed, an institution, a home currency), so a model that will not
 * load or cannot hold the contract costs those and nothing else. Throwing the
 * engine's names, balances and last fours away with it would leave the user
 * retyping a screen the app read correctly — and the whole premise of the
 * hybrid is that the engine, not the model, owns the structure.
 *
 * The technical reason is deliberately not here: the screens show localized
 * copy chosen by `recognition-issue.ts`, so carrying it out would carry it
 * nowhere.
 */
export type ModelRecognitionResult =
  | { status: "recognized"; recognition: ResolvedRecognition }
  | {
      status: "failed";
      cause: RecognitionFailureCause;
      accounts: RecognizedAccount[];
    };

// The engine's own read, re-run on the failure path only. It repeats the pass
// `recognizeWithModel` already made internally, which costs a few milliseconds
// of CPU against three model attempts that just failed — cheap enough not to
// widen the engine's outcome type to carry it out.
function engineOnly(blocks: OcrTextBlock[]): RecognizedAccount[] {
  return parseOcrBlocks(blocks);
}

export async function recognizeAccountsWithModel(
  blocks: OcrTextBlock[],
  runModel: RunModel,
): Promise<ModelRecognitionResult> {
  try {
    // The context stays warm behind its idle timer after the recognition ends
    // (`completeOnDevice` owns the release), so the next screenshot skips the
    // multi-second load. Nothing here needs tearing down on the way out — but
    // only the on-device engine prewarmed one, so only it needs releasing.
    const outcome = await recognizeWithModel(blocks, runModel);

    // `attempts: 0` means the engine grouped nothing, so the model was never
    // asked — and a prewarm from the on-device engine is holding a context
    // nobody now wants. Freed straight away rather than left to the idle
    // timer: the point of prewarming is to be ready for a recognition that is
    // coming, and this one is over. (A remote engine has no context; the
    // release is a no-op.)
    if (outcome.attempts === 0 && runModel === runOnDeviceModel) {
      void releaseOnDeviceContext().catch(() => {});
    }

    return outcome.ok
      ? { status: "recognized", recognition: outcome.recognition }
      : {
          status: "failed",
          cause: "invalid-output",
          accounts: engineOnly(blocks),
        };
  } catch (error) {
    return {
      status: "failed",
      cause:
        error instanceof OnDeviceModelError
          ? "load-failed"
          : error instanceof RemoteModelError
            ? "remote-failed"
            : "unknown",
      accounts: engineOnly(blocks),
    };
  }
}
