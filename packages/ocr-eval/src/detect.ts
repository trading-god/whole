// OCR eval — bank-detection verifier: replays each sample's recorded
// `blocks.json` through the parser and prints which bank the pipeline resolves
// it to. A sanity check that detection routes each sample to the right config
// before the grouping pass.
//
// Runs through the real `parseOcrBlocksTraced` entry point (whose trace
// carries the detected `bankId`) rather than hand-rebuilding the cluster →
// classify → detect steps, so the verifier exercises the same pipeline the
// parser runs and can't drift from it.
//
// Usage: pnpm --filter @whole/ocr-eval run detect
//   (or `pnpm eval:ocr:detect` from the repo root)
import { parseOcrBlocksTraced } from "@/features/assets/ocr-parser";
import { listSampleSlugs, loadOcrBlocks } from "./paths";

for (const slug of listSampleSlugs()) {
  const { trace } = parseOcrBlocksTraced(loadOcrBlocks(slug));
  console.log(`${slug}: ${trace.bankId}`);
}
