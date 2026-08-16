// ASCII rendering for the eval runner's results. Kept separate from run-eval so
// the formatting can be tested/read in isolation.
import type { BaselineDiff, BaselineEntry, BaselineReason } from "./baseline";
import type { SampleComparison } from "./compare";

export function renderHeader(): string {
  return [
    "OCR eval — on-device parser vs gold",
    "──────────────────────────────────────────────",
  ].join("\n");
}

// A sample's standing against the baseline: fully passing, failing only in
// ways the baseline already knows about, or newly broken.
type SampleStatus = "pass" | "known" | "regression";

function sampleStatus(
  comparison: SampleComparison,
  diff: BaselineDiff,
): SampleStatus {
  if (comparison.pass) {
    return "pass";
  }
  return diff.regressions.length > 0 ? "regression" : "known";
}

const STATUS_MARKS: Record<SampleStatus, string> = {
  pass: "✓",
  known: "~",
  regression: "✗",
};

// Renders one sample's status line plus per-field breakdown when it isn't
// clean. `~` means "fails exactly as the baseline expects" — worth showing, but
// not what the gate trips on, so regressions are called out separately below
// the issue list instead of being buried among the known gaps.
export function renderSample(
  comparison: SampleComparison,
  diff: BaselineDiff,
): string {
  const status = sampleStatus(comparison, diff);
  const lines = [`${STATUS_MARKS[status]} ${comparison.sample}`];
  if (status === "pass") {
    return lines[0];
  }

  for (const account of comparison.accounts) {
    if (!account.pass) {
      for (const issue of account.issues) {
        lines.push(`   · ${issue}`);
      }
    }
  }
  if (comparison.count.expected !== comparison.count.got) {
    lines.push(
      `   · account count: expected ${comparison.count.expected}, got ${comparison.count.got}`,
    );
  }
  if (diff.regressions.length > 0) {
    lines.push(
      `   ! REGRESSION (not in baseline): ${diff.regressions
        .map((r) => r.key)
        .join(", ")}`,
    );
  }
  return lines.join("\n");
}

export function renderSummary(
  samples: SampleComparison[],
  aggregates: { name: string; expected: number; passed: number }[],
): string {
  const total = samples.length;
  const passed = samples.filter((s) => s.pass).length;
  const lines = [
    "",
    "──────────────────────────────────────────────",
    `samples: ${passed}/${total} passed`,
  ];
  for (const agg of aggregates) {
    lines.push(`  ${agg.name}: ${agg.passed}/${agg.expected}`);
  }
  return lines.join("\n");
}

const REASON_LABELS: Record<BaselineReason, string> = {
  "unsupported-institution": "institution not wired into detection",
  "parser-bug": "rule engine gets it wrong",
  "gold-uncertain": "gold not human-checked",
};

// The gate's verdict: what broke, what got fixed, and what's still a known gap
// broken down by reason — so the summary answers "what should I work on next"
// rather than just "how red is it".
// How many regressions a set of failure keys represents. A wrong account count
// is deliberately TWO keys — `count` and `count:N`, so the baseline cannot
// absorb a change in what the extra account is — but it is one regression, and
// the headline number the reader acts on should say so.
//
// Exported because the exit gate must count the same way: reporting "1" and
// failing on "2" is one edit away from a run that prints "0 regressions" and
// exits 2.
export function countRegressions(entries: BaselineEntry[]): number {
  return new Set(
    entries.map((entry) => `${entry.sample}:${entry.key.split(":")[0]}`),
  ).size;
}

export function renderBaselineReport(diff: BaselineDiff): string {
  // A wrong account count is deliberately TWO keys — `count` and `count:N`, so
  // the baseline cannot absorb a change in what the extra account is — but it
  // is one regression, and reporting "regressions: 2" for it doubled the
  // headline number the reader acts on.
  const lines = ["", `regressions: ${countRegressions(diff.regressions)}`];

  for (const entry of diff.regressions) {
    lines.push(`  ✗ ${entry.sample} → ${entry.key}`);
  }

  if (diff.droppedCoverage.length > 0) {
    lines.push(`no longer required by gold: ${diff.droppedCoverage.length}`);
    for (const entry of diff.droppedCoverage) {
      lines.push(`  · ${entry.sample} → ${entry.key}`);
    }
    lines.push(
      "  (the gold stopped asking for these — coverage shrank, the parser did not improve)",
    );
  }
  lines.push(`resolved: ${diff.resolved.length}`);
  if (diff.resolved.length > 0) {
    for (const entry of diff.resolved) {
      lines.push(`  ✓ ${entry.sample} → ${entry.key}`);
    }
    lines.push("  (run `pnpm eval:ocr -- --update-baseline` to lock these in)");
  }

  const byReason = new Map<BaselineReason, number>();
  for (const gap of diff.knownGaps) {
    byReason.set(gap.reason, (byReason.get(gap.reason) ?? 0) + 1);
  }
  lines.push(`known gaps: ${diff.knownGaps.length}`);
  for (const [reason, count] of [...byReason.entries()].sort(
    (a, b) => b[1] - a[1],
  )) {
    lines.push(`  ${count} × ${reason} — ${REASON_LABELS[reason]}`);
  }

  return lines.join("\n");
}
