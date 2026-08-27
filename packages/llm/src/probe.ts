import type { ProviderConfig, StructuredOutputMode } from "./provider";
import { type LlmFailureKind, LlmError, type LlmFetch, sendChat } from "./send";

// Finding out what an endpoint can actually be made to do, once, by asking it.
//
// The three structured-output tiers are not a preference — they are a
// CAPABILITY, and the only reliable way to learn a capability from an endpoint
// nobody controls is to try it. A hosted API enforces `response_format`; a
// locally hosted server may 400 on it and honour a forced tool call; a small
// model may do neither and still follow a clearly worded instruction.
//
// Probing once and recording the answer is what keeps this off the recognition
// path, where it would cost a round trip per screenshot.

export type ProbeResult =
  | { ok: true; mode: StructuredOutputMode }
  | { ok: false; kind: LlmFailureKind; message: string };

// Deliberately trivial. The probe is a handshake — what is being measured is
// whether the endpoint ACCEPTS the request shape, not whether the model is any
// good — so the question is the cheapest one that still needs a JSON answer.
const PROBE_SCHEMA = {
  type: "object",
  properties: { ok: { type: "boolean" } },
  required: ["ok"],
  additionalProperties: false,
};

const probePrompt = (model: string) => ({
  model,
  system: "You answer with JSON only.",
  user: 'Reply with exactly {"ok": true}.',
  // Small on purpose: a reasoning model handed a large ceiling will spend real
  // tokens thinking about a throwaway question.
  maxTokens: 256,
  schemaName: "probe",
  schema: PROBE_SCHEMA,
});

// Only a tier being unsupported is worth retrying with a weaker one. A rejected
// key, an exhausted quota, an unreachable host or a reply that is not a chat
// completion at all are facts about the ENDPOINT: walking the remaining tiers
// would send the same bad credential twice more, and then report "this model
// cannot do schemas" for a URL that is simply wrong.
function isTierRejection(kind: LlmFailureKind): boolean {
  return kind === "server";
}

/**
 * Works out which structured-output tier an endpoint supports.
 *
 * Strongest first, because that is the one worth having: with `json_schema` the
 * server enforces the shape, with `tool` a forced call does, and with `prompt`
 * nothing does but the model's willingness to comply.
 */
export async function probeEndpoint(
  config: ProviderConfig,
  fetchImpl: LlmFetch,
): Promise<ProbeResult> {
  // On the Anthropic protocol the schema tier and the tool tier are the SAME
  // wire shape (a forced tool call), so walking both would be a wasted round
  // trip that also reported the wrong tier name for the same behaviour.
  const tiers: StructuredOutputMode[] =
    config.api === "openai-chat"
      ? ["json_schema", "tool", "prompt"]
      : ["tool", "prompt"];

  let lastFailure: { kind: LlmFailureKind; message: string } = {
    kind: "server",
    message: "The endpoint refused every request shape.",
  };

  for (const mode of tiers) {
    try {
      await sendChat(
        { ...config, structuredOutput: mode },
        probePrompt(config.models[0].id),
        fetchImpl,
      );
      return { ok: true, mode };
    } catch (error) {
      // `sendChat` classifies EVERY failure into an `LlmError` — a transport
      // throw, a status, an unreadable body and an answerless 200 all come out
      // that way, and there is no other exit. The cast states that contract
      // rather than assuming it at runtime: an `instanceof` guard here would be
      // a branch no test could reach, which AGENTS.md forbids papering over
      // with an ignore comment.
      const { kind, message } = error as LlmError;

      if (!isTierRejection(kind)) {
        return { ok: false, kind, message };
      }
      lastFailure = { kind, message };
    }
  }

  return { ok: false, ...lastFailure };
}
