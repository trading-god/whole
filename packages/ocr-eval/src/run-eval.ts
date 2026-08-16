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
// The gate is the *baseline*, not perfection: the parser is still growing its
// institution coverage, so a plain "all samples must pass" exit code would be
// red before and after every change and catch nothing. `baseline.json` records
// the currently known failures; this runner fails only on a failure that isn't
// baselined (a regression), and reports newly passing fields so the baseline
// can be tightened. See `baseline.ts`.
//
// Usage:
//   pnpm eval:ocr            # all samples (repo root)
//   pnpm --filter @whole/ocr-eval run eval -- --sample <slug>   # one sample
//   pnpm eval:ocr -- --update-baseline                          # rewrite baseline.json
import { parseOcrBlocks, type RecognizedAccount } from "@whole/ocr";
import {
  collectFailures,
  diffSample,
  loadBaseline,
  rebuildEntry,
  saveBaseline,
  type Baseline,
  type BaselineDiff,
} from "./baseline";
import {
  ACCOUNT_FIELDS,
  compareGolds,
  fieldKey,
  goldRequires,
  type SampleComparison,
  type FieldResult,
} from "./compare";
import {
  countRegressions,
  renderBaselineReport,
  renderHeader,
  renderSample,
  renderSummary,
} from "./render";
import {
  errorMessage,
  listSampleSlugs,
  loadGoldAccounts,
  loadOcrBlocks,
  parseSampleFlag,
  resolveSampleTargets,
} from "./paths";

function compare(
  slug: string,
  expected: RecognizedAccount[],
  parsed: RecognizedAccount[],
): SampleComparison {
  const accounts = compareGolds(expected, parsed);
  const count = { expected: expected.length, got: parsed.length };
  const pass = accounts.every((a) => a.pass) && count.expected === count.got;
  return { sample: slug, accounts, pass, count };
}

