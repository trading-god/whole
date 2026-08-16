// Baseline gate for the OCR eval. Comparing every sample against gold answers
// "is the parser perfect yet?" — which, for a rule engine still growing its
// institution coverage, is permanently "no". That makes a plain all-or-nothing
// exit code useless as a regression gate: it is red before a change and red
// after it, so it can't tell a real regression from a pre-existing gap.
//
// The baseline records the *currently known* failures per sample, field by
// field. The gate then answers the question that actually matters while the
// engine is being built: **did this change break something that used to
// work?** A failure listed in `baseline.json` is a known gap (reported, not
// fatal); a failure that is NOT listed is a regression (fatal). A listed
// failure that now passes is progress — reported so the baseline gets tightened
// via `--update-baseline`, which is what stops the known-gap list from silently
// growing stale.
//
// Each known gap carries a reason so the report can separate "this institution
// isn't wired into detection yet" from "a shared rule misfires", which is the
// difference between "add a config entry" and "fix the rule engine".
import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";

import { DETECT_INSTITUTIONS, type RecognizedAccount } from "@whole/ocr";
import {
  ACCOUNT_FIELD_KEYS,
  extraFieldKey,
  fieldKey,
  type SampleComparison,
} from "./compare";
import { packageRoot } from "./paths";

// Why a known failure is expected to fail today.
// - `unsupported-institution`: the sample's institution has no detection
//   signals yet (it isn't in `DETECT_INSTITUTIONS`), so grouping runs with the
//   shared defaults. Fixed by adding an `InstitutionConfig`, not by touching
//   the shared rules.
// - `parser-bug`: the institution IS supported, so the shared rules or that
//   institution's config genuinely get this wrong.
// - `gold-uncertain`: the gold itself is suspect (written but not yet checked
//   against the screenshot field by field). Never inferred automatically — set
//   it by hand to park a sample until its gold is verified.
const baselineReasonSchema = z.enum([
  "unsupported-institution",
  "parser-bug",
  "gold-uncertain",
]);
export type BaselineReason = z.infer<typeof baselineReasonSchema>;

// `knownFailures[slug][fieldKey] = reason`, where `fieldKey` is `count` for a
// wrong account count, or `<goldAccountIndex>.<field>` (e.g. `0.lastFour`) for
// a field-level failure. The gold account index is stable because `compare()`
// maps over `expected.json` in order.
const baselineSchema = z.object({
  note: z.string().optional(),
  knownFailures: z.record(
    z.string(),
    z.record(z.string(), baselineReasonSchema),
  ),
});
export type Baseline = z.infer<typeof baselineSchema>;

const baselinePath = path.join(packageRoot, "baseline.json");

const BASELINE_NOTE =
  "Known OCR parser failures, per sample and field. A failure listed here is a " +
  "known gap; one that is not is a regression and fails `pnpm eval:ocr`. " +
  "Regenerate with `pnpm eval:ocr -- --update-baseline`; hand-set a reason to " +
  "`gold-uncertain` to park a sample whose gold is not human-checked yet.";

// Institutions that `detectInstitution` can actually route to. An institution
// named by a gold but missing here has no detection signals yet, which is a
// coverage gap rather than a rule bug.
const DETECTED_INSTITUTIONS = new Set<string>(DETECT_INSTITUTIONS);

export function loadBaseline(): Baseline {
  if (!fs.existsSync(baselinePath)) {
    return { knownFailures: {} };
  }
  const raw: unknown = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  return baselineSchema.parse(raw);
}

// Writes the baseline with sorted keys so a regenerated file diffs cleanly
// against the committed one (an unordered rewrite would churn every line).
export function saveBaseline(baseline: Baseline): void {
  const sortedSlugs = Object.keys(baseline.knownFailures).sort();
  const knownFailures: Baseline["knownFailures"] = {};
  for (const slug of sortedSlugs) {
    const fields = baseline.knownFailures[slug];
    const sortedFields: Record<string, BaselineReason> = {};
    for (const key of Object.keys(fields).sort()) {
      sortedFields[key] = fields[key];
    }
    // A sample whose failures were all fixed drops out entirely rather than
    // lingering as an empty object.
    if (Object.keys(sortedFields).length > 0) {
      knownFailures[slug] = sortedFields;
    }
  }
  const content = JSON.stringify(
    { note: BASELINE_NOTE, knownFailures },
    null,
    2,
  );
  fs.writeFileSync(baselinePath, content + "\n", "utf8");
}

