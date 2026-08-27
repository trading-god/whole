import type { ProviderConfig } from "@whole/llm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { probeConfiguredEndpoint } from "@/features/settings/model-probe";

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

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("probeConfiguredEndpoint", () => {
  it("reports the tier the endpoint accepted", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => OK_BODY,
      })),
    );

    expect(await probeConfiguredEndpoint(CONFIG)).toEqual({
      ok: true,
      mode: "json_schema",
    });
  });

  // The classification is what the settings screen turns into advice, so it has
  // to survive the trip rather than collapsing into "it did not work".
  it("reports why it failed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })),
    );

    expect(await probeConfiguredEndpoint(CONFIG)).toMatchObject({
      ok: false,
      kind: "unauthorized",
    });
  });

  // The one place the app's real transport is handed to the pure package. If
  // this stopped passing it, `@whole/llm` would have to reach for a global —
  // which is the property the whole package is built around not having.
  it("uses the platform's own fetch", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => OK_BODY,
    }));
    vi.stubGlobal("fetch", fetchImpl);

    await probeConfiguredEndpoint(CONFIG);

    expect(fetchImpl).toHaveBeenCalled();
  });
});
