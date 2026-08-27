import type { LlmFetch, ProviderConfig } from "@whole/llm";
import type { RecognitionAttempt } from "@whole/ocr";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_MAX_OUTPUT_TOKENS,
  createModelRunner,
} from "@/features/recognition/model-runner";

const CONFIG: ProviderConfig = {
  baseUrl: "https://api.example.com/v1",
  api: "openai-chat",
  apiKey: "sk-test",
  models: [{ id: "gpt-5.6" }],
};

const ATTEMPT: RecognitionAttempt = {
  system: "system",
  user: "COLUMNS none",
  schemaName: "recognized_accounts",
  schema: { type: "object" },
};

const answering = (text: string, usage?: Record<string, number>): LlmFetch =>
  vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: text } }],
      usage,
    }),
  }));

const bodyOf = (fetchImpl: LlmFetch) => {
  const call = vi.mocked(fetchImpl).mock.calls[0];
  return JSON.parse(call![1].body) as Record<string, unknown>;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createModelRunner", () => {
  it("returns the model's answer as text", async () => {
    const run = createModelRunner({
      config: CONFIG,
      model: "gpt-5.6",
      fetchImpl: answering('{"accounts":[]}'),
    });

    expect(await run(ATTEMPT)).toBe('{"accounts":[]}');
  });

  it("carries the recognition prompt and its output contract onto the wire", async () => {
    const fetchImpl = answering("{}");
    const run = createModelRunner({
      config: CONFIG,
      model: "gpt-5.6",
      fetchImpl,
    });

    await run(ATTEMPT);

    const body = bodyOf(fetchImpl);
    expect(body).toMatchObject({
      model: "gpt-5.6",
      messages: [
        { role: "system", content: "system" },
        { role: "user", content: "COLUMNS none" },
      ],
    });
    expect(JSON.stringify(body.response_format)).toContain(
      "recognized_accounts",
    );
  });

  // Reported as tokens, never as money: under a bring-your-own endpoint the
  // price is unknown, and a wrong figure is worse than no figure.
  it("reports what each turn cost", async () => {
    const onUsage = vi.fn();
    const run = createModelRunner({
      config: CONFIG,
      model: "gpt-5.6",
      fetchImpl: answering("{}", {
        prompt_tokens: 1240,
        completion_tokens: 180,
      }),
      onUsage,
    });

    await run(ATTEMPT);

    expect(onUsage).toHaveBeenCalledWith({
      inputTokens: 1240,
      outputTokens: 180,
    });
  });

  // Every retry is a turn the user pays for, so each one is reported rather
  // than only the last.
  it("reports every turn, not just the first", async () => {
    const onUsage = vi.fn();
    const run = createModelRunner({
      config: CONFIG,
      model: "gpt-5.6",
      fetchImpl: answering("{}", { prompt_tokens: 1, completion_tokens: 2 }),
      onUsage,
    });

    await run(ATTEMPT);
    await run(ATTEMPT);

    expect(onUsage).toHaveBeenCalledTimes(2);
  });

  it("works with no usage listener at all", async () => {
    const run = createModelRunner({
      config: CONFIG,
      model: "gpt-5.6",
      fetchImpl: answering("{}"),
    });

    await expect(run(ATTEMPT)).resolves.toBe("{}");
  });

  describe("the output ceiling", () => {
    it("uses the model's own ceiling when the config states one", async () => {
      const fetchImpl = answering("{}");
      const run = createModelRunner({
        config: { ...CONFIG, models: [{ id: "gpt-5.6", maxTokens: 8192 }] },
        model: "gpt-5.6",
        fetchImpl,
      });

      await run(ATTEMPT);

      expect(bodyOf(fetchImpl).max_tokens).toBe(8192);
    });

    // The ceiling has to cover REASONING, not just the answer. A reasoning
    // model spends output tokens thinking before it emits anything, and those
    // count against the same budget — so a ceiling sized for the answer alone
    // truncates the reply mid-thought and the recognition fails with nothing
    // to show for the tokens it just spent.
    it("leaves room for a reasoning model to think", async () => {
      expect(DEFAULT_MAX_OUTPUT_TOKENS).toBeGreaterThanOrEqual(16384);
    });

    it("falls back to the default ceiling", async () => {
      const fetchImpl = answering("{}");
      const run = createModelRunner({
        config: CONFIG,
        model: "gpt-5.6",
        fetchImpl,
      });

      await run(ATTEMPT);

      expect(bodyOf(fetchImpl).max_tokens).toBe(DEFAULT_MAX_OUTPUT_TOKENS);
    });

    it("falls back when the chosen model is not in the config", async () => {
      const fetchImpl = answering("{}");
      const run = createModelRunner({
        config: CONFIG,
        model: "some-other-model",
        fetchImpl,
      });

      await run(ATTEMPT);

      expect(bodyOf(fetchImpl).max_tokens).toBe(DEFAULT_MAX_OUTPUT_TOKENS);
    });
  });

  // The recognition loop retries what a reworded prompt can fix; a mistyped key
  // is not that, so the classified failure has to reach the app untouched.
  it("lets a transport failure through with its classification", async () => {
    const fetchImpl: LlmFetch = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({}),
    }));
    const run = createModelRunner({
      config: CONFIG,
      model: "gpt-5.6",
      fetchImpl,
    });

    await expect(run(ATTEMPT)).rejects.toMatchObject({ kind: "unauthorized" });
  });
});
