// Eval runner for the ON-DEVICE recognition path: the recorded blocks replayed
// through `recognizeWithModel`, with the model call answered by a local GGUF
// (Gemma 4 E2B, or whatever quant is under test) through node-llama-cpp.
//
// It is the quality gate on the weights the app bundles. The unit tests cannot
// execute a llama.cpp parse, so whether a 2B quant's grammar-constrained output
// holds the annotation contract is decided HERE, against the same gold samples.
//
// Read-only: it writes no baseline. The verdict is the per-field table —
// compare it across quantizations (Q4_K_M vs Q6_K) and against the rule-engine
// baseline; the numbers choose the weights that ship. Re-runs are cheap to
// make deterministic: temperature is 0.
//
// Usage:
//   WHOLE_GGUF_PATH=/path/to/gemma.gguf pnpm eval:ocr:llama
//   WHOLE_GGUF_PATH=... pnpm --filter @whole/ocr-eval run eval:llama -- --sample <slug>
//   WHOLE_GGUF_PATH=... pnpm eval:ocr:llama -- --ablate currency
//
// `--ablate <mode>` runs both of the pipeline's passes with one tier of
// institution config removed, so the model is asked the question a real user's
// unrecognized institution would ask. It is the only way to measure what the
// annotation turn contributes: every sample in this corpus HAS a config, so an
// unablated run scores the config, not the model. Compare the table against
// the same mode's column in `pnpm eval:ocr:ablate`, which is the engine alone
// under identical conditions.
import {
  INSTITUTION_ABLATIONS,
  RECOGNITION_TURNS,
  recognizeWithModel,
} from "@whole/ocr";

import {
  sortedFieldAggregates,
  tallyGoldAccount,
  type FieldAggregates,
} from "./aggregates";
import { compareSample, passIgnoringInstitution } from "./compare";
import { renderFieldAccuracy } from "./render";
import { createLlamaRunModel } from "./llama-run-model";
import {
  errorMessage,
  loadGoldOrSkip,
  loadOcrBlocks,
  namedSampleExists,
  parseEnumFlag,
  parseSampleFlag,
  resolveSampleTargets,
} from "./paths";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const onlySlug = parseSampleFlag(args);
  const slugs = resolveSampleTargets(args);
  // `--ablate <mode>` is validated against what the engine implements rather
  // than against a list retyped here — an unknown mode is a typo, and silently
  // running unablated would report the config's score as the model's.
  const ablate = parseEnumFlag(args, "--ablate", INSTITUTION_ABLATIONS);
  // `--turn structure` forces the assignment turn onto every sample, including
  // the ones whose institution IS configured. It is how the corpus answers
  // whether "configured institution" is still a good proxy for "layout the
  // rules were written against" — see `RecognitionOptions.turn`.
  const turn = parseEnumFlag(args, "--turn", RECOGNITION_TURNS);

  let handle;
  try {
    handle = await createLlamaRunModel();
  } catch (error) {
    console.error(`✗ ${errorMessage(error)}`);
    process.exit(1);
  }
  const { runModel, dispose, ggufPath } = handle;

  console.log(
    `on-device eval over ${slugs.length} sample(s) — weights from ${ggufPath}` +
      (ablate === undefined
        ? ""
        : `\n  institution config ablated: ${ablate} (compare with \`pnpm eval:ocr:ablate\`)`) +
      "\n",
  );

  const aggregates: FieldAggregates = new Map();
  let compared = 0;
  let brokeContract = 0;

  try {
    for (const slug of slugs) {
      const expected = loadGoldOrSkip(slug);
      if (!expected) {
        continue;
      }

      const outcome = await recognizeWithModel(loadOcrBlocks(slug), runModel, {
        ablate,
        turn,
      });

      if (!outcome.ok) {
        console.log(`✗ ${slug}: the model never held the contract`);
        console.log(`    ${outcome.reason}`);
        // Every field the gold asks for counts as failed — a sample the model
        // could not answer is a real gap, not a non-measurement.
        expected.forEach((gold) => {
          tallyGoldAccount(gold, undefined, aggregates);
        });
        compared += 1;
        brokeContract += 1;
        continue;
      }

      const comparison = compareSample(
        slug,
        expected,
        outcome.recognition.accounts,
      );
      const { accounts } = comparison;
      // Same discount the rule-engine ablation applies, so the two tables can
      // be read side by side under this mode — see `passIgnoringInstitution`.
      const pass =
        ablate === "institution"
          ? passIgnoringInstitution(comparison)
          : comparison.pass;
      // The model's institution answer rides on the sample line: it is half
      // of what the annotation turn exists for, and judging it is by eye —
      // the gold carries the engine's enum id, the model answers free text.
      const institution = outcome.recognition.institution?.displayName;
      console.log(
        `${pass ? "✓" : "✗"} ${slug} (${outcome.attempts} attempt(s))` +
          (institution === undefined ? "" : ` — ${institution}`),
      );
      for (const issue of accounts.flatMap((a) => a.issues)) {
        console.log(`    ${issue}`);
      }

      // Same walk as the rule-engine report, so the tables line up bucket for
      // bucket. `institutionId` here is the ENGINE's detection (the model
      // answers with a free-text displayName, judged by eye for now), so that
      // row mirrors the rule-engine run rather than measuring the model.
      expected.forEach((gold, index) => {
        tallyGoldAccount(gold, accounts[index]?.fields, aggregates);
      });
      compared += 1;
    }
  } finally {
    await dispose();
  }

  console.log(
    `\n${renderFieldAccuracy(
      `${compared} sample(s) compared\nfield accuracy:`,
      sortedFieldAggregates(aggregates),
    )}`,
  );

  // A run that compared nothing is a broken invocation, not a clean result —
  // same rule as the rule-engine eval.
  if (compared === 0 && !namedSampleExists(onlySlug)) {
    console.error(`\n✗ no sample was compared.`);
    process.exit(2);
  }

  // A sample the model could not answer is a FAILURE of this gate, not a low
  // score: field accuracy is a measurement to compare quants by, but "never
  // held the annotation contract" says the weights, the prompt or the grammar
  // are broken for that screen. Exiting 0 on it would make this unusable as
  // the gate its own header calls it — including under `--ablate`, where a
  // degraded config still has to produce a well-formed answer.
  if (brokeContract > 0) {
    console.error(
      `\n✗ ${brokeContract} sample(s) never held the annotation contract.`,
    );
    process.exit(2);
  }
}

try {
  await main();
} catch (error) {
  console.error(`✗ ${errorMessage(error)}`);
  process.exit(1);
}
