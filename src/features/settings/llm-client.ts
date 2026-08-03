import OpenAI, { APIError } from "openai";

import type { LlmConfig } from "@/features/settings/llm-config-store";

// Constructs the OpenAI-compatible client shared by screenshot recognition and
// the settings connectivity test. Lives in the settings feature because the
// "how to talk to the configured LLM" decision is settings-owned: features that
// consume the LLM depend on settings one-way, instead of settings reaching
// into the assets feature (which would create a settings ↔ assets cycle).
function createOpenAIClient(config: LlmConfig, timeoutMs = 30_000) {
  const apiKey = config.apiKey.trim();
  // The SDK refuses to construct without any credentials. When the user leaves
  // the key blank (e.g. for a local endpoint that doesn't need one), pass a
  // placeholder to satisfy the constructor and explicitly drop the
  // Authorization header so no credential is sent.
  return new OpenAI({
    baseURL: config.baseUrl.replace(/\/+$/, ""),
    apiKey: apiKey || "unused",
    defaultHeaders: apiKey ? undefined : { Authorization: null },
    // The SDK refuses to run outside Node by default to avoid leaking keys.
    // This app intentionally calls the provider directly from the device
    // (personal use; the key is stored in the device keystore).
    dangerouslyAllowBrowser: true,
    // The SDK defaults to a 10-minute timeout with 2 retries, which can leave
    // the test/vision request hanging for ~30 minutes against an unresponsive
    // endpoint. Bound it so the user gets a failure they can act on instead of
    // an indefinite spinner. Vision callers pass a larger budget (see
    // VISION_TIMEOUT_MS) since thinking models generate substantial reasoning
    // before the answer.
    timeout: timeoutMs,
    maxRetries: 1,
  });
}

function describeLlmError(error: unknown): string {
  if (error instanceof APIError) {
    const status = error.status ? `${error.status} ` : "";
    return `${status}${error.message}`.trim();
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

// Sends a minimal chat request to verify the endpoint, key, and model work.
// Throws a plain Error with a normalized, display-ready message on failure so
// the caller can surface `error.message` directly without importing the SDK.
export async function testLlmConnection(config: LlmConfig): Promise<void> {
  const client = createOpenAIClient(config);

  try {
    await client.chat.completions.create({
      model: config.model,
      messages: [{ role: "user", content: "Reply with the single word: ok." }],
    });
  } catch (error) {
    throw new Error(describeLlmError(error));
  }
}

// Vision requests with a thinking model (e.g. Qwen3) generate substantial
// out-of-band reasoning before the answer, and local endpoints are slower per
// token than hosted APIs, so they need a longer timeout than the connectivity
// ping. Give the full token budget room to complete instead of timing out
// mid-generation (which would surface as a recognition failure).
const VISION_TIMEOUT_MS = 120_000;

// Sends a vision (image + text) chat request and returns the model's text
// response. Consolidates the SDK request/response shapes here so feature code
// only supplies a prompt and image, not the OpenAI wire format. No
// `max_completion_tokens` cap is set: thinking models spend most of their
// budget on out-of-band reasoning before emitting the JSON answer, and a fixed
// cap can be consumed entirely by reasoning and leave `content` empty — so the
// model uses its default completion budget.
export async function callVisionModel(
  config: LlmConfig,
  prompt: string,
  imageBase64: string,
): Promise<string> {
  const client = createOpenAIClient(config, VISION_TIMEOUT_MS);

  try {
    const completion = await client.chat.completions.create({
      model: config.model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image_url",
              image_url: { url: `data:image/jpeg;base64,${imageBase64}` },
            },
          ],
        },
      ],
    });

    return completion.choices[0]?.message?.content ?? "";
  } catch (error) {
    // Normalize SDK errors to a plain Error with a display-ready message, so
    // callers can surface `error.message` without importing the SDK — matching
    // the contract testLlmConnection already documents.
    throw new Error(describeLlmError(error));
  }
}
