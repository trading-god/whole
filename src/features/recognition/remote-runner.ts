// The remote `RunModel`: a recognition turn answered by the user's own
// OpenAI-compatible endpoint.
//
// The engine (in `@whole/ocr`) knows only "a model call is a function from an
// attempt to raw text" — this is the cloud twin of `on-device-runner.ts`, with
// the same contract: return the raw answer text and let the engine's parse +
// zod validation judge it (see `recognizeWithModel`; a malformed answer is
// retried with a correction, not treated as a crash).
//
// Structured outputs rather than prompt-begging: the engine's annotation
// schema (`annotationJsonSchema`) rides as `response_format`, so the endpoint
// is constrained to the same shape the local GBNF grammar enforces — a
// provider without the field simply ignores it and the retry loop still
// catches what slips through.
//
// NOT a singleton: unlike the on-device context there is nothing to warm —
// each call is a stateless HTTPS request. The config is loaded per turn, so a
// settings change takes effect on the very next recognition without any
// cache to invalidate.
import {
  ANNOTATION_INFERENCE,
  annotationJsonSchema,
  type RunModel,
} from "@whole/ocr";

import { errorMessage } from "@/features/on-device-model/model-error";
import { RemoteModelError } from "@/features/recognition/remote-model-error";
import { loadRemoteModelConfig } from "@/features/recognition/remote-model-config-store";

// One turn's budget. The local runner has no network to time out; this one
// does, and a hung request would hold the uploader's spinner forever. 90s
// rather than the on-device "under a minute" copy: a cold provider queueing a
// large prompt can legitimately take longer, and the user-facing copy still
// says what to do when it fails.
const REQUEST_TIMEOUT_MS = 90_000;

type ChatCompletionResponse = {
  choices?: { message?: { content?: string } }[];
};

/**
 * Builds the `RunModel` for the configured remote endpoint.
 *
 * Returns `null` when no config is saved — the caller (a recognition or the
 * settings Test) treats that as "the engine is not set up", which is a
 * different message from any request failure.
 */
export async function createRemoteRunModel(): Promise<RunModel | null> {
  const config = await loadRemoteModelConfig();
  if (config === null) {
    return null;
  }
  // The key comes joined in from the ONE Keychain read `loadRemoteModelConfig`
  // already made, closed over per turn rather than re-read per attempt — a
  // Keychain hiccup surfaces on the first attempt rather than
  // unpredictably on the third.
  const { apiKey } = config;
  // Built once per turn, not per attempt: the schema is a module constant in
  // `@whole/ocr`, and a turn can retry up to three times — each attempt
  // re-deriving the same JSON object graph from zod is pure waste.
  const responseSchema = annotationJsonSchema();

  return async (attempt) => {
    // Abort rather than a fetch timeout: Hermes' `AbortSignal.timeout` is
    // unreliable, and a controller per attempt lets a later attempt start
    // clean after an earlier one aborted.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey !== null ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: config.model,
          temperature: ANNOTATION_INFERENCE.temperature,
          max_tokens: ANNOTATION_INFERENCE.maxOutputTokens,
          messages: [
            { role: "system", content: attempt.system },
            { role: "user", content: attempt.user },
          ],
          // The grammar's twin: same schema, native constraint where the
          // provider supports it, ignored where it does not — and the
          // engine's parse still judges the answer. Deliberately NOT
          // `strict: true`: strict mode requires every property in
          // `required` and `additionalProperties: false` on every object,
          // and the shared schema has an optional property (`alternates`)
          // and no such flag — zod derives it for the grammar, not for
          // OpenAI's strict subset — so a schema-validating provider would
          // answer every request with HTTP 400.
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "annotation",
              schema: responseSchema,
            },
          },
        }),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timeout);
      // A network-level failure (offline, DNS, refused): not retried by the
      // engine — `recognizeWithModel` only retries answers that parsed.
      throw new RemoteModelError(`request failed: ${errorMessage(error)}`);
    }
    clearTimeout(timeout);

    if (!response.ok) {
      // The status is the whole diagnosis: 401/403 says check the key,
      // 404 says check the base URL, 429 says wait. Reported verbatim to the
      // failure-cause mapping, never to the user raw (AGENTS.md: localized
      // copy only).
      throw new RemoteModelError(`HTTP ${response.status}`);
    }

    let body: ChatCompletionResponse;
    try {
      body = (await response.json()) as ChatCompletionResponse;
    } catch {
      throw new RemoteModelError("response was not JSON");
    }
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.length === 0) {
      throw new RemoteModelError("response held no answer");
    }
    return content;
  };
}
