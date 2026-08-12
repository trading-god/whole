// Shared helpers for the eval package: path resolution, sample discovery, and
// the blocks fixture schema. Kept in one module so the runner (`run-eval.ts`)
// and the annotator (`annotate.ts`) share the same sample-finding and
// fixture-loading logic instead of each re-declaring it.
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import {
  assetKindSchema,
  lastFourDigitsSchema,
} from "@/features/assets/account-appearance";
import { accountBalanceSchema } from "@/features/assets/account-balance-schema";
import type { OcrTextBlock } from "@/features/assets/ocr-types";

function currentFileDir(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}

// Absolute path to this package's root (`packages/ocr-eval`). Sources live in
// `src/`, so the root is one level up from this file. The samples directory
// and any repo-root lookups stay anchored to the package root, not to `src/`.
export const packageRoot = path.resolve(currentFileDir(), "..");

// Absolute path to the samples directory, which lives in the package. Samples
// travel with the runner regardless of where the package is installed or
// invoked from.
export const samplesDir = path.join(packageRoot, "samples");

// Recorded blocks.json shape — the normalized OCR output the parser consumes
// (the same 0..1 contract `normalizeOcrResult` produces). Validated at load so
// a hand-edited fixture (the eval README invites making them by hand) fails
// with a clear shape error naming the sample, instead of an opaque crash
// mid-batch ("expected.map is not a function") that aborts everything.
export const blocksFixtureSchema = z.object({
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

// The zod schema for a `RecognizedAccount`, assembled from the same pure
// schemas the app's parser validates against. Used to validate gold
// `expected.json` files at load so a malformed fixture fails with a clear
// shape error instead of an opaque crash mid-comparison.
export const recognizedAccountSchema = z.object({
  accountName: z.string().optional(),
  accountLastFourDigits: lastFourDigitsSchema.optional(),
  balances: z.array(accountBalanceSchema).optional(),
  kind: assetKindSchema.optional(),
});

// Lists sample slugs (subdirectories of `samplesDir` that contain a
// `blocks.json`), sorted. Shared by the runner and the annotator so sample
// discovery can't drift between them.
export function listSampleSlugs(): string[] {
  return fs
    .readdirSync(samplesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((slug) => fs.existsSync(path.join(samplesDir, slug, "blocks.json")))
    .sort();
}

// Parses the `--sample <slug>` CLI flag from args, returning the slug or null
// when absent. Shared by the runner and the annotator so the flag contract
// can't drift between them.
export function parseSampleFlag(args: string[]): string | null {
  const idx = args.indexOf("--sample");
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
}

// Resolves the sample slugs a CLI should process: the `--sample <slug>` target
// when given, otherwise every sample under `samplesDir`. Exits the process
// with a clear message when none are found, so each CLI's `main` is a single
// call instead of repeating the slice → parse → list → guard sequence.
export function resolveSampleTargets(args: string[]): string[] {
  const onlySlug = parseSampleFlag(args);
  const slugs = onlySlug ? [onlySlug] : listSampleSlugs();
  if (slugs.length === 0) {
    console.error(
      "No samples found (create samples/<slug>/blocks.json first).",
    );
    process.exit(1);
  }
  return slugs;
}

// Loads a sample's recorded `blocks.json` and returns the validated fixture
// blocks (the raw `box` shape). The single read+validate site for
// `blocks.json`; callers that need the parser's `normalizedBox` contract use
// `loadOcrBlocks` below, and callers that need the raw `box` for an LLM
// prompt (`annotate.ts`) use this directly.
export function loadFixtureBlocks(slug: string) {
  const raw: unknown = JSON.parse(
    fs.readFileSync(path.join(samplesDir, slug, "blocks.json"), "utf8"),
  );
  return blocksFixtureSchema.parse(raw).blocks;
}

// Loads a sample's recorded `blocks.json` mapped to the parser's
// `normalizedBox` contract (recorded boxes are already normalized 0..1, so
// they pass straight through). Shared by `run-eval.ts` and `dump.ts` so the
// blocks→parser-input mapping can't drift between them.
export function loadOcrBlocks(slug: string): OcrTextBlock[] {
  return loadFixtureBlocks(slug).map((b) => ({
    text: b.text,
    normalizedBox: {
      x: b.box.x,
      y: b.box.y,
      width: b.box.width,
      height: b.box.height,
    },
  }));
}
