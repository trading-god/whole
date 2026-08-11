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
// Env (OpenAI-compatible, no code changes / no committed keys):
//   OPENAI_BASE_URL   default https://api.openai.com/v1
//   OPENAI_API_KEY    required (comma-safe; error if unset)
//   OPENAI_MODEL      default gpt-4o (keep to a vision-capable model when image
//                     is provided; text-only models still get the blocks)
//
// Config can come from exported environment variables OR a repo-root `.env`
// file (KEY=VALUE lines; real env wins over `.env`). See the `.gitignore` note
// — `.env` is not committed.
//
// Usage: pnpm --filter @whole/ocr-eval run annotate [--sample <slug>]
//   (or `pnpm eval:ocr:label -- --sample <slug>` from the repo root)
//   without --sample, annotates every sample that has a blocks.json.
import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";

import {
  assetKindSchema,
  lastFourDigitsSchema,
} from "@/features/assets/account-appearance";
import { accountBalanceSchema } from "@/features/assets/account-balance-schema";
import {
  blocksFixtureSchema,
  listSampleSlugs,
  packageRoot,
  parseSampleFlag,
  samplesDir,
} from "./paths";

// Accepted fields of a `RecognizedAccount`, for the LLM to fill. All optional:
// the model is allowed to omit fields it can't be confident about, mirroring
// how the app treats recognition. `kind` defaults to "cash" like the app. The
// field schemas are the same pure zod schemas the app's parser validates
// against (`lastFourDigitsSchema`, `accountBalanceSchema`, `assetKindSchema`),
// so a model response and a parser output can't disagree on what a valid
// account looks like.
const accountSchema = z
  .object({
    accountName: z.string().trim().optional(),
    accountLastFourDigits: lastFourDigitsSchema.optional(),
    balances: z.array(accountBalanceSchema).optional(),
    kind: assetKindSchema.optional(),
  })
  .strict();

const accountsSchema = z.array(accountSchema);

// OpenAI-compatible chat message content: plain text, or a multimodal array of
// text and image_url parts. Typed (not `any[]`) so the content array built in
// `buildUserContent` is checked.
type ChatMessageContent =
  | string
  | (
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    )[];

function loadBlocks(slug: string) {
  const raw: unknown = JSON.parse(
    fs.readFileSync(path.join(samplesDir, slug, "blocks.json"), "utf8"),
  );
  return blocksFixtureSchema.parse(raw).blocks;
}

// Builds the model input: the normalized OCR blocks as a compact array (the
// harness replays these), optionally plus the base64 screenshot if it exists.
// The model is told the blocks are normalized 0..1 with origin top-left — the
// same convention `normalizeOcrResult` produces — so it can reason about the
// layout even without the image.
function buildUserContent(slug: string): {
  role: "user";
  content: ChatMessageContent;
} {
  const blocks = loadBlocks(slug);
  const compactBlocks = blocks.map((b) => ({
    text: b.text,
    box: {
      x: Number(b.box.x.toFixed(4)),
      y: Number(b.box.y.toFixed(4)),
      w: Number(b.box.width.toFixed(4)),
      h: Number(b.box.height.toFixed(4)),
    },
  }));
  const imagePath = path.join(samplesDir, slug, "screenshot.png");
  if (fs.existsSync(imagePath)) {
    const base64 = fs.readFileSync(imagePath).toString("base64");
    const mime = "image/png";
    return {
      role: "user",
      content: [
        {
          type: "text",
          text:
            "Here is an account screenshot's OCR text blocks (normalized 0..1, origin top-left, " +
            `x/y = center? no, x/y top-left, w/h = width/height):\n${JSON.stringify(compactBlocks, null, 2)}` +
            "\n\nExpected output: a JSON array of accounts, each with optional fields: " +
            "accountName (string), accountLastFourDigits (4-digit string), " +
            "balances (array of {currency: 3-letter, balance: number}), kind (" +
            '"cash" | "investment" | "crypto", default "cash").\n' +
            "Use only the screenshot and blocks. Omit any field you are not confident about. " +
            "Respond with ONLY the JSON array, no prose.",
        },
        // standard multimodal: include the raw image so the model can see layout
        {
          type: "image_url",
          image_url: { url: `data:${mime};base64,${base64}` },
        },
      ],
    };
  }
  return {
    role: "user",
    content:
      "Here is an account screenshot's OCR text blocks (normalized 0..1, origin top-left, " +
      "x/y top-left, w/h = width/height):\n" +
      JSON.stringify(compactBlocks, null, 2) +
      "\n\nExpected output: a JSON array of accounts, each with optional fields: " +
      "accountName (string), accountLastFourDigits (4-digit string), balances " +
      "(array of {currency: 3-letter, balance: number}), kind (" +
      '"cash" | "investment" | "crypto", default "cash").\n' +
      "Use only these text blocks. Omit any field you are not confident about. " +
      "Respond with ONLY the JSON array, no prose.",
  };
}

async function callModel(
  input: { role: "user"; content: ChatMessageContent },
  apiKey: string,
  baseUrl: string,
  model: string,
): Promise<string> {
  const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [input],
      temperature: 0,
      // Some OpenAI-compatible endpoints don't support response_format; request
      // it but don't hard-fail — the model usually returns pure JSON anyway.
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    throw new Error(`LLM request failed (${res.status}): ${body}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("LLM returned no content");
  }
  return content;
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
  apiKey: string,
  baseUrl: string,
  model: string,
): Promise<void> {
  try {
    const input = buildUserContent(slug);
    const response = await callModel(input, apiKey, baseUrl, model);
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

// Loads a minimal `KEY=VALUE` `.env` file from the repository root
// (`../../.env` relative to this file). Only fills variables that are NOT
// already set in the process environment — real exported env wins, matching
// conventional dotenv precedence. Kept parser simple (no comments/quoting/
// interpolation) since the file holds up to three flat values; unreadable or
// missing file is not an error. Values are not exported to `process.env` so
// anything this CLI doesn't own stays untouched.
function loadRepoEnv(): Record<string, string> {
  const envPath = path.resolve(packageRoot, "../../.env");
  let text: string;
  try {
    text = fs.readFileSync(envPath, "utf8");
  } catch {
    return {};
  }
  const loaded: Record<string, string> = {};
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const eq = line.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) {
      loaded[key] = value;
    }
  }
  return loaded;
}

const env = loadRepoEnv();

async function main() {
  const apiKey = process.env.OPENAI_API_KEY ?? env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("OPENAI_API_KEY is required. Set it before running, e.g.");
    console.error(
      "  OPENAI_API_KEY=... OPENAI_BASE_URL=... OPENAI_MODEL=... pnpm eval:ocr:label",
    );
    console.error(
      "  … or add the three OPENAI_* variables to the repo-root .env file.",
    );
    process.exit(1);
  }
  const baseUrl =
    process.env.OPENAI_BASE_URL ??
    env.OPENAI_BASE_URL ??
    "https://api.openai.com/v1";
  const model = process.env.OPENAI_MODEL ?? env.OPENAI_MODEL ?? "gpt-4o";

  const args = process.argv.slice(2);
  const onlySlug = parseSampleFlag(args);
  const slugs = onlySlug ? [onlySlug] : listSampleSlugs();
  if (slugs.length === 0) {
    console.error(
      "No samples found (create samples/<slug>/blocks.json first).",
    );
    process.exit(1);
  }
  console.log(
    `Annotating ${slugs.length} sample(s) with ${model}@${baseUrl} …`,
  );
  for (const slug of slugs) {
    await annotateSample(slug, apiKey, baseUrl, model);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
