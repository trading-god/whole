// Turns a screenshot into a `blocks.json` fixture on macOS, without a device.
//
// Adding a regression sample used to require booting a dev build, running a
// dev-only capture screen in the app, and copying two fixtures by hand — enough
// friction that the sample set grew slower than the institutions it needs to
// cover. That screen is gone; this is the only way in now. The app's
// iOS OCR path is Apple Vision (`EXPO_MLKIT_OCR_DISABLE_MLKIT=1`), and macOS
// runs the same framework, so `vision/recognize-text.swift` reproduces that path
// locally: drop `screenshot.png` into `samples/<slug>/` and this generates the
// `blocks.json` the harness replays.
//
// **The two paths are NOT identical, and this tool does not pretend they are.**
// Measured across the 17 device-captured samples: zero produce byte-identical
// block text, because macOS and iOS ship different Vision model versions that
// split and read tokens slightly differently. What *does* hold for most samples
// is that the parser lands on the same accounts anyway. So:
//
// - A device capture is authoritative. This never overwrites an existing
//   `blocks.json` without `--overwrite`, and stamps `"source": "macos-vision"`
//   on what it generates so the two can't be confused.
// - `--check` therefore compares what actually matters — the parser's output —
//   rather than the raw blocks. Identical text would be nice; identical
//   recognized accounts is the thing the eval gates on.
// - A sample where the two paths parse differently is a genuine finding: the
//   rule engine is leaning on OCR detail too fragile to survive an engine
//   version bump. That's worth fixing regardless of which fixture is "right".
//
// Usage:
//   pnpm eval:ocr:vision                       # generate missing blocks.json
//   pnpm eval:ocr:vision -- --sample <slug>    # one sample
//   pnpm eval:ocr:vision -- --overwrite        # regenerate existing fixtures too
//   pnpm eval:ocr:vision -- --overwrite --force  # …including device captures
//   pnpm eval:ocr:vision -- --check            # parser-level drift vs committed fixtures
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  blocksFromFixture,
  parseOcrBlocks,
  type OcrBlocksFixture,
} from "@whole/ocr";

import {
  errorMessage,
  listSampleSlugs,
  loadFixture,
  mapWithConcurrency,
  parseSampleFlag,
  samplesDir,
} from "./paths";
import { isVerifiedSample } from "./verified-samples";
import { ensureVisionBinary, recognizeImage } from "./vision-bridge";

type TextAgreement =
  // Same blocks in the same order.
  | "identical"
  // Same blocks, different order — a sort tie-break, harmless to the parser
  // (line clustering re-sorts by coordinate anyway).
  | "reordered"
  // The two engines read the screenshot differently.
  | "differs";

function textAgreement(
  committed: OcrBlocksFixture,
  generated: OcrBlocksFixture,
): TextAgreement {
  const a = committed.blocks.map((b) => b.text);
  const b = generated.blocks.map((block) => block.text);
  if (a.length === b.length && a.every((text, i) => text === b[i])) {
    return "identical";
  }
  // Element-wise, not joined. The join carried a raw NUL byte as its separator
  // — invisible in an editor, and a reader (or a reviewer) sees `join(" ")` and
  // reasonably concludes that `["1,212.52 HKD"]` and `["1,212.52", "HKD"]`
  // compare equal. Comparing the sorted arrays needs no separator at all, and
  // says plainly that a DIFFERENT TOKENIZATION is not a reordering — which is
  // the fragility this check exists to surface.
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  const sameTokens =
    sortedA.length === sortedB.length &&
    sortedA.every((text, i) => text === sortedB[i]);
  return sameTokens ? "reordered" : "differs";
}

// The comparison that decides pass/fail: do both fixtures parse to the same
// accounts? Raw-block equality is reported for context but never gates, because
// the engines genuinely differ and the parser is supposed to absorb that.
function parseAgreement(
  committed: OcrBlocksFixture,
  generated: OcrBlocksFixture,
): { same: boolean; committed: string; generated: string } {
  const left = JSON.stringify(parseOcrBlocks(blocksFromFixture(committed)));
  const right = JSON.stringify(parseOcrBlocks(blocksFromFixture(generated)));
  return { same: left === right, committed: left, generated: right };
}

type Mode = "generate" | "check";

// `skip` covers two different outcomes and the exit code depends on which:
// "the fixture is already there" is the command succeeding with nothing to do,
// while "there is no screenshot" means the request could not be served.
type SampleResult = {
  status: "ok" | "skip" | "fail";
  message: string;
  // True only for the second kind of skip.
  unserved?: boolean;
  // The committed fixture could not be read at all. Distinguished from a
  // divergence: two Vision versions disagreeing is expected and informational,
  // a fixture that won't parse is a broken checkout and has to fail the run.
  unreadable?: boolean;
};

// Whether a committed fixture came off a phone. Absent means yes: the app's
// (since removed) device capture screen predates the stamp (see
// `blocksFixtureSchema`).
function isDeviceCapture(fixture: OcrBlocksFixture): boolean {
  return fixture.source !== "macos-vision";
}

