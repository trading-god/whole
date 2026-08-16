// Public entry point for account-screenshot recognition. This is what the
// account screens call; everything from here down is on-device (no network):
//
//   recognizeAccountFromScreenshot(uri, width, height)
//     → recognizeTextOnDevice(uri)        native OCR (Vision / ML Kit)
//     → normalizeOcrResult(...)           0..1 boxes
//     → parseOcrBlocks(...)               pure TS semantic parser
//     → RecognizedAccount[]               the app's contract
//
// The semantic parser and the NORMALIZED blocks contract live in the pure
// `@whole/ocr` package so the same parser runs in the Node eval harness
// (`packages/ocr-eval`), which replays recorded blocks without touching native
// code.
import { ImageManipulator } from "expo-image-manipulator";

import {
  isOcrSupported,
  normalizeOcrResult,
  recognizeTextOnDevice,
} from "@/features/assets/ocr-engine";
import { parseOcrBlocks } from "@whole/ocr";

export type { RecognizedAccount } from "@whole/ocr";

// Thrown by `recognizeAccountFromScreenshot` when the device can't run on-device
// OCR (e.g. very old devices or certain Android builds). Callers surface this
// as "unsupported hardware" and fall back to manual entry instead of showing
// the confusing engine error the native call would throw.
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
) {
  // Capability gate: this device can't run on-device OCR. Folding it into the
  // public entry point means any caller inherits the fallback, not just the
  // uploader. Throws a typed error so UI layers map it to "unsupported", while
  // keeping the per-device support policy next to the engine it describes.
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
  return parseOcrBlocks(blocks);
}
