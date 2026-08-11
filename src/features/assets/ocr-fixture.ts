// Fixture builders for the OCR regression harness (`packages/ocr-eval`).
//
// The on-device OCR pipeline produces `RecognizedAccount[]` from a screenshot,
// but the eval harness can't see screenshots or run OCR in Node — it replays a
// recorded `blocks.json` (the normalized 0..1 OCR output) through the pure
// parser and compares against a gold `expected.json`. These two builders turn
// what the *capture screen* already computed back into those two fixture files,
// so adding a regression sample is: capture → copy blocks.json → write
// expected.json → run `pnpm eval:ocr`.
//
// The blocks shape here must stay the inverse of `loadSample` in
// `packages/ocr-eval/run-eval.ts` (its `blocksFixtureSchema`); the two sides consume
// the exact same `{ blocks: [{ text, box }] }` kernel, so a change on either
// side breaks the harness against the recorded fixtures — keep them in lockstep.
import type { OcrTextBlock } from "./ocr-types";
import type { RecognizedAccount } from "./recognition-types";

// One recorded OCR region, serialized in the 0..1 normalized space the parser
// consumes (`normalizedBox` in OCR terms, `box` on the wire — see `loadSample`
// in run-eval.ts, which maps `box` back onto `normalizedBox`).
export type OcrBlocksFixture = {
  blocks: {
    text: string;
    box: { x: number; y: number; width: number; height: number };
  }[];
};

// Serializes the normalized blocks the capture screen produced into the
// `blocks.json` fixture shape the eval harness loads. This is the forward
// mapping of `loadSample`'s `blocksFixtureSchema` — `text` passes through and
// `normalizedBox` is renamed to `box`.
export function blocksJsonFromNormalized(
  blocks: OcrTextBlock[],
): OcrBlocksFixture {
  return {
    blocks: blocks.map((block) => ({
      text: block.text,
      box: {
        x: block.normalizedBox.x,
        y: block.normalizedBox.y,
        width: block.normalizedBox.width,
        height: block.normalizedBox.height,
      },
    })),
  };
}

// Builds the `expected.json` template from recognition results. The accounts
// are returned as-is — every `RecognizedAccount` field is left present so the
// template is self-documenting (delete the fields you don't want required
// before saving). Raw field names match `RecognizedAccount` one-to-one (no
// snake_case rewriting — `compare.ts` consumes the gold through the recognition
// contract), so the template reads exactly like the fixture the harness
// compares against.
export function expectedTemplateFromAccounts(
  accounts: RecognizedAccount[],
): RecognizedAccount[] {
  return accounts;
}
