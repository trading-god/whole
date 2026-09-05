// Public entry point for account-screenshot recognition. This is what the
// account screens call:
//
//   recognizeAccountFromScreenshot(uri, width, height)
//     → recognizeTextOnDevice(uri)          native OCR (Vision / ML Kit)
//     → normalizeOcrResult(...)             0..1 boxes
//     → recognizeAccountsWithModel(...)     engine structure + model annotation
//     → ModelRecognitionResult              accounts, or a reason there are none
//
// Every step runs on this device — the OCR pass, the rules engine, and the
// bundled model that annotates what rules cannot know. Nothing leaves the
// phone: no endpoint, no consent, no network call at all.
//
// The return type is a RESULT, not a list, so the caller can tell the ways this
// can end apart — see `recognition-issue.ts` for why that distinction earns its
// keep.
import { ImageManipulator } from "expo-image-manipulator";

import {
  isOcrSupported,
  normalizeOcrResult,
  recognizeTextOnDevice,
} from "@/features/recognition/ocr-engine";
import {
  prewarmOnDeviceContext,
  releaseOnDeviceContext,
} from "@/features/on-device-model/model-context";
import {
  type ModelRecognitionResult,
  recognizeAccountsWithModel,
} from "@/features/recognition/model-recognition";

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
  // The model context depends on nothing in this function, and loading it is
  // seconds of CPU (longer on a phone with no Metal). Started here, it warms
  // while the OCR pass runs instead of after it — on a cold start that is the
  // single largest slice of the user's visible "recognizing" wait. Past the
  // capability gate, because a device that cannot OCR will never ask for it.
  //
  // It is started before the screen is known to hold any account, which is the
  // price of the overlap: only the blocks can say, and they do not exist yet.
  // Every way it turns out wasted is bounded: a screen the engine groups
  // nothing on releases the context immediately
  // (`recognizeAccountsWithModel`), an OCR pass that throws releases it below,
  // and a load that fails is swallowed, so the "no accounts on this
  // screenshot" verdict still reaches the user instead of a memory warning
  // about a model that was never needed.
  prewarmOnDeviceContext();
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
  return recognizeAccountsWithModel(blocks);
}