async function processSample(
  slug: string,
  binary: string,
  mode: Mode,
  overwrite: boolean,
  force: boolean,
): Promise<SampleResult> {
  const dir = path.join(samplesDir, slug);
  const screenshot = path.join(dir, "screenshot.png");
  const blocksPath = path.join(dir, "blocks.json");

  if (!fs.existsSync(screenshot)) {
    // Screenshots are gitignored, so a clone has fixtures but no images. That's
    // expected, not an error.
    return {
      status: "skip",
      message: `${slug}: no screenshot.png (skipped)`,
      unserved: true,
    };
  }

  const hasBlocks = fs.existsSync(blocksPath);
  if (mode === "generate" && hasBlocks && !overwrite) {
    return {
      status: "skip",
      message: `${slug}: blocks.json exists (use --overwrite to regenerate)`,
    };
  }
  // A device capture is authoritative, so `--overwrite` alone does not replace
  // one. Without this the stamp was written and never read: one
  // `--overwrite` turned every committed fixture into macOS output, and then
  // `--check` reported 17/17 agreement because it was comparing macOS to macOS.
  //
  // A human-verified sample is protected the same way, whatever produced its
  // fixture. Today every committed fixture is a device capture so the two
  // questions have the same answer, but the README's own "add a sample" flow
  // (`eval:ocr:vision` → label → verify) mints macOS-sourced fixtures: the
  // first of those to enter VERIFIED_SAMPLES would have been re-recorded by a
  // bare `--overwrite`, changing the very input `golden.test.ts` hard-asserts
  // its gold against.
  if (mode === "generate" && hasBlocks && overwrite && !force) {
    // Guarded like the check path below, and for the same reason: unguarded,
    // one malformed committed fixture rejected out of the concurrency pool and
    // took the whole batch with it, writing nothing for any other sample.
    let committed: OcrBlocksFixture;
    try {
      committed = loadFixture(slug);
    } catch (error) {
      const message = errorMessage(error);
      return { status: "fail", message: `${slug}: ${message}` };
    }
    if (isDeviceCapture(committed) || isVerifiedSample(slug)) {
      return {
        status: "skip",
        message: `${slug}: ${
          isDeviceCapture(committed)
            ? "device capture"
            : "human-verified sample"
        }, not overwritten (use --force)`,
      };
    }
  }
  if (mode === "check" && !hasBlocks) {
    return {
      status: "skip",
      message: `${slug}: no blocks.json to check`,
      unserved: true,
    };
  }

  let generated: OcrBlocksFixture;
  try {
    generated = await recognizeImage(binary, screenshot);
  } catch (error) {
    const message = errorMessage(error);
    return {
      status: "fail",
      message: `${slug}: vision failed — ${message}`,
      unserved: true,
    };
  }

  if (mode === "check") {
    // Guarded like the Vision call above: a malformed committed fixture is one
    // sample's problem, not the batch's. Unguarded it rejected out of the pool
    // and discarded every verdict already computed.
    let committed: OcrBlocksFixture;
    try {
      committed = loadFixture(slug);
    } catch (error) {
      const message = errorMessage(error);
      return {
        status: "fail",
        message: `${slug}: ${message}`,
        unreadable: true,
      };
    }
    // Comparing macOS output against a macOS-generated fixture proves nothing,
    // and reporting it as agreement is worse than not checking: it reads as
    // "the device path and this one agree" when no device path was involved.
    if (!isDeviceCapture(committed)) {
      return {
        status: "skip",
        message: `${slug}: fixture is macOS-generated — nothing to check against`,
      };
    }
    const text = textAgreement(committed, generated);
    // Guarded like `loadFixture` above: a fixture can satisfy the schema and
    // still trip a rule, and an unguarded throw here rejected out of the
    // concurrency pool and discarded every verdict already computed.
    let parsed: ReturnType<typeof parseAgreement>;
    try {
      parsed = parseAgreement(committed, generated);
    } catch (error) {
      const message = errorMessage(error);
      return {
        status: "fail",
        message: `${slug}: could not be replayed — ${message}`,
        unreadable: true,
      };
    }
    const shape =
      `blocks ${committed.blocks.length}→${generated.blocks.length}, ` +
      `text ${text}`;

    if (parsed.same) {
      return { status: "ok", message: `${slug}: same accounts (${shape})` };
    }
    return {
      status: "fail",
      message: [
        `${slug}: PARSES DIFFERENTLY (${shape})`,
        `   · device:  ${parsed.committed}`,
        `   · macOS:   ${parsed.generated}`,
      ].join("\n"),
    };
  }

  fs.writeFileSync(
    blocksPath,
    JSON.stringify(generated, null, 2) + "\n",
    "utf8",
  );
  return {
    status: "ok",
    message: `${slug}: wrote blocks.json (${generated.blocks.length} blocks)`,
  };
}

