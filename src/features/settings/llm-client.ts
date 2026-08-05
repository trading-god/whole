import OpenAI, { APIError } from "openai";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";

import {
  type LlmConfig,
  normalizeBaseUrl,
} from "@/features/settings/llm-config-store";
import {
  isJsonModeUnsupported,
  rememberJsonModeUnsupported,
} from "@/features/settings/llm-json-mode";

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
    baseURL: normalizeBaseUrl(config.baseUrl),
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
// The statuses an endpoint returns when it refuses the request *as written* —
// which is what an endpoint without JSON-mode support does with
// `response_format`. Retrying the same request minus `response_format` then
// costs one rejected round-trip (no tokens are generated) and only on
// endpoints that would otherwise be unusable.
//
// Deliberately an allow-list of 400/422 rather than "any 4xx": the conclusion
// drawn from a match is recorded permanently (rememberJsonModeUnsupported), so
// a status that merely means "not now" must never reach it. A 429 or 408
// retried a moment later usually succeeds, which under a broad rule would
// silently pin the endpoint as JSON-mode-incapable for good — costing every
// later recognition the formatting guarantee, with no way to undo it short of
// clearing app storage. 401/403/404 are excluded for the same reason from the
// other direction: a misconfigured endpoint should report its real problem
// instead of being probed twice.
const REQUEST_REJECTED_STATUSES = [400, 422];

function isRequestRejected(error: unknown): boolean {
  return (
    error instanceof APIError &&
    typeof error.status === "number" &&
    REQUEST_REJECTED_STATUSES.includes(error.status)
  );
}

// One chat request: sends it and returns the model's text, or "" when the
// response carried none (a thinking model can spend its whole budget on
// reasoning). Throws the SDK's own error untouched, so `isRequestRejected` can
// still inspect its status — the callers below decide when to normalize it.
async function requestContent(
  client: OpenAI,
  request: ChatCompletionCreateParamsNonStreaming,
): Promise<string> {
  const completion = await client.chat.completions.create(request);
  return completion.choices[0]?.message?.content ?? "";
}

export async function callVisionModel(
  config: LlmConfig,
  prompt: string,
  imageBase64: string,
): Promise<string> {
  const client = createOpenAIClient(config, VISION_TIMEOUT_MS);
  const request = {
    model: config.model,
    messages: [
      {
        role: "user" as const,
        content: [
          { type: "text" as const, text: prompt },
          {
            type: "image_url" as const,
            image_url: { url: `data:image/jpeg;base64,${imageBase64}` },
          },
        ],
      },
    ],
  };

  // JSON mode keeps the model from wrapping its answer in a markdown fence or
  // prefacing it with prose — the two failure modes `stripCodeFence` and the
  // parser's degrade-to-empty path exist to absorb. Deliberately JSON mode and
  // not a strict `json_schema`: schemas constrain shape, and the recognition
  // errors that actually occur are semantic (a sub-account read as its own
  // account, same-currency balances left unsummed), which no schema catches.
  // Strict grammars also carry real cost here — they demand every property be
  // required with `["string","null"]` unions, which thin proxies handle
  // unevenly, and they constrain decoding from the first token, which fights
  // the thinking models this app targets (see VISION_TIMEOUT_MS). JSON mode
  // buys the formatting win without either.
  const skipJsonMode = await isJsonModeUnsupported(config);

  // The request without `response_format`, with SDK errors normalized to a
  // plain Error carrying a display-ready message — the contract
  // testLlmConnection documents, so callers never import the SDK. Both the
  // known-unsupported path and the post-rejection retry send exactly this.
  const sendPlainRequest = async (): Promise<string> => {
    try {
      return await requestContent(client, request);
    } catch (error) {
      throw new Error(describeLlmError(error));
    }
  };

  if (skipJsonMode) {
    return sendPlainRequest();
  }

  try {
    return await requestContent(client, {
      ...request,
      response_format: { type: "json_object" },
    });
  } catch (error) {
    if (!isRequestRejected(error)) {
      throw new Error(describeLlmError(error));
    }

    // Retry without `response_format`. When this succeeds, `response_format`
    // was the reason for the rejection and the endpoint is recorded so later
    // recognitions skip the probe. When it fails too, the rejection was about
    // something else, so nothing is recorded and the retry's error — raised by
    // the plainer request — is the one worth showing.
    const content = await sendPlainRequest();
    await rememberJsonModeUnsupported(config);
    return content;
  }
}
