// `pnpm eval:ocr:synth` — regenerates the synthetic corpus from its specs.
//
// Each spec in `src/synthetic/corpus.ts` produces one screen and one gold:
//
//   spec → HTML → (headless Chrome) screen.png → (Apple Vision) blocks.json
//        → expected.json
//
// The Vision step is the same bridge the real corpus records through, so what
// lands in `blocks.json` is a genuine OCR reading — real token splits, real box
// geometry, real misreadings — of a screen that was built rather than captured.
// That is the whole trick: the layout is synthetic, the OCR is not, and a
// hand-authored fixture (typing out what OCR "would" produce) would have been
// neither.
//
// The gold is derived from the same spec by `goldFor`, so it cannot be a
// misreading of the screen. It can still be WRONG — if a template renders
// something the spec did not mean, the gold describes the spec and the screen
// says something else — which is why `--diff` prints what the engine currently
// reads beside it, and why a new spec is eyeballed against its `screen.png`
// once before its baseline is recorded.
//
//   pnpm eval:ocr:synth                     # regenerate every sample
//   pnpm eval:ocr:synth -- --sample <slug>  # just one
//   pnpm eval:ocr:synth -- --diff           # …and print what the engine reads
//
// macOS only: it drives Apple Vision through the Swift bridge and takes the
// screenshot with the system's Chrome.
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";

import { parseOcrBlocks, blocksFromFixture } from "@whole/ocr";

import {
  corpusName,
  errorMessage,
  mapWithConcurrency,
  parseSampleFlag,
  samplesDir,
} from "./paths";
import { goldFor, type ScreenSpec } from "./synthetic/spec";
import { SYNTHETIC_SPECS, specBySlug } from "./synthetic/corpus";
import { renderScreen, VIEWPORT } from "./synthetic/templates";
import { ensureVisionBinary, recognizeImage } from "./vision-bridge";

const execFileAsync = promisify(execFile);

// Where the headless browser lives. Overridable because the only thing this
// needs is a Chromium that takes `--screenshot`, and a machine may have it
// somewhere else (a Playwright download, a Homebrew Chromium) or not at all.
const CHROME =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/**
 * Renders one spec to a PNG.
 *
 * The device scale factor is what makes the fixture worth recording: Vision
 * reads a 1× render as soft, low-contrast glyphs and mis-splits tokens that a
 * phone's 3× display presents cleanly, so a 1× fixture would measure the
 * renderer rather than the engine.
 */
