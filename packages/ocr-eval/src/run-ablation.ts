// The ablation report: what is the engine worth WITHOUT the institution config
// written for these very screenshots?
//
// It replays the corpus with one tier of that config removed at a time and
// reports what each tier was carrying. `institutions/ablation.ts` owns the
// modes and says why each is a tier; `packages/ocr-eval/README.md` covers how
// to read the table and what the model recovers on top. Neither is restated
// here.
//
// It is a MEASUREMENT, not a gate: no baseline, and it exits 0 whatever the
// numbers say. `run-eval.ts` is the gate, and mixing the two would let an
// ablated run rewrite the baseline with degraded results — every failure a mode
// induces would enter the gate as a known gap and stop being reported.
//
// Usage:
//   pnpm eval:ocr:ablate
//   pnpm eval:ocr:ablate -- --sample ocbc-overview
import {
  INSTITUTION_ABLATIONS,
  parseOcrBlocks,
  type InstitutionAblation,
  type OcrTextBlock,
  type RecognizedAccount,
} from "@whole/ocr";

import {
  fieldAccuracyPercent,
  sortedFieldAggregates,
  tallyGoldAccount,
  type FieldAggregateRow,
  type FieldAggregates,
} from "./aggregates";
import { compareSample, passIgnoringInstitution } from "./compare";
import {
  errorMessage,
  loadGoldOrSkip,
  loadOcrBlocks,
  resolveSampleTargets,
} from "./paths";

// "none" is the control, and it runs through the identical path — same loader,
// same comparison, same tally. Recomputing the baseline rather than trusting
// the gate's 17/17 is what makes a delta in this table attributable to the
// ablation and nothing else.
const CONTROL = "none" as const;
type ModeName = typeof CONTROL | InstitutionAblation;

const MODES: readonly ModeName[] = [CONTROL, ...INSTITUTION_ABLATIONS];

/** One sample, loaded once and replayed under every mode. */
type Sample = {
  slug: string;
  gold: RecognizedAccount[];
  blocks: OcrTextBlock[];
};

type ModeResult = {
  mode: ModeName;
  compared: number;
  samplesPassed: number;
  /** Slugs that passed whole, so a mode's losses can be named. */
  passed: Set<string>;
  aggregates: FieldAggregateRow[];
};

// One sample under one mode. A parse that throws is a total miss rather than a
// crash: the point of the run is to see what breaks, and a mode that makes the
// pipeline throw on one screen still has fifteen others to report on.
function scoreSample(
  sample: Sample,
  mode: ModeName,
  aggregates: FieldAggregates,
): boolean {
  let parsed: RecognizedAccount[];
  try {
    parsed = parseOcrBlocks(
      sample.blocks,
      mode === CONTROL ? {} : { ablate: mode },
    );
  } catch (error) {
    console.warn(
      `  · ${sample.slug} threw under ${mode}: ${errorMessage(error)}`,
    );
    sample.gold.forEach((account) =>
      tallyGoldAccount(account, undefined, aggregates),
    );
    return false;
  }

  const comparison = compareSample(sample.slug, sample.gold, parsed);
  sample.gold.forEach((account, index) =>
    tallyGoldAccount(account, comparison.accounts[index]?.fields, aggregates),
  );
  // See `passIgnoringInstitution`: under this one mode `institutionId` fails by
  // definition, and judging the sample on it would make the column unreadable.
  return mode === "institution"
    ? passIgnoringInstitution(comparison)
    : comparison.pass;
}

function runMode(mode: ModeName, samples: Sample[]): ModeResult {
  const aggregates: FieldAggregates = new Map();
  const passed = new Set<string>();
  for (const sample of samples) {
    if (scoreSample(sample, mode, aggregates)) {
      passed.add(sample.slug);
    }
  }
  return {
    mode,
    compared: samples.length,
    samplesPassed: passed.size,
    passed,
    aggregates: sortedFieldAggregates(aggregates),
  };
}