function main() {
  const args = process.argv.slice(2);
  // `onlySlug` controls the exit code (exit 0 for a single-sample run, exit 2
  // on a regression when running all samples); `resolveSampleTargets` handles
  // the slug expansion and the "no samples" guard.
  const onlySlug = parseSampleFlag(args);
  const updateBaseline = args.includes("--update-baseline");
  const slugs = resolveSampleTargets(args);
  const baseline = loadBaseline();
  // Rebuilt entries land here; slugs outside this run keep their existing
  // entries, so `--update-baseline --sample <slug>` re-baselines one sample
  // without discarding the rest.
  //
  // A FULL rebuild also prunes entries whose sample no longer exists. Carried
  // forward, a deleted slug's known failures sit in the baseline forever, and
  // re-importing that slug later would start out pre-baselined — its failures
  // non-fatal from the first run, which is exactly what the gate exists to
  // prevent.
  const carriedOver = onlySlug
    ? baseline.knownFailures
    : Object.fromEntries(
        Object.entries(baseline.knownFailures).filter(([slug]) =>
          slugs.includes(slug),
        ),
      );
  const nextBaseline: Baseline = { knownFailures: { ...carriedOver } };

  console.log(renderHeader());
  const results: SampleComparison[] = [];
  const totals: BaselineDiff = {
    regressions: [],
    resolved: [],
    droppedCoverage: [],
    knownGaps: [],
  };
  const aggregates = new Map<string, { expected: number; passed: number }>();
  const skipped: string[] = [];
  const unreadable: string[] = [];

  for (const slug of slugs) {
    // `listSampleSlugs` returns every sample with a blocks.json; samples
    // without a gold expected.json (recorded, not yet annotated) can't
    // be compared, so warn and skip them instead of crashing on the missing file.
    const expected = loadGoldAccounts(slug);
    if (!expected) {
      console.warn(`· ${slug}: skipped (no expected.json yet)`);
      skipped.push(slug);
      continue;
    }
    // Guarded per sample: a malformed fixture costs its own sample, not the
    // other sixteen. It still fails the run — a sample that cannot be replayed
    // has left the gate, which is exactly what the exit code is for.
    let accounts;
    try {
      accounts = parseOcrBlocks(loadOcrBlocks(slug));
    } catch (error) {
      console.error(`✗ ${slug}: ${errorMessage(error)}`);
      unreadable.push(slug);
      continue;
    }
    const comparison = compare(slug, expected, accounts);
    results.push(comparison);

    const failures = collectFailures(comparison);
    // Which field keys the gold actually asks for, so a baselined failure that
    // disappeared because the GOLD changed isn't reported as the parser
    // improving. Count keys are never in here — how many accounts the parser
    // emits is its own business, so a count failure going away is always a fix.
    // Read off the GOLD, not off the comparison. Deriving it from the recorded
    // verdicts looked equivalent and was not: an `extra` verdict means the gold
    // asks for nothing, so counting it made FIXING that — the parser stops
    // emitting the field, the verdict disappears — read as the gold shrinking,
    // and the run exited 2 on an improvement.
    const requiredKeys = requiredFieldKeys(expected);
    const diff = diffSample(slug, failures, baseline, requiredKeys);
    totals.regressions.push(...diff.regressions);
    totals.resolved.push(...diff.resolved);
    totals.droppedCoverage.push(...diff.droppedCoverage);
    totals.knownGaps.push(...diff.knownGaps);
    if (updateBaseline) {
      nextBaseline.knownFailures[slug] = rebuildEntry(
        slug,
        failures,
        expected,
        baseline,
      );
    }
    console.log(renderSample(comparison, diff));

    for (let i = 0; i < expected.length; i++) {
      const gold = expected[i];
      const fields = comparison.accounts[i]?.fields;
      // Pass per required field, read off the comparison's per-field status.
      for (const field of ACCOUNT_FIELDS) {
        tallyPassed(
          field.read(gold),
          field.bucket,
          fields?.[field.key],
          aggregates,
        );
      }
      // Balances get one bucket per currency the gold names, and each bucket
      // reads that currency's OWN verdict. Reading the whole-account result
      // reported the same answer for every currency, so one wrong USD figure
      // was printed as SGD and HKD failing too.
      // One entry per CURRENCY, not per gold row: a gold can legitimately list
      // one currency several times (HSBC One holds three HKD sub-accounts, and
      // `compareBalances` sums them), and counting each row tripled that
      // currency's denominator with copies of a single verdict. Any currency
      // the parser invented is in `perCurrency` too, so it gets its own bucket.
      const perCurrency = fields?.balances?.perCurrency ?? {};
      const currencies = new Set([
        ...(gold.balances ?? []).map((b) => b.currency as string),
        ...Object.keys(perCurrency),
      ]);
      for (const currency of currencies) {
        tally(
          `balance:${currency}`,
          perCurrency[currency] ?? false,
          aggregates,
        );
      }
    }
  }

  const aggregatesList = [...aggregates.entries()]
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => a.name.localeCompare(b.name));
  console.log(renderSummary(results, aggregatesList));
  console.log(renderBaselineReport(totals));

  // A sample that couldn't be replayed fails the run whatever the mode. On
  // `--update-baseline` it matters more, not less: writing a baseline while a
  // sample is unreadable freezes its stale entries and calls it a clean run.
  if (unreadable.length > 0) {
    console.error(
      `\n✗ ${unreadable.join(", ")}: could not be replayed (see above).`,
    );
    process.exit(2);
  }

  // A run that compared nothing is a broken invocation, not a clean result: a
  // typo'd `--sample` slug, or a sample that was renamed or deleted, otherwise
  // prints "skipped" and exits 0 — indistinguishable from a passing gate.
  //
  // One case is NOT broken: a named sample that exists and simply has no gold
  // yet. That is the interactive way to work on a freshly imported sample, and
  // the message below suggests it. A named slug that is not a sample at all —
  // the typo — still fails.
  const namedSampleExists =
    onlySlug !== null && listSampleSlugs().includes(onlySlug);
  if (results.length === 0 && !namedSampleExists) {
    console.error(
      `\n✗ no sample was compared (${slugs.length} target(s) had no expected.json).`,
    );
    process.exit(2);
  }

  // A sample that IS baselined but has lost its gold takes its known gaps out
  // of the gate with it — the run goes green while the coverage quietly
  // shrinks. Warning is not enough for that one; it has to fail. Same for an
  // explicitly requested slug: the caller asked for it by name.
  // A baselined slug that produced no result at all — its `blocks.json` was
  // deleted or renamed, so sample discovery never even listed it — leaves the
  // gate exactly as quietly as a missing gold, and `--update-baseline` then
  // prunes its known failures. This PR performs such a rename itself
  // (boc-overview → boc-hk-overview).
  const vanished = Object.keys(baseline.knownFailures).filter(
    (slug) => !slugs.includes(slug),
  );
  //
  // Not on `--update-baseline`: a full rebuild is exactly how a renamed or
  // deleted slug is meant to leave the baseline (see `carriedOver` above), and
  // blocking it made that documented recovery impossible without hand-editing
  // `baseline.json`.
  // Every sample that has a `blocks.json` must have a gold, on a full run.
  //
  // Keyed on the baseline alone, this gate protected nothing: `knownFailures`
  // is empty whenever the corpus passes — which is the committed state — so
  // deleting any sample's `expected.json` printed "skipped", reported
  // "16/16 passed" and exited 0. The sample set is the manifest; a slug that
  // brought a fixture and lost its gold has left the gate.
  //
  // A single-sample run is exempt (it is an interactive probe), and so is a
  // newly recorded sample only until the full run is next taken seriously —
  // write its gold, or work on it with `--sample <slug>`.
  // `--update-baseline` is exempt from both halves: rebuilding the baseline is
  // how a newly recorded sample (or a renamed one) is meant to be brought in,
  // and failing before `saveBaseline` made that impossible without hand-editing
  // the file. A single-sample run is exempt for the same reason the message
  // below suggests it — it is the interactive way to work on a sample that has
  // no gold yet.
  const silentlyDropped =
    onlySlug || updateBaseline ? [] : [...skipped, ...vanished];
  if (silentlyDropped.length > 0) {
    console.error(
      `\n✗ ${silentlyDropped.join(", ")}: the sample produced no result — its ` +
        "blocks.json or expected.json is missing. A sample cannot silently " +
        "leave the gate: write its expected.json against the screenshot, or " +
        "inspect it with `pnpm ocr --sample <slug> --trace` until it has a gold.",
    );
    process.exit(2);
  }

  // Written only after the integrity gates above. A baseline saved while a
  // sample is unreadable or has lost its gold freezes that sample's stale
  // entries and calls the run clean — the exact thing those gates exist to
  // prevent, and `--update-baseline` is when it matters most.
  if (updateBaseline) {
    saveBaseline(nextBaseline);
    console.log(`\nbaseline.json updated (${slugs.length} sample(s) rebuilt).`);
    return;
  }

  // Only a regression is fatal, and only on a full run — a single-sample run is
  // an interactive probe, so it always exits 0.
  //
  // A gold that stopped asking for a baselined field is fatal too. It is a
  // shrinking gate, not a passing one: the parser still gets that field wrong,
  // the sample no longer checks, and the next `--update-baseline` writes the
  // key out of the baseline for good. Failing here forces the choice to be
  // deliberate — re-run with `--update-baseline`, which is the acknowledgement.
  if (!onlySlug && totals.droppedCoverage.length > 0) {
    console.error(
      `\n✗ ${totals.droppedCoverage.length} baselined field(s) are no longer ` +
        "asked for by their gold (listed above). If the gold is right, re-run " +
        "with `--update-baseline` to accept the smaller gate.",
    );
    process.exit(2);
  }

  if (!onlySlug && countRegressions(totals.regressions) > 0) {
    process.exit(2);
  }
}

