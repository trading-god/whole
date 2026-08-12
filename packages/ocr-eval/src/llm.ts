// Shared OpenAI-compatible LLM plumbing for the eval package: env resolution
// (real env wins over repo-root `.env`) and a minimal chat-completions call.
// Used by both the annotator (`annotate.ts`) and the diagnosis tool
// (`teach.ts`) so the request format and credential handling can't drift.
import * as fs from "node:fs";
import * as path from "node:path";

import { packageRoot } from "./paths";

// OpenAI-compatible chat message content: plain text, or a multimodal array of
// text and image_url parts. Typed (not `any[]`) so the content array built by
// each tool is checked.
export type ChatMessageContent =
  | string
  | (
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    )[];

export type LlmConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
};

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
    // Empty values (e.g. a `.env` template that declares `OPENAI_MODEL=` as a
    // placeholder) are treated as absent — a blank override must not shadow a
    // real default (like "gpt-4o") with "".
    if (key && value) {
      loaded[key] = value;
    }
  }
  return loaded;
}

// Resolves the effective LLM config from exported env vars, then a repo-root
// `.env`. Throws a clear error when the API key is missing so both tools fail
// with guidance instead of an opaque fetch error.
export function resolveLlmConfig(): LlmConfig {
  const env = loadRepoEnv();
  const apiKey = process.env.OPENAI_API_KEY ?? env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is required. Set it before running, e.g.\n" +
        "  OPENAI_API_KEY=... OPENAI_BASE_URL=... OPENAI_MODEL=... pnpm eval:ocr:teach\n" +
        "  … or add the three OPENAI_* variables to the repo-root .env file.",
    );
  }
  return {
    apiKey,
    baseUrl:
      process.env.OPENAI_BASE_URL ??
      env.OPENAI_BASE_URL ??
      "https://api.openai.com/v1",
    model: process.env.OPENAI_MODEL ?? env.OPENAI_MODEL ?? "gpt-4o",
  };
}

// Calls the chat-completions endpoint and returns the model's text reply.
// `jsonMode` requests `response_format: { type: "json_object" }` for callers
// that want a strict JSON reply (`annotate.ts`); callers that want free-form
// text like a markdown report (`teach.ts`) omit it. Some OpenAI-compatible
// endpoints don't support `response_format`, so even when requested this
// doesn't hard-fail — `annotate.ts`'s `extractJson` still recovers the JSON
// from a fenced/raw reply.
export async function callModel(
  input: { role: "user"; content: ChatMessageContent },
  config: LlmConfig,
  jsonMode = false,
): Promise<string> {
  const res = await fetch(
    `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [input],
        temperature: 0,
        ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
    },
  );
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
