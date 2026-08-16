// The `blocks.json` wire format the OCR regression harness (`packages/ocr-eval`)
// replays.
//
// The on-device OCR pipeline produces `RecognizedAccount[]` from a screenshot,
// but the eval harness can't see screenshots or run OCR in Node — it replays a
// recorded `blocks.json` (the normalized 0..1 OCR output) through the pure
// parser and compares against a gold `expected.json`. Adding a regression
// sample is record blocks.json → write expected.json → run `pnpm eval:ocr`.
//
// This is the serialized form of `OcrTextBlock`, which is why it lives in
// `contract/` beside the type rather than in the harness that reads it: the
// format IS the parser's input contract, written down. Whoever records a
// fixture — today the macOS Vision bridge, tomorrow something else — has to
// produce this shape, and `blocksFixtureSchema` is what says so.
//
// The gold half deliberately does not live here. A gold is NARROWER than the
// contract — only the fields a human can check against the screenshot, with the
// inferred ones (kind, institution) left out unless they were verified — so a
// gold cannot agree with the parser by construction. That is a decision about
// how a gold is authored, and it lives with the tooling that authors it
// (`packages/ocr-eval`).
import { z } from "zod";

import type { OcrTextBlock } from "./block";

// One recorded OCR region, serialized in the 0..1 normalized space the parser
// consumes (`normalizedBox` in OCR terms, `box` on the wire).
//
// Validated at load so a hand-edited fixture (the eval README invites making
// them by hand) fails with a clear shape error naming the sample, instead of an
// opaque crash mid-batch ("expected.map is not a function") that aborts
// everything.
export const blocksFixtureSchema = z.object({
  // Which OCR path recorded this fixture. Optional because the app's (since
  // removed) device capture screen predates the field and never emitted it —
  // absent means "captured on-device". The macOS Vision bridge stamps
  // `macos-vision` so a locally generated fixture is never mistaken for a
  // device capture, which is what `eval:ocr:vision -- --check` exists to keep
  // honest.
  source: z.enum(["ios", "android", "macos-vision"]).optional(),
  blocks: z.array(
    z.object({
      text: z.string(),
      box: z.object({
        x: z.number(),
        y: z.number(),
        width: z.number(),
        height: z.number(),
      }),
    }),
  ),
});

export type OcrBlocksFixture = z.infer<typeof blocksFixtureSchema>;

// Maps recorded fixture blocks onto the parser's `normalizedBox` contract
// (recorded boxes are already normalized 0..1, so they pass straight through).
//
// There is no serializing counterpart here. There was one — for an app-side
// capture screen that has since been removed — and it outlived its only caller
// by long enough to read as API. The macOS Vision bridge builds its fixture
// from the Swift output directly, so the format currently has exactly one
// writer and it lives with that bridge; add a shared writer back here when a
// second one appears, not before.
export function blocksFromFixture(fixture: OcrBlocksFixture): OcrTextBlock[] {
  return fixture.blocks.map((block) => ({
    text: block.text,
    normalizedBox: {
      x: block.box.x,
      y: block.box.y,
      width: block.box.width,
      height: block.box.height,
    },
  }));
}
