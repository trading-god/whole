// Eval runner for the OCR semantic parser.
//
// Loads each sample under `samples/<slug>/`, replays its recorded `blocks.json`
// through the pure parser, and compares the result against the gold
// `expected.json` using `compare.ts`. Output is a per-sample pass/fail table
// plus per-field aggregates.
//
// `samples/<slug>/blocks.json` stores the *normalized* OCR output of the device
// capture step (0..1 boxes) — the same shape `normalizeOcrResult` produces and
// the parser consumes, so the harness replays the exact parser input.
//
// Usage:
//   pnpm eval:ocr            # all samples (repo root)
//   pnpm --filter @whole/ocr-eval run eval -- --sample <slug>   # one sample
import * as fs from "node:fs";
import * as path from "node:path";

import { parseOcrBlocks } from "@/features/assets/ocr-parser";
import type { RecognizedAccount } from "@/features/assets/recognition-types";
import {
  compareOneGold,
  type SampleComparison,
  type FieldResult,
} from "./compare";
import { renderHeader, renderSample, renderSummary } from "./render";
import {
  listSampleSlugs,
  loadOcrBlocks,
  parseSampleFlag,
  recognizedAccountSchema,
  samplesDir,
} from "./paths";

function loadSample(slug: string): {
  blocks: ReturnType<typeof loadOcrBlocks>;
  expected: RecognizedAccount[];
} {
  const dir = path.join(samplesDir, slug);
  const blocks = loadOcrBlocks(slug);
  const expected = recognizedAccountSchema
    .array()
    .parse(
      JSON.parse(fs.readFileSync(path.join(dir, "expected.json"), "utf8")),
    );
  return { blocks, expected };
}

function compare(
  slug: string,
  expected: RecognizedAccount[],
  parsed: RecognizedAccount[],
): SampleComparison {
  const accounts = expected.map((gold) => compareOneGold(gold, parsed));
  const count = { expected: expected.length, got: parsed.length };
  const pass = accounts.every((a) => a.pass) && count.expected === count.got;
  return { sample: slug, accounts, pass, count };
}

function main() {
  const args = process.argv.slice(2);
  const onlySlug = parseSampleFlag(args);

  const slugs = onlySlug ? [onlySlug] : listSampleSlugs();
  if (slugs.length === 0) {
    console.error(
      onlySlug
        ? `No sample '${onlySlug}' with blocks.json under ${samplesDir}`
        : `No samples found under ${samplesDir} (create samples/<slug>/{blocks.json, expected.json})`,
    );
    process.exit(1);
  }

  console.log(renderHeader());
  const results: SampleComparison[] = [];
  const aggregates = new Map<string, { expected: number; passed: number }>();

  for (const slug of slugs) {
    const { blocks, expected } = loadSample(slug);
    const accounts = parseOcrBlocks(blocks);
    const comparison = compare(slug, expected, accounts);
    results.push(comparison);
    console.log(renderSample(comparison));

    for (let i = 0; i < expected.length; i++) {
      const gold = expected[i];
      const accountComparison = comparison.accounts[i];
      // Pass per required field, read off the comparison's per-field status.
      tallyPassed(
        gold.accountName,
        "accountName",
        accountComparison?.name,
        aggregates,
      );
      tallyPassed(
        gold.accountLastFourDigits,
        "lastFour",
        accountComparison?.lastFour,
        aggregates,
      );
      tallyPassed(gold.kind, "kind", accountComparison?.kind, aggregates);
      for (const b of gold.balances ?? []) {
        tallyPassed(
          b.currency,
          `balance:${b.currency}`,
          accountComparison?.balances,
          aggregates,
        );
      }
    }
  }

  const aggregatesList = [...aggregates.entries()]
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => a.name.localeCompare(b.name));
  console.log(renderSummary(results, aggregatesList));

  const allPass = results.every((r) => r.pass);
  if (!onlySlug && !allPass) {
    process.exit(2);
  }
}

function tallyPassed(
  value: string | undefined,
  bucket: string,
  field: FieldResult | undefined,
  map: Map<string, { expected: number; passed: number }>,
): void {
  if (!value || value.trim().length === 0) {
    return;
  }
  const entry = map.get(bucket) ?? { expected: 0, passed: 0 };
  entry.expected += 1;
  if (field?.status === "pass") {
    entry.passed += 1;
  }
  map.set(bucket, entry);
}

main();
