// Import OCR fixtures from a device export into the eval samples directory.
//
// The device-side batch capture screen runs OCR on a folder of screenshots and
// exports a zip (via `expo-sharing`) containing one subdirectory per screenshot:
//   <slug>/blocks.json
//   <slug>/screenshot.png
//
// This CLI unpacks that structure (or a pre-unzipped folder) into
// `packages/ocr-eval/samples/<slug>/`, validating each `blocks.json` with the
// shared fixture schema so a corrupt export fails with a clear error instead of
// silently landing a broken sample. After import, run `pnpm eval:ocr:label`
// (no `--sample`) to batch-generate `expected.json` for every new sample, then
// check each `expected.json` by hand.
//
// Usage:
//   pnpm --filter @whole/ocr-eval run import <export-dir>
//   (or `pnpm eval:ocr:import <export-dir>` from the repo root)
//
// `--slug-prefix <prefix>` optionally prefixes every imported slug (e.g. to
// batch-tag a capture session: `--slug-prefix 2026-08-ocbc`).
import * as fs from "node:fs";
import * as path from "node:path";

import { blocksFixtureSchema, samplesDir } from "./paths";

// Reads a directory entry's stats; returns null when missing (skip vs throw).
function safeStat(p: string): fs.Stats | null {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}

// Copies a file, creating the destination directory. No-op when the source
// is missing (screenshot.png is optional during import — the annotator works
// without it, though multimodal accuracy drops).
function copyIfPresent(src: string, dest: string): boolean {
  if (!fs.existsSync(src)) {
    return false;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  return true;
}

// Imports one sample subdirectory: validates blocks.json, copies blocks.json
// and screenshot.png into `samples/<slug>/`. Returns a short status line.
function importSample(srcDir: string, slug: string): string {
  const destDir = path.join(samplesDir, slug);
  const blocksSrc = path.join(srcDir, "blocks.json");

  if (!fs.existsSync(blocksSrc)) {
    return `✗ ${slug}: no blocks.json (skipped)`;
  }

  // Validate the blocks fixture before copying — a corrupt export (wrong
  // box shape, missing text) should fail here, not silently become a broken
  // sample that breaks the next eval run.
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(blocksSrc, "utf8"));
    blocksFixtureSchema.parse(raw);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return `✗ ${slug}: invalid blocks.json — ${msg}`;
  }

  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(blocksSrc, path.join(destDir, "blocks.json"));

  const screenshotSrc = path.join(srcDir, "screenshot.png");
  const hasScreenshot = copyIfPresent(
    screenshotSrc,
    path.join(destDir, "screenshot.png"),
  );

  return `✓ ${slug}: blocks.json imported${
    hasScreenshot ? " + screenshot.png" : " (no screenshot)"
  }`;
}

async function main() {
  const args = process.argv.slice(2);
  const inputIdx = args.findIndex((a) => !a.startsWith("--"));
  if (inputIdx === -1) {
    console.error(
      "Usage: import <export-dir> [--slug-prefix <prefix>]\n\n" +
        "  <export-dir>  folder of <slug>/ subdirs (each with blocks.json\n" +
        "                and optional screenshot.png), as exported by the\n" +
        "                device batch capture screen.\n",
    );
    process.exit(1);
  }
  const inputDir = path.resolve(args[inputIdx]);

  const prefixIdx = args.indexOf("--slug-prefix");
  const slugPrefix =
    prefixIdx !== -1 && args[prefixIdx + 1] ? args[prefixIdx + 1] : "";

  const stat = safeStat(inputDir);
  if (!stat || !stat.isDirectory()) {
    console.error(`✗ not a directory: ${inputDir}`);
    process.exit(1);
  }

  const entries = fs
    .readdirSync(inputDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  if (entries.length === 0) {
    console.error(`✗ no sample subdirectories in ${inputDir}`);
    process.exit(1);
  }

  console.log(`Importing ${entries.length} sample(s) from ${inputDir}…\n`);
  for (const name of entries) {
    const slug = slugPrefix ? `${slugPrefix}-${name}` : name;
    console.log(importSample(path.join(inputDir, name), slug));
  }

  console.log(
    "\nNext: run `pnpm eval:ocr:label` to batch-generate expected.json, " +
      "then check each by hand and run `pnpm eval:ocr`.",
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