// The field keys a sample currently fails on. `count` covers a wrong number of
// recognized accounts; the rest are `<goldAccountIndex>.<field>`.
export function collectFailures(comparison: SampleComparison): string[] {
  const keys: string[] = [];
  if (comparison.count.expected !== comparison.count.got) {
    keys.push("count");
    // Keyed by how MANY extra accounts, so the baseline can't absorb a change
    // in what they are. Baselining a bare `count` froze the sample at "emits
    // one spurious account" and then said nothing when that account's contents
    // changed completely — the failure-key set stayed exactly `{count}`.
    keys.push(`count:${comparison.count.got}`);
  }
  comparison.accounts.forEach((account, index) => {
    for (const field of ACCOUNT_FIELD_KEYS) {
      const result = account.fields[field];
      if (result && result.status !== "pass") {
        // An `extra` verdict is keyed apart from a miss or a mismatch. Both are
        // `<index>.<field>`, and `diffSample` can only ask "does the gold want
        // this field" — which is NO for an extra either way. So fixing an extra
        // (the parser stops emitting the field, the key disappears) looked
        // identical to the gold dropping a field it used to ask for, and the
        // run exited 2 reporting shrunken coverage on a strict improvement.
        keys.push(
          result.status === "extra"
            ? extraFieldKey(index, field)
            : fieldKey(index, field),
        );
      }
    }
  });
  return keys;
}

// Classifies a sample's failures by whether its institution is detectable yet.
// Sample-level rather than field-level on purpose: when an institution has no
// config, its name/last-four/balance failures are all downstream of that one
// gap, and the fix is the same single change — adding the config.
function inferReason(expected: RecognizedAccount[]): BaselineReason {
  const institutionId = expected.find(
    (account) => account.institutionId && account.institutionId !== "unknown",
  )?.institutionId;
  return institutionId && !DETECTED_INSTITUTIONS.has(institutionId)
    ? "unsupported-institution"
    : "parser-bug";
}

export type BaselineEntry = { sample: string; key: string };
export type KnownGap = BaselineEntry & { reason: BaselineReason };

export type BaselineDiff = {
  // Failures absent from the baseline — something that used to work broke.
  regressions: BaselineEntry[];
  // Baselined failures that now pass. Not fatal, but the baseline should be
  // updated to lock the win in.
  resolved: BaselineEntry[];
  // Baselined failures whose gold no longer ASKS for the field. Coverage
  // shrank; the parser did not improve. Reported apart from `resolved` because
  // reading it as progress invites locking in a gate that got smaller — which
  // is what deleting a field from a gold (by hand, or by regenerating it from
  // the model) silently does.
  droppedCoverage: BaselineEntry[];
  // Failures the baseline already knows about.
  knownGaps: KnownGap[];
};

// Diffs one sample's current failures against its baselined ones.
export function diffSample(
  slug: string,
  failures: string[],
  baseline: Baseline,
  requiredKeys: ReadonlySet<string> = new Set(),
): BaselineDiff {
  const known = baseline.knownFailures[slug] ?? {};
  const current = new Set(failures);

  const regressions = failures
    .filter((key) => known[key] === undefined)
    .map((key) => ({ sample: slug, key }));
  const gone = Object.keys(known).filter((key) => !current.has(key));
  // Only a FIELD key can lose its coverage — it is the gold that asks for it.
  // A count key describes what the parser emitted, so its disappearance is
  // always the parser improving.
  // A FIELD key the gold asks for. `<index>.<field>:extra` is excluded: the
  // gold asks for nothing there by definition, so its disappearance is always
  // the parser improving, never the gold shrinking.
  const isFieldKey = (key: string) =>
    /^\d+\./.test(key) && !key.endsWith(":extra");
  const resolved = gone
    .filter((key) => !isFieldKey(key) || requiredKeys.has(key))
    .map((key) => ({ sample: slug, key }));
  const droppedCoverage = gone
    .filter((key) => isFieldKey(key) && !requiredKeys.has(key))
    .map((key) => ({ sample: slug, key }));
  const knownGaps = failures
    .filter((key) => known[key] !== undefined)
    .map((key) => ({ sample: slug, key, reason: known[key] }));

  return { regressions, resolved, droppedCoverage, knownGaps };
}

// Rebuilds a sample's baseline entry from its current failures, preserving any
// hand-set `gold-uncertain` reason — that one is a human judgement about the
// gold, so an automatic regeneration must not overwrite it.
export function rebuildEntry(
  slug: string,
  failures: string[],
  expected: RecognizedAccount[],
  previous: Baseline,
): Record<string, BaselineReason> {
  const known = previous.knownFailures[slug] ?? {};
  const inferred = inferReason(expected);
  const entry: Record<string, BaselineReason> = {};
  for (const key of failures) {
    entry[key] = known[key] === "gold-uncertain" ? "gold-uncertain" : inferred;
  }
  return entry;
}
