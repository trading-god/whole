import { describe, expect, it } from "vitest";

import type { ProviderConfig } from "./provider";
import { buildChatRequest } from "./request";

const SCHEMA = {
  type: "object",
  properties: { accounts: { type: "array" } },
  required: ["accounts"],
  additionalProperties: false,
} as const;

const PROMPT = {
  model: "gpt-5.6",
  system: "You read account screenshots.",
  user: "#0 (0.10,0.34) 360 Account",
  maxTokens: 4096,
  schemaName: "recognized_accounts",
  schema: SCHEMA,
};

const openAi = (overrides: Partial<ProviderConfig> = {}): ProviderConfig => ({
  baseUrl: "https://api.example.com/v1",
  api: "openai-chat",
  apiKey: "sk-test",
  models: [{ id: "gpt-5.6" }],
  ...overrides,
});

const anthropic = (overrides: Partial<ProviderConfig> = {}): ProviderConfig =>
  openAi({ api: "anthropic-messages", ...overrides });

const bodyOf = (request: { init: { body: string } }) =>
  JSON.parse(request.init.body) as Record<string, unknown>;

describe("buildChatRequest for openai-chat", () => {
  it("posts to the chat-completions path", () => {
    const request = buildChatRequest(openAi(), PROMPT);

    expect(request.url).toBe("https://api.example.com/v1/chat/completions");
    expect(request.init.method).toBe("POST");
  });

  // A base URL is copied out of somebody's dashboard, so it arrives both ways.
  it("tolerates a trailing slash on the base URL", () => {
    const request = buildChatRequest(
      openAi({ baseUrl: "https://api.example.com/v1/" }),
      PROMPT,
    );

    expect(request.url).toBe("https://api.example.com/v1/chat/completions");
  });

  it("sends the key as a bearer token", () => {
    const request = buildChatRequest(openAi(), PROMPT);

    expect(request.init.headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: "Bearer sk-test",
    });
  });

  // A local endpoint usually wants no key, and sending `Bearer undefined` is
  // worse than sending nothing: some servers reject it outright.
  it("omits the authorization header when there is no key", () => {
    const { apiKey: _omitted, ...withoutKey } = openAi();
    const request = buildChatRequest(withoutKey as ProviderConfig, PROMPT);

    expect(request.init.headers).not.toHaveProperty("Authorization");
  });

  it("carries the system and user turns as separate messages", () => {
    expect(bodyOf(buildChatRequest(openAi(), PROMPT))).toMatchObject({
      model: "gpt-5.6",
      max_tokens: 4096,
      messages: [
        { role: "system", content: "You read account screenshots." },
        { role: "user", content: "#0 (0.10,0.34) 360 Account" },
      ],
    });
  });

  // The schema is what turns "return JSON" from a request into a constraint.
  it("asks for schema-enforced output when the endpoint supports it", () => {
    const body = bodyOf(
      buildChatRequest(openAi({ structuredOutput: "json_schema" }), PROMPT),
    );

    expect(body.response_format).toMatchObject({
      type: "json_schema",
      json_schema: {
        name: "recognized_accounts",
        strict: true,
        schema: SCHEMA,
      },
    });
  });

  it("forces a tool call when that is all the endpoint supports", () => {
    const body = bodyOf(
      buildChatRequest(openAi({ structuredOutput: "tool" }), PROMPT),
    );

    expect(body.tools).toMatchObject([
      {
        type: "function",
        function: { name: "recognized_accounts", parameters: SCHEMA },
      },
    ]);
    expect(body.tool_choice).toMatchObject({
      type: "function",
      function: { name: "recognized_accounts" },
    });
    expect(body).not.toHaveProperty("response_format");
  });

  // Nothing enforces the shape here but the prompt itself. It is the tier that
  // keeps a locally hosted model usable rather than locked out.
  it("constrains nothing in prompt mode", () => {
    const body = bodyOf(
      buildChatRequest(openAi({ structuredOutput: "prompt" }), PROMPT),
    );

    expect(body).not.toHaveProperty("response_format");
    expect(body).not.toHaveProperty("tools");
  });

  // Not probed yet: ask for the strongest tier, because that is what the probe
  // is trying to find out.
  it("asks for the strongest tier when the capability is unknown", () => {
    expect(bodyOf(buildChatRequest(openAi(), PROMPT))).toHaveProperty(
      "response_format",
    );
  });
});

describe("buildChatRequest for anthropic-messages", () => {
  it("posts to the messages path", () => {
    expect(buildChatRequest(anthropic(), PROMPT).url).toBe(
      "https://api.example.com/v1/v1/messages",
    );
  });

  it("sends the key in the x-api-key header with a version", () => {
    const request = buildChatRequest(anthropic(), PROMPT);

    expect(request.init.headers).toMatchObject({
      "content-type": "application/json",
      "x-api-key": "sk-test",
      "anthropic-version": "2023-06-01",
    });
  });

  it("omits the key header when there is no key", () => {
    const { apiKey: _omitted, ...withoutKey } = anthropic();
    const request = buildChatRequest(withoutKey as ProviderConfig, PROMPT);

    expect(request.init.headers).not.toHaveProperty("x-api-key");
  });

  // Anthropic takes the system turn as a top-level field rather than a message.
  it("hoists the system turn out of the message list", () => {
    const body = bodyOf(buildChatRequest(anthropic(), PROMPT));

    expect(body).toMatchObject({
      model: "gpt-5.6",
      max_tokens: 4096,
      system: "You read account screenshots.",
      messages: [{ role: "user", content: "#0 (0.10,0.34) 360 Account" }],
    });
  });

  // There is no `response_format` on this protocol, so the schema tier and the
  // tool tier land on the same wire shape — a forced tool call.
  it.each(["json_schema", "tool", undefined] as const)(
    "forces a tool call for the %s tier",
    (structuredOutput) => {
      const body = bodyOf(
        buildChatRequest(anthropic({ structuredOutput }), PROMPT),
      );

      expect(body.tools).toMatchObject([
        { name: "recognized_accounts", input_schema: SCHEMA },
      ]);
      expect(body.tool_choice).toMatchObject({
        type: "tool",
        name: "recognized_accounts",
      });
    },
  );

  it("constrains nothing in prompt mode", () => {
    const body = bodyOf(
      buildChatRequest(anthropic({ structuredOutput: "prompt" }), PROMPT),
    );

    expect(body).not.toHaveProperty("tools");
  });
});
