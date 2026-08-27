import { describe, expect, it, vi } from "vitest";

import type { ProviderConfig } from "./provider";
import type { ChatPrompt } from "./request";
import { LlmError, type LlmFetch, sendChat } from "./send";

const PROMPT: ChatPrompt = {
  model: "gpt-5.6",
  system: "system",
  user: "user",
  maxTokens: 4096,
  schemaName: "recognized_accounts",
  schema: { type: "object" },
};

const openAi: ProviderConfig = {
  baseUrl: "https://api.example.com/v1",
  api: "openai-chat",
  apiKey: "sk-test",
  models: [{ id: "gpt-5.6" }],
};

const anthropic: ProviderConfig = { ...openAi, api: "anthropic-messages" };

const respondWith = (body: unknown, ok = true, status = 200): LlmFetch =>
  vi.fn(async () => ({ ok, status, json: async () => body }));

const OPENAI_TEXT_BODY = {
  choices: [{ message: { content: '{"accounts":[]}' } }],
  usage: { prompt_tokens: 1240, completion_tokens: 180 },
};

const ANTHROPIC_TEXT_BODY = {
  content: [{ type: "text", text: '{"accounts":[]}' }],
  usage: { input_tokens: 1240, output_tokens: 180 },
};

// `kind` is the whole point of the error type. Under a bring-your-own endpoint
// the user is the ONLY person who can fix any of these, so "your key is wrong"
// and "you are rate limited" have to reach them as different messages.
const kindOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error instanceof LlmError ? error.kind : "not-an-llm-error";
  }
  return "no-error";
};

