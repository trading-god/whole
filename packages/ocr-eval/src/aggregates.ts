// Per-field accuracy aggregation, shared by the two eval runners.
//
// Both runners answer the same question — over the whole corpus, how often did
// recognition get each field right? — and they answered it with two private
// copies of the tally until the copies drifted apart (the llama runner's
// `name` bucket vs the rule-engine runner's `accountName`, for the same field).
// Sharing the walk makes the two reports comparable by construction: both
// drive their field lists off `compare.ts`'s `ACCOUNT_FIELDS`, so a field is
// bucketed identically whichever runner produced the table.
import type { RecognizedAccount } from "@whole/ocr";

import {
  ACCOUNT_FIELDS,
  goldRequires,
  type AccountFieldKey,
  type FieldResult,
} from "./compare";

export type FieldAggregates = Map<string, { expected: number; passed: number }>;

/** One aggregate row, in the one order both reports print. */
export type FieldAggregateRow = {
  name: string;
  expected: number;
  passed: number;
};

function tally(
  bucket: string,
  passed: boolean,
  aggregates: FieldAggregates,
): void {
  const entry = aggregates.get(bucket) ?? { expected: 0, passed: 0 };
  entry.expected += 1;
  if (passed) {
    entry.passed += 1;
  }
  aggregates.set(bucket, entry);
}

/**
 * Tallies one gold account's fields into `aggregates`.
 *
 * A scalar field is counted only where the gold REQUIRES it — a gold that
 * omits the name or the last four asserts nothing, and counting it as a miss
 * shrank the denominator with failures that are not failures. Balances get one
 * bucket per CURRENCY, not per gold row (a gold can legitimately list one
 * currency several times — HSBC One holds three HKD sub-accounts — and
 * counting each row tripled that currency's denominator with copies of a
 * single verdict); any currency the recognition invented is in `perCurrency`
 * too, so it gets its own bucket.
 *
 * `fields` is the comparison's verdicts for this gold; `undefined` counts
 * every required field as failed, which is how a runner scores a sample the
 * pipeline could not answer at all.
 */
export function tallyGoldAccount(
  gold: RecognizedAccount,
  fields: Partial<Record<AccountFieldKey, FieldResult>> | undefined,
  aggregates: FieldAggregates,
): void {
  for (const field of ACCOUNT_FIELDS) {
    if (!goldRequires(field.read(gold))) {
      continue;
    }
    tally(field.bucket, fields?.[field.key]?.status === "pass", aggregates);
  }

  const perCurrency = fields?.balances?.perCurrency ?? {};
  const currencies = new Set([
    ...(gold.balances ?? []).map((balance) => balance.currency as string),
    ...Object.keys(perCurrency),
  ]);
  for (const currency of currencies) {
    tally(`balance:${currency}`, perCurrency[currency] ?? false, aggregates);
  }
}

/**
 * The aggregates as rows sorted by bucket — both runners print the same
 * sorted table, so the reports can be laid side by side line by line.
 */
export function sortedFieldAggregates(
  aggregates: FieldAggregates,
): FieldAggregateRow[] {
  return [...aggregates.entries()]
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * A bucket's accuracy, rounded. The one place that rounding happens, so the
 * per-sample reports and the ablation matrix cannot disagree on a number they
 * both print. Callers that may hold an unmeasured bucket check the denominator
 * first — an empty one has no accuracy, and 0% would claim a measured failure.
 */
export function fieldAccuracyPercent(row: FieldAggregateRow): number {
  return Math.round((row.passed / row.expected) * 100);
}

/**
 * One report line for one bucket — the format BOTH runners print, so the
 * side-by-side comparison holds line for line, not just bucket for bucket.
 */
export function formatFieldAggregateRow(row: FieldAggregateRow): string {
  return `  ${row.name.padEnd(16)} ${String(row.passed).padStart(3)}/${String(row.expected).padEnd(3)}  ${fieldAccuracyPercent(row)}%`;
}
