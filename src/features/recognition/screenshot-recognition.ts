// Public entry point for account-screenshot recognition. This is what the
// account screens call:
//
//   recognizeAccountFromScreenshot(uri, width, height)
//     → recognizeTextOnDevice(uri)          native OCR (Vision / ML Kit)
//     → normalizeOcrResult(...)             0..1 boxes
//     → recognizeAccountsWithModel(...)     engine structure + model annotation
//     → ModelRecognitionResult              accounts, or a reason there are none
//
// The OCR pass and the rule engine always run on this device. The annotation
// turn runs wherever the user pointed it: the downloaded local model (nothing
// leaves the phone) or their own remote endpoint (the screenshot's TEXT
// travels to a service they chose and configured — never the image itself).
//
// Thrown before any of that when the chosen engine is not ready — the model is
// not downloaded, or the endpoint is not configured — so the caller can offer
// the fix (download it, configure it) instead of a spinner that ends in an
// error the user can act on.
import { ImageManipulator } from "expo-image-manipulator";

import {
  isOcrSupported,
  normalizeOcrResult,
  recognizeTextOnDevice,
} from "@/features/recognition/ocr-engine";
import { loadRecognitionEngine } from "@/features/recognition/engine-store";
import { modelPresence } from "@/features/on-device-model/model-download";
import {
  prewarmOnDeviceContext,
  releaseOnDeviceContext,
} from "@/features/on-device-model/model-context";
import {
  type ModelRecognitionResult,
  recognizeAccountsWithModel,
} from "@/features/recognition/model-recognition";
import { createRemoteRunModel } from "@/features/recognition/remote-runner";
import { runOnDeviceModel } from "@/features/recognition/on-device-runner";

export type { RecognizedAccount } from "@whole/ocr";

// Thrown when the device can't run on-device OCR (e.g. very old devices or
// certain Android builds). Callers surface this as "unsupported hardware" and
// fall back to manual entry instead of showing the confusing engine error the
// native call would throw.
//
// Still a throw rather than another result status: it is a property of the
// DEVICE, not of this recognition, and nothing the user can act on.
export class RecognitionUnsupportedError extends Error {
  constructor() {
    super("On-device OCR is not supported on this device");
    this.name = "RecognitionUnsupportedError";
  }
}

// Thrown when the chosen recognition engine has no model to run — the local
// weights are not downloaded, or the remote endpoint is not configured.
// Callers surface this as "set the engine up first" with a path to Settings,
// which is a different screen from "recognition failed".
export class EngineNotReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EngineNotReadyError";
  }
}

/**
 * Resolves the `RunModel` the recognition should use.
 *
 * `null` means the CHOSEN engine is not ready — not that nothing exists. The
 * caller turns that into `EngineNotReadyError` at the public boundary, keeping
 * one typed error for "fix your setup" however the setup is incomplete.
 */
async function resolveRunModel() {
  const engine = await loadRecognitionEngine("on-device");
  if (engine === "on-device") {
    return modelPresence().status === "present" ? runOnDeviceModel : null;
  }
  return createRemoteRunModel();
}

// Recognizes account information from a screenshot. `imageWidth`/`imageHeight`
// are the dimensions of the image the OCR engine was fed; the caller gets them
// from the image picker (which already decoded the image), so no re-decode is
// needed here just to read dimensions. Omitting them falls back to a header-only
// dimension read. The OCR boxes and the dimensions share a coordinate space when
// the image has no EXIF rotation — which holds for screenshots, the intended
// input. iOS camera photos with non-up EXIF can mismatch (the Vision OCR path
// denormalizes boxes against the raw bitmap dimensions); use screenshots for
// reliable recognition.
export async function recognizeAccountFromScreenshot(
  imageUri: string,
  imageWidth?: number,
  imageHeight?: number,
): Promise<ModelRecognitionResult> {
  // Capability gate: this device can't run on-device OCR. Folding it into the
  // public entry point means any caller inherits the fallback, not just the
  // uploader.
  if (!isOcrSupported()) {
    throw new RecognitionUnsupportedError();
  }
  // Engine gate, BEFORE the OCR pass: recognizing text the engine will never
  // get to annotate spends the user's longest wait on a dead end. The uploader
  // shows the reason and the way to Settings instead.
  const runModel = await resolveRunModel();
  if (runModel === null) {
    throw new EngineNotReadyError(
      "The recognition engine is not ready. Open Settings to download the model or configure a service.",
    );
  }
  // The on-device context depends on nothing in this function, and loading it is
  // seconds of CPU (longer on a phone with no Metal). Started here, it warms
  // while the OCR pass runs instead of after it — on a cold start that is the
  // single largest slice of the user's visible "recognizing" wait.
  //
  // Only when the local engine is the one running: a remote turn has nothing
  // to warm, and a prewarmed local context beside a remote recognition would
  // park gigabytes nobody asked for.
  if (runModel === runOnDeviceModel) {
    prewarmOnDeviceContext();
  }
  // The OCR pass is the slow step; the dimension read (native `renderAsync` on
  // the same uri when the caller didn't already know the size) is cheap and
  // overlaps with it, shaving user-visible "recognizing" latency.
  let native;
  let dims;
  try {
    const [ocr, size] = await Promise.all([
      recognizeTextOnDevice(imageUri),
      imageWidth !== undefined && imageHeight !== undefined
        ? Promise.resolve({ width: imageWidth, height: imageHeight })
        : ImageManipulator.manipulate(imageUri).renderAsync(),
    ]);
    native = ocr;
    dims = size;
  } catch (error) {
    // The prewarm above is still holding (or still loading) the weights for a
    // recognition that is not going to happen. Nothing downstream will free
    // them, so the user would fill the form in by hand beside three gigabytes
    // waiting out the idle timer — on a device that just failed OCR.
    void releaseOnDeviceContext().catch(() => {});
    throw error;
  }
  const blocks = normalizeOcrResult(native, dims.width, dims.height);
  return recognizeAccountsWithModel(blocks, runModel);
}
