// Public entry point for account-screenshot recognition. This is what the
// account screens call:
//
//   recognizeAccountFromScreenshot(uri, width, height, options)
//     → recognizeTextOnDevice(uri)          native OCR (Vision / ML Kit)
//     → normalizeOcrResult(...)             0..1 boxes
//     → recognizeAccountsWithModel(...)     grid → prompt → model → resolve
//     → ModelRecognitionResult              accounts, or a reason there are none
//
// The OCR pass is still entirely on-device. What leaves the device — and only
// once the user has agreed to a specific host — is the recognized TEXT, never
// the screenshot itself. `model-recognition` is where that gate lives.
//
// The return type is a RESULT, not a list, and that is the substantive change
// from the rule-engine era: "no endpoint configured", "not consented to this
// host", "your key is wrong" and "no accounts on this screen" are four
// different things, and a screen that cannot tell them apart will show the last
// one when it means one of the first three.
import { ImageManipulator } from "expo-image-manipulator";

import {
  isOcrSupported,
  normalizeOcrResult,
  recognizeTextOnDevice,
} from "@/features/assets/ocr-engine";
import {
  type ModelRecognitionOptions,
  type ModelRecognitionResult,
  recognizeAccountsWithModel,
} from "@/features/assets/model-recognition";

export type { RecognizedAccount } from "@whole/ocr";
export type {
  ModelRecognitionResult,
  RecognitionFailureCause,
} from "@/features/assets/model-recognition";

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
  options: ModelRecognitionOptions = {},
): Promise<ModelRecognitionResult> {
  // Capability gate: this device can't run on-device OCR. Folding it into the
  // public entry point means any caller inherits the fallback, not just the
  // uploader.
  if (!isOcrSupported()) {
    throw new RecognitionUnsupportedError();
  }
  // The OCR pass is the slow step; the dimension read (native `renderAsync` on
  // the same uri when the caller didn't already know the size) is cheap and
  // overlaps with it, shaving user-visible "recognizing" latency.
  const [native, dims] = await Promise.all([
    recognizeTextOnDevice(imageUri),
    imageWidth !== undefined && imageHeight !== undefined
      ? Promise.resolve({ width: imageWidth, height: imageHeight })
      : ImageManipulator.manipulate(imageUri).renderAsync(),
  ]);
  const blocks = normalizeOcrResult(native, dims.width, dims.height);
  return recognizeAccountsWithModel(blocks, options);
}
