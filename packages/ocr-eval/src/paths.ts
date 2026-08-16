// Shared helpers for the eval package: path resolution, sample discovery, and
// fixture loading. Kept in one module so every CLI here (the runner, the
// Vision bridge, the single-image recognizer, the golden test) finds and loads
// samples the same way instead of each re-declaring it.
//
// The *shapes* are not declared here: `blocksFixtureSchema` and
// `recognizedAccountSchema` are the recognition contract and belong to
// `@whole/ocr`, which owns both the writer and the reader of those files. This
// module only decides where they live on disk.
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import {
  blocksFixtureSchema,
  blocksFromFixture,
  recognizedAccountSchema,
  type OcrTextBlock,
  type RecognizedAccount,
} from "@whole/ocr";

// The message off a caught `unknown`. Every CLI here reports failures as one
// line of text, so this was written out nine times before it was a function —
// nine places to edit the day the harness wants a stack trace or an error code.
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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

// Lists sample slugs (subdirectories of `samplesDir` containing `marker`),
// sorted. Shared so sample discovery can't drift between the CLIs — the
// recorded-blocks consumers list by `blocks.json`, the Vision bridge by
// `screenshot.png`.
export function listSampleSlugs(marker = "blocks.json"): string[] {
  return fs
    .readdirSync(samplesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((slug) => fs.existsSync(path.join(samplesDir, slug, marker)))
    .sort();
}

// The directory the command was typed in, for resolving a user-supplied path.
// `pnpm --filter` runs a package script with the PACKAGE as cwd, so a relative
// path the user typed at the repo root would otherwise resolve against
// `packages/ocr-eval/`. The root scripts forward `OCR_INVOCATION_DIR`;
// `INIT_CWD` covers a direct `pnpm --filter` invocation.
export function invocationDir(): string {
  return (
    process.env.OCR_INVOCATION_DIR || process.env.INIT_CWD || process.cwd()
  );
}

// Parses the `--sample <slug>` CLI flag from args, returning the slug or null
// when absent. Shared by every CLI here so the flag contract can't drift
// between them.
//
// A flag is never a value. Falling through to null expanded a run to EVERY
// sample — `--sample --update-baseline`, or a `--sample` whose slug was
// forgotten, rebuilt the whole baseline instead of one entry, with only
// "baseline.json updated (17 sample(s) rebuilt)" as the tell. The gate must
// never shrink by accident. Every CLI here takes flags after the slug, so the
// next argument being one means the slug was omitted.
//
// Thrown, not exited: this module is the shared loader — the test suites import
// it too — so terminating the process here would kill a vitest worker instead
// of failing an assertion. Each CLI's top-level catch turns it into the exit
// code.
export function parseSampleFlag(args: string[]): string | null {
  const idx = args.indexOf("--sample");
  if (idx === -1) {
    return null;
  }
  const value = args[idx + 1];
  if (value && !value.startsWith("--")) {
    return value;
  }
  throw new Error("--sample needs a value (e.g. `--sample ocbc-overview`).");
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

// Runs `worker` over `items` with at most `limit` in flight, returning results
// in input order. The work here is almost entirely spent waiting on a Vision
// subprocess, so a serial loop sits idle; the cap keeps that from turning into
// one child process per sample all at once.
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  // At least one runner. `os.cpus()` can return an empty array, and a limit of
  // 0 produced no runners at all — every result stayed a hole and the caller
  // crashed reading `.status` off `undefined`.
  const runners = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      for (let i = next++; i < items.length; i = next++) {
        results[i] = await worker(items[i]);
      }
    },
  );
  await Promise.all(runners);
  return results;
}

// Runs `load` and, on failure, re-throws naming the sample and the file. Both
// fixtures are hand-editable — the README invites it — and a bare zod error
// reads as `blocks[12].text` with no hint which of seventeen samples produced
// it. `contract/fixture.ts` promises "a clear shape error naming the sample";
// this is where that promise is kept.
function withSampleNamed<T>(slug: string, file: string, load: () => T): T {
  try {
    return load();
  } catch (error) {
    const message = errorMessage(error);
    throw new Error(`samples/${slug}/${file} is malformed — ${message}`);
  }
}

// Loads a sample's recorded `blocks.json` and returns the validated fixture
// (the raw `box` shape). The single read+validate site for `blocks.json`;
// callers that need the parser's `normalizedBox` contract use `loadOcrBlocks`
// below, and callers that compare fixtures as recorded (`vision.ts --check`,
// `recognize.ts --sample`) use this directly.
export function loadFixture(slug: string) {
  return withSampleNamed(slug, "blocks.json", () => {
    const raw: unknown = JSON.parse(
      fs.readFileSync(path.join(samplesDir, slug, "blocks.json"), "utf8"),
    );
    return blocksFixtureSchema.parse(raw);
  });
}

// Loads a sample's recorded `blocks.json` mapped to the parser's
// `normalizedBox` contract.
export function loadOcrBlocks(slug: string): OcrTextBlock[] {
  return blocksFromFixture(loadFixture(slug));
}

// Loads a sample's gold `expected.json`, or null when the sample has no gold
// yet (a screenshot recorded but not annotated). The single read+validate site,
// so the runner and the golden test reject a malformed gold the same way
// instead of one of them crashing mid-batch on it.
export function loadGoldAccounts(slug: string): RecognizedAccount[] | null {
  const goldPath = path.join(samplesDir, slug, "expected.json");
  if (!fs.existsSync(goldPath)) {
    return null;
  }
  return withSampleNamed(slug, "expected.json", () => {
    const raw: unknown = JSON.parse(fs.readFileSync(goldPath, "utf8"));
    // `.strict()`: a gold is hand-edited, and a misspelled key ("lastFour" for
    // "accountLastFourDigits") was silently dropped by the non-strict object —
    // turning a required assertion into "not required" with no diagnostic, in
    // the very file the hard-assert golden test reads.
    return recognizedAccountSchema.strict().array().parse(raw);
  });
}
