import { describe, expect, it, vi } from "vitest";

import type { ProviderConfig } from "./provider";
import { probeEndpoint } from "./probe";
import type { LlmFetch, LlmResponse } from "./send";

const CONFIG: ProviderConfig = {
  baseUrl: "https://api.example.com/v1",
  api: "openai-chat",
  apiKey: "sk-test",
  models: [{ id: "gpt-5.6" }],
};

const OK_BODY = {
  choices: [{ message: { content: '{"ok":true}' } }],
  usage: { prompt_tokens: 5, completion_tokens: 3 },
};

const ok = (): LlmResponse => ({
  ok: true,
  status: 200,
  json: async () => OK_BODY,
});

const fail = (status: number): LlmResponse => ({
  ok: false,
  status,
  json: async () => ({}),
});

// Answers the tiers in order: the first entry is what the json_schema attempt
// gets, the second what the tool attempt gets, and so on.
const answering = (...responses: LlmResponse[]) => {
  const fetchImpl = vi.fn<LlmFetch>();
  for (const response of responses) {
    fetchImpl.mockResolvedValueOnce(response);
  }
  return fetchImpl;
};

const bodyOf = (fetchImpl: ReturnType<typeof answering>, call: number) =>
  JSON.parse(fetchImpl.mock.calls[call]![1].body) as Record<string, unknown>;

describe("probeEndpoint", () => {
  // The strongest tier first, because that is the one worth having: the server
  // enforces the shape rather than the model choosing to honour it.
  it("reports the schema tier when the endpoint accepts it", async () => {
    const fetchImpl = answering(ok());

    expect(await probeEndpoint(CONFIG, fetchImpl)).toEqual({
      ok: true,
      mode: "json_schema",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("asks for the schema tier on the first attempt", async () => {
    const fetchImpl = answering(ok());

    await probeEndpoint(CONFIG, fetchImpl);

    expect(bodyOf(fetchImpl, 0).response_format).toBeTruthy();
  });

  // Plenty of endpoints — most locally hosted ones — answer 400 to a
  // `response_format` they do not implement. That is the tier being
  // unsupported, not the endpoint being broken.
  it("falls back to a forced tool call", async () => {
    const fetchImpl = answering(fail(400), ok());

    expect(await probeEndpoint(CONFIG, fetchImpl)).toEqual({
      ok: true,
      mode: "tool",
    });
    expect(bodyOf(fetchImpl, 1).tools).toBeTruthy();
  });

  // The tier that keeps a small locally hosted model usable rather than locked
  // out: nothing enforces the shape but the prompt.
  it("falls back to prompting when neither is supported", async () => {
    const fetchImpl = answering(fail(400), fail(400), ok());

    expect(await probeEndpoint(CONFIG, fetchImpl)).toEqual({
      ok: true,
      mode: "prompt",
    });

    const body = bodyOf(fetchImpl, 2);
    expect(body.response_format).toBeUndefined();
    expect(body.tools).toBeUndefined();
  });

  it("gives up when even prompting fails", async () => {
    const fetchImpl = answering(fail(400), fail(400), fail(400));

    expect(await probeEndpoint(CONFIG, fetchImpl)).toMatchObject({
      ok: false,
      kind: "server",
    });
  });

  // A rejected key is not a tier problem. Walking the other two would send the
  // same bad credential twice more and report "server" for something the user
  // fixes by retyping a key.
  it.each<[string, number, string]>([
    ["a rejected key", 401, "unauthorized"],
    ["an exhausted quota", 429, "rate-limited"],
  ])("stops immediately on %s", async (_label, status, kind) => {
    const fetchImpl = answering(fail(status));

    expect(await probeEndpoint(CONFIG, fetchImpl)).toMatchObject({
      ok: false,
      kind,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("stops immediately when the endpoint cannot be reached", async () => {
    const fetchImpl = vi.fn<LlmFetch>(async () => {
      throw new TypeError("Network request failed");
    });

    expect(await probeEndpoint(CONFIG, fetchImpl)).toMatchObject({
      ok: false,
      kind: "network",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  // A 200 whose body holds no answer means the endpoint is reachable but is not
  // a chat endpoint — a captive portal, or the wrong path. Trying the next tier
  // would report "the model cannot do schemas" for a URL that is simply wrong.
  it("stops on a reply that is not a chat completion", async () => {
    const fetchImpl = answering({
      ok: true,
      status: 200,
      json: async () => ({ hello: "world" }),
    });

    expect(await probeEndpoint(CONFIG, fetchImpl)).toMatchObject({
      ok: false,
      kind: "malformed",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("probes the model the configuration names", async () => {
    const fetchImpl = answering(ok());

    await probeEndpoint(CONFIG, fetchImpl);

    expect(bodyOf(fetchImpl, 0).model).toBe("gpt-5.6");
  });

  // The probe is a handshake, not a recognition: a large ceiling here would let
  // a reasoning model spend real tokens answering a throwaway question.
  it("keeps the probe cheap", async () => {
    const fetchImpl = answering(ok());

    await probeEndpoint(CONFIG, fetchImpl);

    expect(bodyOf(fetchImpl, 0).max_tokens as number).toBeLessThanOrEqual(512);
  });

  // There is no `response_format` on this protocol, so the schema and tool
  // tiers are the same wire shape — walking both would be one wasted round trip
  // and would report "tool" for an endpoint that had already refused a schema.
  it("skips the redundant tier on the Anthropic protocol", async () => {
    // Anthropic-shaped, because the reply is parsed by protocol: an
    // OpenAI-shaped body here reads as "no answer" and reports `malformed`.
    const anthropicOk: LlmResponse = {
      ok: true,
      status: 200,
      json: async () => ({
        content: [{ type: "text", text: '{"ok":true}' }],
        usage: { input_tokens: 5, output_tokens: 3 },
      }),
    };
    const fetchImpl = answering(fail(400), anthropicOk);

    expect(
      await probeEndpoint({ ...CONFIG, api: "anthropic-messages" }, fetchImpl),
    ).toEqual({ ok: true, mode: "prompt" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