// The field keys a sample's gold actually asks for, in `<index>.<field>` form.
// This is the question `diffSample` needs answered when a baselined failure
// disappears: the gold still wanting the field means the parser improved, the
// gold no longer wanting it means the gate shrank.
function requiredFieldKeys(expected: RecognizedAccount[]): Set<string> {
  const keys = new Set<string>();
  expected.forEach((gold, index) => {
    for (const field of ACCOUNT_FIELDS) {
      if (goldRequires(field.read(gold))) {
        keys.add(fieldKey(index, field.key));
      }
    }
    if ((gold.balances?.length ?? 0) > 0) {
      keys.add(fieldKey(index, "balances"));
    }
  });
  return keys;
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
  tally(bucket, field?.status === "pass", map);
}

function tally(
  bucket: string,
  passed: boolean,
  map: Map<string, { expected: number; passed: number }>,
): void {
  const entry = map.get(bucket) ?? { expected: 0, passed: 0 };
  entry.expected += 1;
  if (passed) {
    entry.passed += 1;
  }
  map.set(bucket, entry);
}

// A usage error from `parseSampleFlag` (and anything else the run throws)
// becomes the exit code here rather than inside the shared loader.
try {
  main();
} catch (error) {
  console.error(`✗ ${errorMessage(error)}`);
  process.exit(1);
}
