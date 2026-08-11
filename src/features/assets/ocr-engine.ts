import { recognizeText, isSupported } from "expo-mlkit-ocr";

import type { OcrBlock, OcrNativeResult, OcrTextBlock } from "./ocr-types";

// The ONLY module that touches the native OCR engine. Everything downstream
// (the semantic parser, the eval harness, the recognition entry point) works
// against `OcrNativeResult` / `OcrTextBlock` (see ocr-types), so swapping the
// engine — to another Expo module or a hand-written Vision/ML-Kit bridge —
// changes nothing but this file.
//
// `expo-mlkit-ocr` runs Google ML Kit Text Recognition v2 on Android and
// either ML Kit or Apple Vision on iOS (chosen by the `iosEngine` config
// plugin; `"auto"` uses Vision for simulator-friendliness). It is fully
// on-device: no network request, nothing leaves the device.

// Runs OCR on a local image URI and returns the flattened text blocks with raw
// pixel-space bounding boxes (x/y = top-left corner, top-left origin). The
// first step after calling this is always `normalizeOcrResult` below, which
// rescales boxes to 0..1 against the exact image that was fed in.
export async function recognizeTextOnDevice(
  uri: string,
): Promise<OcrNativeResult> {
  const result = await recognizeText(uri);
  return {
    blocks: flattenBlocks(result.blocks),
  };
}

// Rescales an engine result's boxes into 0..1 space relative to the image that
// was actually fed to the OCR engine (NOT the picker's original dimensions if
// the image was pre-downscaled — the boxes come back in the fed image's space).
// Empty-text and non-finite-box blocks are dropped in one pass: the Android ML
// Kit bridge maps a null native boundingBox to an empty object `{}` (the TS type
// doesn't reflect this), which would yield NaN after division and contaminate
// line clustering — a single NaN height collapses the median tolerance, fusing
// every row into one cluster.
export function normalizeOcrResult(
  result: OcrNativeResult,
  imageWidth: number,
  imageHeight: number,
): OcrTextBlock[] {
  if (imageWidth <= 0 || imageHeight <= 0) {
    return [];
  }
  const out: OcrTextBlock[] = [];
  for (const block of result.blocks) {
    if (block.text.trim().length === 0 || !isFiniteBox(block.box)) {
      continue;
    }
    out.push({
      text: block.text,
      normalizedBox: {
        x: block.box.x / imageWidth,
        y: block.box.y / imageHeight,
        width: block.box.width / imageWidth,
        height: block.box.height / imageHeight,
      },
    });
  }
  return out;
}

function isFiniteBox(box: OcrBlock["box"] | null | undefined): boolean {
  if (!box) {
    return false;
  }
  return (
    Number.isFinite(box.x) &&
    Number.isFinite(box.y) &&
    Number.isFinite(box.width) &&
    Number.isFinite(box.height)
  );
}

// Whether this device can run on-device OCR. Gate recognition behind this so
// the uploader can fall back to manual entry on unsupported hardware instead
// of surfacing a confusing engine error.
export function isOcrSupported(): boolean {
  return isSupported();
}

// Collapses the engine's block → line → element hierarchy into one flat
// `OcrBlock` list at the finest granularity available: per-word elements when
// present, else the line, else the whole block. The parser's line-clustering
// step re-joins them by vertical coordinate, so splitting multi-word rows now
// is safe and keeps word-level detail for amount/card-number rows.
function flattenBlocks(
  blocks: import("expo-mlkit-ocr").TextBlock[],
): OcrBlock[] {
  const out: OcrBlock[] = [];
  for (const block of blocks) {
    const lines = block.lines ?? [];
    if (lines.length === 0) {
      out.push({ text: block.text, box: block.boundingBox });
      continue;
    }
    for (const line of lines) {
      const elements = line.elements ?? [];
      if (elements.length > 0) {
        for (const element of elements) {
          out.push({ text: element.text, box: element.boundingBox });
        }
      } else {
        out.push({ text: line.text, box: line.boundingBox });
      }
    }
  }
  return out;
}