// Samples to process: every directory with a screenshot, which — unlike
// `resolveSampleTargets` — includes ones that have no blocks.json yet, since
// generating that file is the whole point.
function resolveTargets(args: string[]): string[] {
  const onlySlug = parseSampleFlag(args);
  if (onlySlug) {
    return [onlySlug];
  }
  const withScreenshot = listSampleSlugs("screenshot.png");
  // Fall back to the blocks-based listing so "no screenshots at all" reports
  // the sample set rather than silently doing nothing.
  return withScreenshot.length > 0 ? withScreenshot : listSampleSlugs();
}

async function main() {
  const args = process.argv.slice(2);
  const mode: Mode = args.includes("--check") ? "check" : "generate";
  const overwrite = args.includes("--overwrite");
  const force = args.includes("--force");
  const slugs = resolveTargets(args);
  const binary = ensureVisionBinary();

  console.log(
    `Apple Vision (macOS) — ${mode} over ${slugs.length} sample(s)\n` +
      "──────────────────────────────────────────────",
  );

  // Results are collected in slug order and printed after the batch, so the
  // output stays deterministic even though the samples run out of order.
  const results = await mapWithConcurrency(slugs, os.cpus().length, (slug) =>
    processSample(slug, binary, mode, overwrite, force),
  );

  const marks = { ok: "✓", skip: "·", fail: "✗" } as const;
  let failures = 0;
  let compared = 0;
  for (const result of results) {
    if (result.status === "fail") {
      failures += 1;
    }
    if (result.status !== "skip") {
      compared += 1;
    }
    console.log(`${marks[result.status]} ${result.message}`);
  }

  if (mode === "check") {
    console.log(
      `\n──────────────────────────────────────────────\n` +
        `same accounts on both engines: ${compared - failures}/${compared}`,
    );
    if (failures > 0) {
      console.log(
        "\nA divergence is not automatically a bug in either fixture — macOS and\n" +
          "iOS ship different Vision versions. It does mean the rule engine's\n" +
          "answer depends on OCR detail that isn't stable across engine versions,\n" +
          "which is worth hardening. The device fixture stays authoritative.",
      );
      // Informational, not a gate: the drift is a known property of running two
      // Vision versions, so failing the command would just train people to
      // ignore it. `pnpm eval:ocr` is the gate.
    }
    // A bridge that could not run at all IS a gate. Reported the same way as a
    // divergence, it printed "same accounts on both engines: 0/17" and exited
    // 0 — so a chained `--check && …` proceeded as if drift had been verified
    // on a machine where nothing was checked.
    const brokenBridge = results.filter(
      (r) => r.unserved && r.status === "fail",
    );
    if (brokenBridge.length > 0) {
      console.error(
        `\n✗ ${brokenBridge.length} sample(s) could not be recognized at all — ` +
          "the Vision bridge failed, so nothing was compared.",
      );
      process.exit(1);
    }
    // A committed fixture that will not parse is the same class of problem, and
    // it does not reach `brokenBridge` because the bridge ran fine.
    const unreadable = results.filter((r) => r.unreadable);
    if (unreadable.length > 0) {
      console.error(
        `\n✗ ${unreadable.length} committed fixture(s) could not be read.`,
      );
      process.exit(1);
    }
    // A run that compared nothing is not a clean check, named sample or not.
    // It prints "same accounts on both engines: 0/0" and would otherwise exit 0
    // — so a chained `--check && …` proceeds as if device-vs-macOS drift had
    // been verified on a corpus where nothing was compared. Reachable for the
    // whole batch too, once every committed fixture is macOS-generated.
    if (compared === 0) {
      console.error(
        "\n✗ nothing was checked (no screenshot.png, no blocks.json, or every " +
          "committed fixture is macOS-generated).",
      );
      process.exit(1);
    }
    return;
  }

  // Generating IS gated. A `fail` here is the bridge not running at all —
  // swiftc missing, an unreadable PNG, a Vision error — not a difference of
  // opinion between two OCR engines. Exiting 0 on those let a scripted
  // `pnpm eval:ocr:vision && pnpm eval:ocr` march on as if every fixture had
  // been written when none had.
  if (failures > 0) {
    console.error(
      `\n✗ ${failures} of ${compared} sample(s) failed to generate.`,
    );
    process.exit(1);
  }
  // An explicitly named sample whose request could not be served is a failure,
  // not a quiet success — otherwise `pnpm eval:ocr:vision -- --sample <typo> &&
  // pnpm eval:ocr` marches on as if the fixture had been written.
  //
  // "The fixture already exists" is NOT that: it is the command finding nothing
  // to do, which is the common case on a repo that already has its fixtures.
  // Treating it as unserved made a benign no-op exit 1 while printing that no
  // screenshot was found — contradicting the line above it, which said the
  // fixture was there.
  const unserved = results.filter((result) => result.unserved).length;
  if (unserved > 0 && compared === 0) {
    const message = `no fixture was generated (no screenshot.png for ${unserved} target(s)).`;
    if (parseSampleFlag(args)) {
      console.error(`\n✗ ${message}`);
      process.exit(1);
    }
    console.log(`\n· ${message}`);
  }
}

main().catch((error: unknown) => {
  console.error(errorMessage(error));
  process.exit(1);
});