async function screenshot(spec: ScreenSpec, dir: string): Promise<string> {
  const htmlPath = path.join(dir, "screen.html");
  const pngPath = path.join(dir, "screen.png");
  fs.writeFileSync(htmlPath, renderScreen(spec), "utf8");
  await execFileAsync(
    CHROME,
    [
      "--headless",
      "--disable-gpu",
      "--hide-scrollbars",
      `--screenshot=${pngPath}`,
      `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
      `--force-device-scale-factor=${VIEWPORT.scale}`,
      htmlPath,
    ],
    // Chrome writes progress and GPU warnings to stderr on every run and exits
    // 0 regardless, so the output is discarded and the PNG's existence is what
    // the caller checks.
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  ).catch(() => undefined);
  if (!fs.existsSync(pngPath)) {
    throw new Error(
      `headless Chrome produced no screenshot (looked for ${CHROME}; set CHROME_PATH to override)`,
    );
  }
  return pngPath;
}

type Generated = {
  slug: string;
  blocks: number;
  accounts: number;
  gold: number;
  error?: string;
};

async function generate(
  spec: ScreenSpec,
  binary: string,
  diff: boolean,
): Promise<Generated> {
  const dir = path.join(samplesDir, spec.slug);
  fs.mkdirSync(dir, { recursive: true });
  try {
    const png = await screenshot(spec, dir);
    const fixture = await recognizeImage(binary, png);
    fs.writeFileSync(
      path.join(dir, "blocks.json"),
      JSON.stringify(fixture, null, 2) + "\n",
      "utf8",
    );
    const gold = goldFor(spec);
    fs.writeFileSync(
      path.join(dir, "expected.json"),
      JSON.stringify(gold, null, 2) + "\n",
      "utf8",
    );
    const read = parseOcrBlocks(blocksFromFixture(fixture));
    if (diff) {
      console.log(`\n── ${spec.slug} (${spec.market}, ${spec.layout})`);
      console.log(`   gold   ${gold.length} account(s)`);
      for (const account of gold) {
        console.log(`     · ${describe(account)}`);
      }
      console.log(`   engine ${read.length} account(s)`);
      for (const account of read) {
        console.log(`     · ${describe(account)}`);
      }
    }
    return {
      slug: spec.slug,
      blocks: fixture.blocks.length,
      accounts: read.length,
      gold: gold.length,
    };
  } catch (error) {
    return {
      slug: spec.slug,
      blocks: 0,
      accounts: 0,
      gold: 0,
      error: errorMessage(error),
    };
  }
}

function describe(account: {
  accountName?: string;
  accountLastFourDigits?: string;
  balances?: { currency: string; balance: number }[];
}): string {
  const tail = account.accountLastFourDigits
    ? ` ····${account.accountLastFourDigits}`
    : "";
  const money = (account.balances ?? [])
    .map((balance) => `${balance.currency} ${balance.balance.toFixed(2)}`)
    .join(", ");
  return `${account.accountName ?? "(unnamed)"}${tail}${money ? ` — ${money}` : ""}`;
}

async function main(): Promise<void> {
  // `samplesDir` is chosen by `OCR_CORPUS`, and an unset value means the REAL
  // corpus — a sane default for every reader in the package, and a destructive
  // one for the single CLI that WRITES. Run without the env var (a debugger
  // launch, `pnpm --filter @whole/ocr-eval exec tsx src/run-synth.ts`, a typo)
  // this would have written twelve generated screens into `samples/`, where
  // `pnpm eval:ocr` discovers them and folds them into the gate the README
  // reports as a measurement over real device captures. There is no corpus this
  // script can legitimately target but the synthetic one, so it says so.
  if (corpusName !== "synthetic") {
    throw new Error(
      "run-synth writes the synthetic corpus only — run it as `pnpm eval:ocr:synth` (it sets OCR_CORPUS=synthetic).",
    );
  }
  const args = process.argv.slice(2);
  const onlySlug = parseSampleFlag(args);
  const diff = args.includes("--diff");
  const only = onlySlug ? specBySlug(onlySlug) : undefined;
  if (onlySlug && only === undefined) {
    console.error(`No spec named "${onlySlug}" (see src/synthetic/corpus.ts).`);
    process.exit(1);
  }
  const specs = only ? [only] : [...SYNTHETIC_SPECS];
  if (specs.length === 0) {
    console.error("No specs to generate.");
    process.exit(1);
  }

  const binary = ensureVisionBinary();
  // Two at a time: each sample spends its time in two subprocesses (Chrome,
  // then Vision) and a serial loop idles, but a browser per spec all at once
  // is a lot of memory for no gain.
  const results = await mapWithConcurrency(specs, 2, (spec) =>
    generate(spec, binary, diff),
  );

  console.log("");
  for (const result of results) {
    if (result.error) {
      console.log(`✗ ${result.slug} — ${result.error}`);
      continue;
    }
    const verdict = result.accounts === result.gold ? "✓" : "~";
    console.log(
      `${verdict} ${result.slug} — ${result.blocks} blocks, gold ${result.gold}, engine reads ${result.accounts}`,
    );
  }
  const failed = results.filter((result) => result.error).length;
  console.log(
    `\n${results.length - failed}/${results.length} generated into synthetic-samples/.`,
  );
  console.log(
    "Next: eyeball each screen.png against its expected.json, then `pnpm eval:ocr:synth:baseline`.",
  );
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error(errorMessage(error));
  process.exit(1);
});
