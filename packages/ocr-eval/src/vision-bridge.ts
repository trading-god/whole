// Runs the macOS Apple Vision bridge (`vision/recognize-text.swift`) and
// returns the fixture it produces.
//
// Split out from `vision.ts` because two commands need it: `vision.ts` writes
// the result to `blocks.json` as a regression fixture, and `recognize.ts` feeds
// it straight to the parser to answer "what does the engine see in this
// image?". Sharing the compile-and-run step keeps them from drifting on which
// binary they invoke or how they parse its output.
import { execFile, execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";

import { blocksFixtureSchema, type OcrBlocksFixture } from "@whole/ocr";

import { packageRoot } from "./paths";

const execFileAsync = promisify(execFile);

const swiftSource = path.join(packageRoot, "vision", "recognize-text.swift");
const buildDir = path.join(packageRoot, "vision", ".build");
const binaryPath = path.join(buildDir, "recognize-text");

// Compiles the Swift bridge once and reuses the binary. `swift file.swift`
// re-compiles on every invocation (~4s), which dominates the runtime over a
// folder of screenshots; a cached binary runs in ~0.4s. Rebuilds whenever the
// source is newer than the binary.
export function ensureVisionBinary(quiet = false): string {
  const sourceMtime = fs.statSync(swiftSource).mtimeMs;
  const binaryMtime = fs.existsSync(binaryPath)
    ? fs.statSync(binaryPath).mtimeMs
    : 0;
  if (binaryMtime > sourceMtime) {
    return binaryPath;
  }
  fs.mkdirSync(buildDir, { recursive: true });
  if (!quiet) {
    console.log("Compiling vision/recognize-text.swift …");
  }
  // Compile to a unique path and rename into place. `rename` is atomic within
  // a filesystem, so two concurrent invocations that both find the binary stale
  // can't have one exec the other's half-written output.
  const stagingPath = `${binaryPath}.${process.pid}`;
  // Cleaned up on failure: a compile that throws — missing Xcode CLT, a syntax
  // error while editing the Swift source, a full disk — otherwise left its
  // partial staging file behind, one per attempt, in a gitignored directory
  // nobody inspects.
  try {
    execFileSync("swiftc", ["-O", "-o", stagingPath, swiftSource], {
      stdio: ["ignore", quiet ? "ignore" : "inherit", "inherit"],
    });
    fs.renameSync(stagingPath, binaryPath);
  } finally {
    fs.rmSync(stagingPath, { force: true });
  }
  return binaryPath;
}

// Recognizes one image, returning the validated fixture (normalized 0..1
// blocks, top-left origin) the parser consumes.
//
// Async because the caller that matters is a batch: Vision spends nearly all of
// each ~0.4s call outside Node, so a serial loop over the sample folder sits
// idle at ~7% CPU. Awaiting a pool of these cuts the folder run several-fold.
export async function recognizeImage(
  binary: string,
  imagePath: string,
): Promise<OcrBlocksFixture> {
  const { stdout } = await execFileAsync(binary, [imagePath], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return blocksFixtureSchema.parse(JSON.parse(stdout));
}
