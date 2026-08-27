import type { ProviderConfig } from "./provider";
import { type ChatPrompt, buildChatRequest } from "./request";

// The slice of `fetch` this package uses, declared structurally rather than
// imported.
//
// It is a PARAMETER, not a global, and that is the load-bearing decision in
// this package: nothing here reaches `globalThis`, so the whole surface —
// every status code, a transport that throws, a body that will not parse —
// is reachable from a two-line fake. The app passes React Native's real fetch.
export type LlmResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

export type LlmFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<LlmResponse>;

/**
 * Why a turn failed, in the terms the user can act on.
 *
 * Under a bring-your-own endpoint the user is the only person who can fix any
 * of these, so the distinction has to survive all the way to the screen: a
 * mistyped key, an exhausted quota, a dropped connection and a model that will
 * not emit JSON call for four different responses.
 */
export type LlmFailureKind =
  "unauthorized" | "rate-limited" | "server" | "network" | "malformed";

export class LlmError extends Error {
  readonly kind: LlmFailureKind;
  /** Absent when the request never produced a response at all. */
  readonly status?: number;

  constructor(kind: LlmFailureKind, message: string, status?: number) {
    super(message);
    this.name = "LlmError";
    this.kind = kind;
    this.status = status;
  }
}

/** What a turn cost, reported in tokens and never converted to money. */
export type LlmUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type ChatResult = {
  /** The model's answer as text; the caller parses it against its own schema. */
  text: string;
  usage: LlmUsage;
};

function classifyStatus(status: number): LlmFailureKind {
  if (status === 401 || status === 403) {
    return "unauthorized";
  }
  if (status === 429) {
    return "rate-limited";
  }
  return "server";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

// Usage is a courtesy field, not a contract. An endpoint that omits it must
// still produce a usable result — reporting zero is honest, and failing the
// whole recognition over a missing counter would not be.
function readUsage(
  body: Record<string, unknown>,
  inputKey: string,
  outputKey: string,
): LlmUsage {
  const usage = isRecord(body.usage) ? body.usage : {};
  return {
    inputTokens: readNumber(usage[inputKey]),
    outputTokens: readNumber(usage[outputKey]),
  };
}

function readOpenAiText(body: Record<string, unknown>): string | null {
  const choices = body.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return null;
  }

  const message = isRecord(choices[0]) ? choices[0].message : undefined;
  if (!isRecord(message)) {
    return null;
  }

  if (typeof message.content === "string") {
    return message.content;
  }

  // A forced tool call carries the answer in the call's arguments, already
  // serialized.
  const toolCalls = message.tool_calls;
  if (Array.isArray(toolCalls) && isRecord(toolCalls[0])) {
    const fn = toolCalls[0].function;
    if (isRecord(fn) && typeof fn.arguments === "string") {
      return fn.arguments;
    }
  }

  return null;
}

function readAnthropicText(body: Record<string, unknown>): string | null {
  const content = body.content;
  if (!Array.isArray(content)) {
    return null;
  }

  const blocks = content.filter(isRecord);

  // The tool call wins over any prose beside it: a model that thinks out loud
  // emits a text block first, and the tool call is the answer while the prose
  // is not. Its input arrives as an object, so it is re-serialized — the
  // contract this function returns is "text that parses as JSON".
  const toolUse = blocks.find((block) => block.type === "tool_use");
  if (toolUse) {
    return JSON.stringify(toolUse.input);
  }

  const text = blocks.find((block) => block.type === "text");
  if (text && typeof text.text === "string") {
    return text.text;
  }

  return null;
}

/**
 * Runs one model turn against the user's endpoint.
 *
 * Failures are thrown as `LlmError` with a `kind`, never returned as an empty
 * result: a caller that cannot tell "no accounts on this screen" from "your key
 * is wrong" will show the user the first when it means the second.
 */
export async function sendChat(
  config: ProviderConfig,
  prompt: ChatPrompt,
  fetchImpl: LlmFetch,
): Promise<ChatResult> {
  const request = buildChatRequest(config, prompt);

  let response: LlmResponse;
  try {
    response = await fetchImpl(request.url, request.init);
  } catch (error) {
    throw new LlmError(
      "network",
      `Could not reach the model endpoint: ${String(error)}`,
    );
  }

  if (!response.ok) {
    throw new LlmError(
      classifyStatus(response.status),
      `The model endpoint answered ${response.status}`,
      response.status,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    throw new LlmError(
      "malformed",
      `The model endpoint's response could not be read: ${String(error)}`,
      response.status,
    );
  }

  if (!isRecord(body)) {
    throw new LlmError(
      "malformed",
      "The model endpoint answered with something that is not an object",
      response.status,
    );
  }

  const isOpenAi = config.api === "openai-chat";
  const text = isOpenAi ? readOpenAiText(body) : readAnthropicText(body);

  // A 200 whose body holds no answer — a captive portal's JSON, or a gateway
  // that swallowed the choice list. That is a failed call, not an empty result.
  if (text === null) {
    throw new LlmError(
      "malformed",
      "The model endpoint's response held no answer",
      response.status,
    );
  }

  return {
    text,
    usage: isOpenAi
      ? readUsage(body, "prompt_tokens", "completion_tokens")
      : readUsage(body, "input_tokens", "output_tokens"),
  };
}
