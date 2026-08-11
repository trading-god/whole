// ASCII rendering for the eval runner's results. Kept separate from run-eval so
// the formatting can be tested/read in isolation.
import type { SampleComparison } from "./compare";

export function renderHeader(): string {
  return [
    "OCR eval — on-device parser vs gold",
    "──────────────────────────────────────────────",
  ].join("\n");
}

// Renders one sample's pass/fail line plus per-field breakdown if it failed.
export function renderSample(c: SampleComparison): string {
  const mark = c.pass ? "✓" : "✗";
  const lines = [`${mark} ${c.sample}`];
  if (!c.pass) {
    for (const account of c.accounts) {
      if (!account.pass) {
        for (const issue of account.issues) {
          lines.push(`   · ${issue}`);
        }
      }
    }
    if (c.count.expected !== c.count.got) {
      lines.push(
        `   · account count: expected ${c.count.expected}, got ${c.count.got}`,
      );
    }
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
