// OCR eval — trace dumper: replays a sample's recorded `blocks.json` through
// the parser's tracing variant and writes the intermediate stages (clustered
// lines, per-line roles, grouped accounts with their source line indexes) to
// `samples/<slug>/trace.json`. That file feeds the LLM-based diagnosis tool
// (`teach.ts`), which turns the raw trace into a rule-level fix report.
//
// Usage: pnpm --filter @whole/ocr-eval run dump [--sample <slug>]
//   (or `pnpm eval:ocr:trace -- --sample <slug>` from the repo root)
//   without --sample, dumps every sample that has a blocks.json.
//
// `trace.json` is a derived debugging artifact: it is NOT committed (see the
// `.gitignore` entry `packages/ocr-eval/samples/*/trace.json`). Like
// `screenshot.png`, it may contain account-structure details that are fine to
// see locally but should not travel in git history.
import * as fs from "node:fs";
import * as path from "node:path";

import { parseOcrBlocksTraced } from "@/features/assets/ocr-parser";
import { loadOcrBlocks, resolveSampleTargets, samplesDir } from "./paths";

async function main() {
  const slugs = resolveSampleTargets(process.argv.slice(2));

  for (const slug of slugs) {
    try {
      const { trace } = parseOcrBlocksTraced(loadOcrBlocks(slug));
      const target = path.join(samplesDir, slug, "trace.json");
      fs.writeFileSync(target, JSON.stringify(trace, null, 2) + "\n", "utf8");
      console.log(
        `✓ ${slug}: ${trace.classified.length} classified lines, ` +
          `${trace.groups.length} groups → trace.json`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`✗ ${slug}: dump failed — ${message}`);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
