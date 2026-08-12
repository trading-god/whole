// OCR eval — LLM "teacher" for the rule engine. The runner (`run-eval.ts`)
// tells you a sample fails, but not why. This tool turns the parser's trace
// (`samples/<slug>/trace.json`) plus the per-line rule-decisions into
// evidence and asks a configured model to act as the rule engine's teacher:
// for each failure it localizes the misbehaving stage (line classification /
// amount matching / grouping), identifies the exact rule constant or condition
// that misfired, and suggests a concrete fix — without editing code itself.
//
// Usage: pnpm --filter @whole/ocr-eval run teach [--sample <slug>]
//   (or `pnpm eval:ocr:teach -- --sample <slug>` from the repo root)
//
// Output: a markdown diagnosis report written to `samples/<slug>/diagnosis.md`
// (gitignored — it's derived debugging guidance, not a fixture).
//
// The teacher is deliberately *advisory*: it diagnoses and recommends, the
// human (or the agent) applies the rule change, then re-runs `pnpm eval:ocr`.
// The report's `## Diagnosis` section maps each failure to a suggestion of the
// form "change X in ocr-<stage>.ts so that …" so the fix lands in the right
// rule file.
//
// Env: same OpenAI-compatible variables as `annotate.ts`
// (OPENAI_BASE_URL / OPENAI_API_KEY / OPENAI_MODEL). The report needs the
// blocks (via trace.json) and expected gold — the screenshot is not sent.
import * as fs from "node:fs";
import * as path from "node:path";

import { resolveSampleTargets, samplesDir } from "./paths";
import { resolveLlmConfig, callModel } from "./llm";
import { diagnoseTrace } from "./diagnose";
import type { OcrTrace } from "@/features/assets/ocr-parser";

// Builds the teacher's single user turn: a summary of the sample, the
// per-line decision evidence, the trace's grouped accounts, the gold expected
// output, and the resulting parser output. The model then returns a diagnosis
// report.
function buildTeacherMessage(slug: string): string {
  const tracePath = path.join(samplesDir, slug, "trace.json");
  if (!fs.existsSync(tracePath)) {
    throw new Error(
      `No trace.json for '${slug}' — run \`pnpm eval:ocr:trace -- --sample ${slug}\` first.`,
    );
  }
  const trace = JSON.parse(fs.readFileSync(tracePath, "utf8")) as OcrTrace;

  const lineDiagnosis = diagnoseTrace(trace);
  const parsed = trace.groups;
  const goldRaw = fs.readFileSync(
    path.join(samplesDir, slug, "expected.json"),
    "utf8",
  );
  const gold = JSON.parse(goldRaw);

  const lineTable = lineDiagnosis
    .map(
      (l) =>
        `#${l.index} "${l.text}"\n` +
        `  role=${l.role}, digits=${l.digitCount}, ` +
        `labelMarker=${l.hasLabelMarker}, cardLike=${l.isCardLike}, ` +
        `masked=${l.isMaskedCard}, amount=${JSON.stringify(l.amount)}, ` +
        `currency=${JSON.stringify(l.currencyMention)}`,
    )
    .join("\n");

  return [
    "You are the teacher of a pure TypeScript rule engine that parses bank-app " +
      "screenshot OCR into accounts. The engine has three stages: line " +
      "clustering, row classification (role), and account grouping. A sample " +
      "failed its regression check. Below is the evidence: per-line decision " +
      "data, the grouped output, and the gold (expected) accounts.",
    "",
    "YOUR JOB: diagnose precisely where the rule engine misbehaved and what " +
      "rule constant / condition / regex to change. For EACH failure, say which " +
      "stage misfired (classification vs amount-matching vs grouping), which " +
      "specific rule caused it (e.g. a LABEL_MARKERS entry, the amount regex " +
      "NUMBER_RE, a card-digit threshold, the summary markers), and suggest a " +
      "minimal fix. Give the concrete modified value where possible. Do NOT " +
      "write full code files — name the file and the exact change.",
    "",
    "Return markdown with these sections:",
    "## Summary",
    "## Diagnosis (one numbered item per failing line/account with root cause + rule + fix)",
    "## Suggested rule changes (table: file | constant/condition | change)",
    "## Risks / notes",
    "",
    `--- sample: ${slug} ---`,
    "",
    "### Per-line rule decisions (line | text | role | digits | labelMarker | " +
      "cardLike | masked | amount | currencyMention):",
    lineTable,
    "",
    "### Grouped accounts the parser produced (from trace):",
    JSON.stringify(parsed, null, 2),
    "",
    "### Gold expected accounts:",
    JSON.stringify(gold, null, 2),
    "",
    "Focus on what's WRONG versus the gold. Be concrete — never generic.",
  ].join("\n");
}

async function teachSample(
  slug: string,
  config: ReturnType<typeof resolveLlmConfig> | null,
  dryRun: boolean,
): Promise<void> {
  try {
    const prompt = buildTeacherMessage(slug);
    if (dryRun) {
      console.log(`--- ${slug}: teacher prompt (dry run) ---`);
      console.log(prompt.slice(0, 4000));
      if (prompt.length > 4000) {
        console.log(`… (prompt is ${prompt.length} chars total)`);
      }
      return;
    }
    const response = await callModel(
      {
        role: "user",
        content: [{ type: "text", text: prompt }],
      },
      // `config` is non-null here (main resolves it unless dry-run), but TS
      // can't see the correlation, so assert.
      config!,
    );
    const target = path.join(samplesDir, slug, "diagnosis.md");
    fs.writeFileSync(target, response + "\n", "utf8");
    console.log(`✓ ${slug}: diagnosis written to diagnosis.md`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`✗ ${slug}: teach failed — ${message}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const slugs = resolveSampleTargets(args);
  // Dry-run only prints prompts — no LLM call, so no API key needed. Resolve
  // the config lazily so `--dry-run` works without OPENAI_API_KEY set.
  const config = dryRun ? null : resolveLlmConfig();
  console.log(
    `Teaching with ${config ? `${config.model}@${config.baseUrl}` : "(dry run)"} over ${slugs.length} sample(s) …`,
  );
  // Dry-run output must stay readable (the whole point is inspecting the
  // prompt), so run it serially; the LLM-calling path is safe to parallelize.
  if (dryRun) {
    for (const slug of slugs) {
      await teachSample(slug, config, dryRun);
    }
  } else {
    await Promise.all(slugs.map((slug) => teachSample(slug, config, dryRun)));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
