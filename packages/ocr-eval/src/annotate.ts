// LLM-driven annotation helper for the OCR regression harness (`packages/ocr-eval`).
//
// Manually writing a `samples/<slug>/expected.json` per screenshot is the slow
// step in growing the fixture set. This CLI lets a configured model do the
// first pass: it reads the recorded `blocks.json` (the same normalized 0..1
// shape `run-eval.ts` replays), adds the matching `samples/<slug>/screenshot.png`
// when present (multimodal: the model can check the layout against the text),
// and writes a zod-validated `RecognizedAccount[]` back to `expected.json`.
//
// The model output is validated with the same zod schema the app would accept,
// so a malformed response fails with a clear error instead of a hand-edited
// fixture that later breaks the harness. `pnpm run-eval.ts --sample <slug>`
// still decides pass/fail; this just removes the manual-typing bottleneck.
//
// Env (OpenAI-compatible, no code changes / no committed keys): see `llm.ts`
// (OPENAI_BASE_URL / OPENAI_API_KEY / OPENAI_MODEL). Real env wins over a
// repo-root `.env` file (not committed).
//
// Usage: pnpm --filter @whole/ocr-eval run annotate [--sample <slug>]
//   (or `pnpm eval:ocr:label -- --sample <slug>` from the repo root)
//   without --sample, annotates every sample that has a blocks.json.
import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";

import {
  loadFixtureBlocks,
  resolveSampleTargets,
  recognizedAccountSchema,
  samplesDir,
} from "./paths";
import { callModel, resolveLlmConfig, type ChatMessageContent } from "./llm";

// The model is allowed to omit fields it can't be confident about, mirroring
// how the app treats recognition, so the annotator's schema is the shared
// `recognizedAccountSchema` with a trimmed `accountName` and a strict object
// (rejecting unknown keys the model invents). `kind` defaults to "cash" like
// the app.
const accountSchema = recognizedAccountSchema
  .extend({
    accountName: z.string().trim().optional(),
  })
  .strict();

const accountsSchema = z.array(accountSchema);

// Builds the model input: the normalized OCR blocks as a compact array (the
// harness replays these), optionally plus the base64 screenshot if it exists.
// The model is told the blocks are normalized 0..1 with origin top-left — the
// same convention `normalizeOcrResult` produces — so it can reason about the
// layout even without the image.
function buildUserContent(slug: string): {
  role: "user";
  content: ChatMessageContent;
} {
  const blocks = loadFixtureBlocks(slug);
  const compactBlocks = blocks.map((b) => ({
    text: b.text,
    box: {
      x: Number(b.box.x.toFixed(4)),
      y: Number(b.box.y.toFixed(4)),
      w: Number(b.box.width.toFixed(4)),
      h: Number(b.box.height.toFixed(4)),
    },
  }));
  const prompt =
    "Here is an account screenshot's OCR text blocks (normalized 0..1, " +
    "origin top-left, x/y top-left, w/h = width/height):\n" +
    JSON.stringify(compactBlocks, null, 2) +
    "\n\nExpected output: a JSON array of accounts, each with optional fields: " +
    "accountName (string), accountLastFourDigits (4-digit string), balances " +
    "(array of {currency: 3-letter, balance: number}), kind (" +
    '"cash" | "investment" | "crypto", default "cash").\n' +
    "Use only the screenshot and blocks. Omit any field you are not confident about. " +
    "Respond with ONLY the JSON array, no prose.";

  const imagePath = path.join(samplesDir, slug, "screenshot.png");
  // Some OpenAI-compatible endpoints (e.g. an LM Studio server running a
  // text-only model) hang indefinitely on image_url inputs. `OCR_EVAL_NO_IMAGE`
  // opts out of sending the screenshot — the harness still recovers the JSON
  // from the normalized blocks via `extractJson`, at a small accuracy cost.
  const noImage = !!process.env.OCR_EVAL_NO_IMAGE;
  if (!fs.existsSync(imagePath) || noImage) {
    return { role: "user", content: prompt };
  }
  const base64 = fs.readFileSync(imagePath).toString("base64");
  return {
    role: "user",
    content: [
      { type: "text", text: prompt },
      // Multimodal: include the raw image so the model can see layout.
      {
        type: "image_url",
        image_url: { url: `data:image/png;base64,${base64}` },
      },
    ],
  };
}

// Extracts the JSON array from the model's reply, which may be wrapped in
// markdown fences or have stray prose.
function extractJson(content: string): string {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    return fenced[1].trim();
  }
  const start = content.indexOf("[");
  const end = content.lastIndexOf("]");
  if (start !== -1 && end > start) {
    return content.slice(start, end + 1);
  }
  return content.trim();
}

async function annotateSample(
  slug: string,
  config: ReturnType<typeof resolveLlmConfig>,
): Promise<void> {
  try {
    const input = buildUserContent(slug);
    const response = await callModel(input, config, true);
    const parsed = accountsSchema.parse(JSON.parse(extractJson(response)));
    const dir = path.join(samplesDir, slug);
    const target = path.join(dir, "expected.json");
    // Preserve a previous expected.json so a bad annotation is recoverable.
    if (fs.existsSync(target)) {
      fs.copyFileSync(target, `${target}.bak`);
    }
    fs.writeFileSync(target, JSON.stringify(parsed, null, 2) + "\n", "utf8");
    console.log(
      `✓ ${slug}: wrote ${parsed.length} account(s) to expected.json`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`✗ ${slug}: annotation failed — ${message}`);
  }
}

async function main() {
  const config = resolveLlmConfig();
  const slugs = resolveSampleTargets(process.argv.slice(2));
  console.log(
    `Annotating ${slugs.length} sample(s) with ${config.model}@${config.baseUrl} …`,
  );
  for (const slug of slugs) {
    await annotateSample(slug, config);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
