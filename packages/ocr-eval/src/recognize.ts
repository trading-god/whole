// `pnpm ocr` — run the full recognition pipeline and print what the engine
// sees, over either a loose image file or a committed regression sample.
//
// This is the shortest loop between "here is a screenshot" and "here is what
// the rules make of it": no device, no dev build, no gold. Point it at a PNG
// and it runs the same two steps the app runs — Apple Vision for the text,
// `@whole/ocr` for the meaning — then prints the recognized accounts.
//
// `--sample <slug>` reads `samples/<slug>/blocks.json` instead, which is the
// mode to use when a sample fails the eval: same output, but replaying the
// exact committed fixture the harness gates on rather than re-recognizing a
// screenshot through a Vision version that may read it differently. It needs no
// screenshot and no Swift bridge, so it is also the only mode that works off
// macOS.
//
// Use it to eyeball a new institution's layout before deciding whether it's
// worth a regression sample, and to iterate on a rule: change the rule, re-run
// this on the screenshot (or the sample) that motivated it, see the difference
// immediately. `--trace` shows the intermediate stages, which is where you look
// when the answer is wrong and you need to know which rule decided it.
//
// Usage:
//   pnpm ocr <image>              # recognized accounts, human-readable
//   pnpm ocr --sample <slug>      # …from a committed fixture instead
//   pnpm ocr <image> --json       # the RecognizedAccount[] the app would get
//   pnpm ocr <image> --trace      # per-line roles and the detected institution
//   pnpm ocr <image> --blocks     # the raw OCR blocks, before any rules
//
// The image mode is macOS only: it drives Apple Vision through the Swift
// bridge. The app's iOS path is the same framework, but the two ship different
// model versions — see the README's note on `--check`.
import * as fs from "node:fs";
import * as path from "node:path";

import {
  blocksFromFixture,
  parseOcrBlocksTraced,
  type OcrBlocksFixture,
  type RecognizedAccount,
} from "@whole/ocr";

import {
  errorMessage,
  invocationDir,
  loadFixture,
  parseSampleFlag,
} from "./paths";
import { ensureVisionBinary, recognizeImage } from "./vision-bridge";

function usage(): never {
  console.error(
    "Usage: pnpm ocr <image> [--json] [--trace] [--blocks]\n" +
      "       pnpm ocr --sample <slug> [--json] [--trace] [--blocks]\n\n" +
      "  <image>   path to a screenshot (PNG/JPEG), recognized via Apple Vision\n" +
      "  --sample  replay a committed samples/<slug>/blocks.json instead\n" +
      "  --json    print the RecognizedAccount[] the app would receive\n" +
      "  --trace   also print per-line roles and the detected institution\n" +
      "  --blocks  also print the raw OCR blocks, before any rules ran\n",
  );
  process.exit(1);
}

// The non-flag arguments, with `--sample`'s value excluded — it is the flag's
// operand, not a positional. Without this the slug in `pnpm ocr --sample ocbc`
// would be picked up as an image path, and the run would fail reporting "no
// such file: ocbc" for an argument the user never meant as one.
function positionalArgs(args: string[]): string[] {
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--sample") {
      i += 1;
      continue;
    }
    if (!args[i].startsWith("--")) {
      positionals.push(args[i]);
    }
  }
  return positionals;
}

// Renders one account the way a person reads it — name first, then the
// identifying details, then a line per currency.
function renderAccount(account: RecognizedAccount, index: number): string {
  const lines: string[] = [];
  const name = account.accountName ?? "(no name recognized)";
  lines.push(`${index + 1}. ${name}`);
  if (account.accountLastFourDigits) {
    lines.push(`   card ····${account.accountLastFourDigits}`);
  }
  lines.push(`   kind        ${account.kind ?? "(none)"}`);
  lines.push(`   institution ${account.institutionId ?? "(none)"}`);
  if (account.balances?.length) {
    for (const balance of account.balances) {
      // Right-align the figure so several currencies read as a column.
      const amount = balance.balance.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      lines.push(`   ${balance.currency}  ${amount.padStart(16)}`);
    }
  } else {
    lines.push("   (no balances recognized)");
  }
  return lines.join("\n");
}

// Resolves the two input modes to one fixture plus the label to print for it.
// `--sample` wins when both are given rather than silently ignoring one: the
// two sources can disagree (that is the whole point of `eval:ocr:vision
// --check`), so guessing which the user meant would report the other one's
// result under the wrong name.
async function loadInput(
  args: string[],
  quiet: boolean,
): Promise<{ fixture: OcrBlocksFixture; label: string }> {
  const slug = parseSampleFlag(args);
  const [imageArg] = positionalArgs(args);

  if (slug) {
    if (imageArg) {
      console.error("✗ pass either an image or --sample <slug>, not both.");
      process.exit(1);
    }
    // Throws (naming the sample) when the fixture is missing or malformed; the
    // top-level catch turns that into the exit code.
    return { fixture: loadFixture(slug), label: `${slug} (recorded fixture)` };
  }

  if (!imageArg) {
    usage();
  }
  // `pnpm --filter` runs the script with the package as cwd, so a relative path
  // has to be resolved against the directory the user actually typed it in.
  //
  // `INIT_CWD` alone is not that directory: the repo-root `ocr` script shells
  // out to a second `pnpm`, which overwrites `INIT_CWD` with the repo root. A
  // relative path then resolved against the root — silently recognizing a
  // same-named file there, or reporting "no such file" for one that exists.
  // The root script forwards the real value as `OCR_INVOCATION_DIR`; `INIT_CWD`
  // remains the fallback for running this package's script directly. See
  // `invocationDir` in paths.ts, which every CLI here shares.
  const imagePath = path.resolve(invocationDir(), imageArg);
  if (!fs.existsSync(imagePath)) {
    console.error(`✗ no such file: ${imagePath}`);
    process.exit(1);
  }
  // In `--json` mode the only thing on stdout must be the JSON, so the compile
  // chatter is suppressed.
  const binary = ensureVisionBinary(quiet);
  return {
    fixture: await recognizeImage(binary, imagePath),
    label: path.basename(imagePath),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes("--json");
  const withTrace = args.includes("--trace");
  const withBlocks = args.includes("--blocks");

  const { fixture, label } = await loadInput(args, asJson);
  const { accounts, trace } = parseOcrBlocksTraced(blocksFromFixture(fixture));

  if (asJson) {
    console.log(JSON.stringify(accounts, null, 2));
    return;
  }

  console.log(`${label} — ${fixture.blocks.length} OCR blocks`);
  console.log("──────────────────────────────────────────────");

  if (withBlocks) {
    console.log("\nOCR blocks (before any rules):");
    for (const block of fixture.blocks) {
      console.log(`  ${block.text}`);
    }
  }

  if (withTrace) {
    console.log(`\ninstitution: ${trace.institutionId}`);
    console.log("\nper-line roles:");
    for (const line of trace.classified) {
      console.log(
        `  #${String(line.index).padStart(2)} ${line.role.padEnd(12)} ${line.text}`,
      );
    }
  }

  console.log(
    accounts.length === 0
      ? "\nNo accounts recognized."
      : `\n${accounts.length} account(s) recognized:\n`,
  );
  console.log(accounts.map(renderAccount).join("\n\n"));
}

main().catch((error: unknown) => {
  console.error(errorMessage(error));
  process.exit(1);
});
