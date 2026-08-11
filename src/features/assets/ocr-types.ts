// Cross-engine OCR types shared by the native adapter, the semantic parser,
// and the Node eval harness. Keeping the parser's input as these lightweight
// flat blocks (rather than the engine's block→line→element hierarchy) decouples
// the parser from any one engine and lets the harness replay recorded `blocks`
// without touching native code.
//
// Boxes come out of the native engine in pixel space with a top-left origin
// (x/y = top-left corner). `normalizeOcrResult` (in ocr-engine.ts) rescales
// them to 0..1 against the exact image the engine was fed, so the parser never
// depends on absolute pixel dimensions and survives image rescale / downsampling
// / EXIF rotation.

/** One flat OCR text region with its pixel-space bounding box. */
export type OcrBlock = {
  text: string;
  box: { x: number; y: number; width: number; height: number };
};

/** The engine-level result: the flat OCR blocks. */
export type OcrNativeResult = {
  blocks: OcrBlock[];
};

/** A block normalized to 0..1 on both axes. */
export type OcrTextBlock = {
  text: string;
  normalizedBox: { x: number; y: number; width: number; height: number };
};
