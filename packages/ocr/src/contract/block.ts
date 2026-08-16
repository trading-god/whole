// The parser's input shape, shared by the native adapter, the semantic parser,
// and the Node eval harness. Keeping it a lightweight flat block (rather than an
// engine's block→line→element hierarchy) decouples the parser from any one
// engine and lets the harness replay recorded `blocks` without touching native
// code.
//
// Normalized to 0..1 on both axes, deliberately. Pixel-space boxes are the
// NATIVE side's business: whichever engine is installed emits its own convention
// (top-left origin, centre origin, quad corners), and the app's adapter —
// `src/features/assets/ocr-engine.ts`, which declares those raw types — rescales
// them against the exact image the engine was fed. That is what keeps this
// contract from having to change the day the bridge does, and what lets the
// parser survive image rescale / downsampling / EXIF rotation.

/** A block normalized to 0..1 on both axes. */
export type OcrTextBlock = {
  text: string;
  normalizedBox: { x: number; y: number; width: number; height: number };
};