// ── Report ─────────────────────────────────────────────────────────────────

const MODE_WIDTH = 14;

// Accuracy and its raw counts in one cell: a mode that makes recognition report
// a DIFFERENT currency moves that bucket's denominator, and a bare percentage
// hides the move.
function cell(row: FieldAggregateRow | undefined): string {
  // A bucket a mode never reached has no denominator — printing 0% would claim
  // a measured total failure where nothing was measured.
  if (row === undefined || row.expected === 0) {
    return "—";
  }
  return `${fieldAccuracyPercent(row)}% ${row.passed}/${row.expected}`;
}

function renderMatrix(results: ModeResult[]): string {
  // Every bucket any mode produced, so a currency that only appears once the
  // default is gone still gets a row.
  const buckets = [
    ...new Set(results.flatMap((r) => r.aggregates.map((a) => a.name))),
  ].sort();
  const byMode = new Map(
    results.map((r) => [r.mode, new Map(r.aggregates.map((a) => [a.name, a]))]),
  );

  const header = [
    "field".padEnd(16),
    ...results.map((r) => r.mode.padStart(MODE_WIDTH)),
  ].join("");
  const rows = buckets.map((bucket) =>
    [
      bucket.padEnd(16),
      ...results.map((r) =>
        cell(byMode.get(r.mode)?.get(bucket)).padStart(MODE_WIDTH),
      ),
    ].join(""),
  );
  const samples = [
    "samples".padEnd(16),
    ...results.map((r) =>
      `${r.samplesPassed}/${r.compared}`.padStart(MODE_WIDTH),
    ),
  ].join("");

  return [header, "-".repeat(header.length), ...rows, "", samples].join("\n");
}

// What each mode COST, named. The percentages say how much; this says which
// screens, which is what turns the table into a next step.
function renderLosses(results: ModeResult[]): string {
  const control = results.find((r) => r.mode === CONTROL);
  const lines = results
    .filter((r) => r.mode !== CONTROL)
    .map((r) => {
      const lost = [...(control?.passed ?? [])].filter(
        (slug) => !r.passed.has(slug),
      );
      return `  ${r.mode.padEnd(14)}${lost.length === 0 ? "(none)" : lost.join(", ")}`;
    });
  return ["Samples the control passed and the mode lost:", ...lines].join("\n");
}

function main(): void {
  const slugs = resolveSampleTargets(process.argv.slice(2));

  // Loaded once and replayed under every mode: a gold or a fixture that changed
  // between modes would make the columns incomparable, which is the one thing
  // this table has to guarantee — and re-reading each fixture per mode would
  // multiply the parse count by the number of modes for nothing.
  const samples: Sample[] = [];
  for (const slug of slugs) {
    const gold = loadGoldOrSkip(slug);
    if (gold === null) {
      continue;
    }
    samples.push({ slug, gold, blocks: loadOcrBlocks(slug) });
  }

  if (samples.length === 0) {
    console.error("\n✗ no sample had a gold to compare against.");
    process.exit(2);
  }

  console.log(
    `\nInstitution-config ablation — ${samples.length} sample(s), gold-compared\n`,
  );
  const results = MODES.map((mode) => runMode(mode, samples));

  console.log(renderMatrix(results));
  console.log();
  console.log(renderLosses(results));
  console.log(
    [
      "",
      "Every column replays a layout the rules were written against, so each",
      "score is a CEILING for a genuinely unseen institution. Under",
      "`institution`, institutionId is 'unknown' by definition — that row is not",
      "a finding, and the samples row below discounts it so the column stays",
      "comparable with the others.",
      "The rest of how to read this is in packages/ocr-eval/README.md.",
    ].join("\n"),
  );
}

try {
  main();
} catch (error) {
  console.error(`\n✗ ${errorMessage(error)}`);
  process.exit(2);
}