describe("sendChat over openai-chat", () => {
  it("returns the message content", async () => {
    const result = await sendChat(
      openAi,
      PROMPT,
      respondWith(OPENAI_TEXT_BODY),
    );

    expect(result.text).toBe('{"accounts":[]}');
  });

  // Reported as token counts, never converted to money: under a
  // bring-your-own endpoint the price is unknown, and a wrong number is worse
  // than no number.
  it("reports what the turn cost in tokens", async () => {
    const result = await sendChat(
      openAi,
      PROMPT,
      respondWith(OPENAI_TEXT_BODY),
    );

    expect(result.usage).toEqual({ inputTokens: 1240, outputTokens: 180 });
  });

  it("reads the arguments of a forced tool call", async () => {
    const result = await sendChat(
      openAi,
      PROMPT,
      respondWith({
        choices: [
          {
            message: {
              tool_calls: [{ function: { arguments: '{"accounts":[]}' } }],
            },
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 2 },
      }),
    );

    expect(result.text).toBe('{"accounts":[]}');
  });

  it("sends the request the builder produced", async () => {
    const fetchImpl = respondWith(OPENAI_TEXT_BODY);

    await sendChat(openAi, PROMPT, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.example.com/v1/chat/completions",
      expect.objectContaining({ method: "POST" }),
    );
  });

  // Usage is a courtesy field, not a contract: an endpoint that omits it must
  // still produce a usable result rather than failing the whole recognition.
  it("reports zero usage when the endpoint does not account for it", async () => {
    const result = await sendChat(
      openAi,
      PROMPT,
      respondWith({ choices: [{ message: { content: "{}" } }] }),
    );

    expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });
});

describe("sendChat over anthropic-messages", () => {
  it("returns the text block", async () => {
    const result = await sendChat(
      anthropic,
      PROMPT,
      respondWith(ANTHROPIC_TEXT_BODY),
    );

    expect(result.text).toBe('{"accounts":[]}');
  });

  // A forced tool call arrives as a structured object rather than a string, so
  // it is re-serialized — the caller's contract is "text that parses as JSON".
  it("re-serializes the input of a forced tool call", async () => {
    const result = await sendChat(
      anthropic,
      PROMPT,
      respondWith({
        content: [{ type: "tool_use", input: { accounts: [] } }],
        usage: { input_tokens: 1, output_tokens: 2 },
      }),
    );

    expect(JSON.parse(result.text)).toEqual({ accounts: [] });
  });

  // Models that think out loud emit a text block before the tool call; the tool
  // call is the answer, and the prose is not.
  it("prefers the tool call over any prose beside it", async () => {
    const result = await sendChat(
      anthropic,
      PROMPT,
      respondWith({
        content: [
          { type: "text", text: "Let me look at the rows." },
          { type: "tool_use", input: { accounts: [] } },
        ],
        usage: { input_tokens: 1, output_tokens: 2 },
      }),
    );

    expect(JSON.parse(result.text)).toEqual({ accounts: [] });
  });

  it("reports what the turn cost in tokens", async () => {
    const result = await sendChat(
      anthropic,
      PROMPT,
      respondWith(ANTHROPIC_TEXT_BODY),
    );

    expect(result.usage).toEqual({ inputTokens: 1240, outputTokens: 180 });
  });
});

describe("failures", () => {
  it.each([
    ["an invalid key", 401, "unauthorized"],
    ["a forbidden key", 403, "unauthorized"],
    ["a rate limit", 429, "rate-limited"],
    ["a server fault", 503, "server"],
    ["anything else the server refuses", 400, "server"],
  ])("classifies %s", async (_label, status, kind) => {
    expect(
      await kindOf(sendChat(openAi, PROMPT, respondWith({}, false, status))),
    ).toBe(kind);
  });

  it("classifies a transport failure as network", async () => {
    const fetchImpl: LlmFetch = vi.fn(async () => {
      throw new TypeError("Network request failed");
    });

    expect(await kindOf(sendChat(openAi, PROMPT, fetchImpl))).toBe("network");
  });

  it("classifies an unreadable body as malformed", async () => {
    const fetchImpl: LlmFetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token");
      },
    }));

    expect(await kindOf(sendChat(openAi, PROMPT, fetchImpl))).toBe("malformed");
  });

  // A 200 whose body holds no answer at all — a captive portal, or a gateway
  // that swallowed the choice list. It is a failed call, not an empty result.
  it.each([
    ["an empty choice list", { choices: [] }],
    ["a choice with no content", { choices: [{ message: {} }] }],
    ["a choice that is not an object", { choices: ["oops"] }],
    ["a choice whose message is not an object", { choices: [{ message: 1 }] }],
    [
      "a tool call with no serialized arguments",
      { choices: [{ message: { tool_calls: [{ function: {} }] } }] },
    ],
    ["a body that is not an object", "gateway timeout"],
  ])("classifies %s as malformed", async (_label, body) => {
    expect(await kindOf(sendChat(openAi, PROMPT, respondWith(body)))).toBe(
      "malformed",
    );
  });

  it.each([
    ["an empty content list", { content: [] }],
    ["a content block of no usable type", { content: [{ type: "thinking" }] }],
    ["a content field that is not a list", { content: "text" }],
    [
      "a text block whose text is not a string",
      { content: [{ type: "text", text: 1 }] },
    ],
  ])("classifies %s as malformed on anthropic", async (_label, body) => {
    expect(await kindOf(sendChat(anthropic, PROMPT, respondWith(body)))).toBe(
      "malformed",
    );
  });

  // The status rides along so a message can name it when the kind alone is not
  // specific enough to act on.
  it("carries the HTTP status on the error", async () => {
    try {
      await sendChat(openAi, PROMPT, respondWith({}, false, 429));
      expect.unreachable("sendChat should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(LlmError);
      expect((error as LlmError).status).toBe(429);
    }
  });

  it("leaves the status unset when there was never a response", async () => {
    const fetchImpl: LlmFetch = vi.fn(async () => {
      throw new TypeError("Network request failed");
    });

    try {
      await sendChat(openAi, PROMPT, fetchImpl);
      expect.unreachable("sendChat should have thrown");
    } catch (error) {
      expect((error as LlmError).status).toBeUndefined();
    }
  });
});
