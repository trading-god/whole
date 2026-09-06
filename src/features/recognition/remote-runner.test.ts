import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { RunModel } from "@whole/ocr";

import { createRemoteRunModel } from "@/features/recognition/remote-runner";
import { RemoteModelError } from "@/features/recognition/remote-model-error";

const mockLoadRemoteModelConfig = jest.fn<() => Promise<unknown>>();
const mockLoadRemoteApiKey = jest.fn<() => Promise<string | null>>();

jest.mock("@/features/recognition/remote-model-config-store", () => ({
  loadRemoteModelConfig: () => mockLoadRemoteModelConfig(),
  loadRemoteApiKey: () => mockLoadRemoteApiKey(),
}));

const CONFIG = {
  baseUrl: "https://api.deepseek.com/v1",
  model: "deepseek-chat",
  apiKey: "sk-test",
};

const COMPLETION_BODY = {
  choices: [{ message: { content: '{"homeCurrency":"none"}' } }],
};

beforeEach(() => {
  jest.resetAllMocks();
  mockLoadRemoteModelConfig.mockResolvedValue(CONFIG);
  mockLoadRemoteApiKey.mockResolvedValue("sk-test");
});

describe("createRemoteRunModel", () => {
  it("answers a completion with the endpoint's content", async () => {
    jest
      .spyOn(global, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify(COMPLETION_BODY), { status: 200 }),
      );

    const runModel = (await createRemoteRunModel()) as RunModel;

    const answer = await runModel({
      system: "sys",
      user: "user",
      grammar: "",
    });

    expect(answer).toBe(COMPLETION_BODY.choices[0].message.content);
  });

  it("posts to the configured base URL with the auth header and the schema", async () => {
    const fetchSpy = jest
      .spyOn(global, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify(COMPLETION_BODY), { status: 200 }),
      );

    const runModel = (await createRemoteRunModel()) as RunModel;
    await runModel({ system: "s", user: "u", grammar: "" });

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.deepseek.com/v1/chat/completions");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer sk-test",
    });
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.model).toBe("deepseek-chat");
    expect(body.response_format).toMatchObject({ type: "json_schema" });
    fetchSpy.mockRestore();
  });

  it("returns null when no config is saved", async () => {
    mockLoadRemoteModelConfig.mockResolvedValue(null);

    await expect(createRemoteRunModel()).resolves.toBeNull();
  });

  it("sends no Authorization header when no key is stored", async () => {
    // The key lives in its OWN store — the config's `apiKey` is what
    // `loadRemoteModelConfig` joins in for the SETTINGS screen; the runner
    // reads the SecureStore side directly.
    mockLoadRemoteApiKey.mockResolvedValue(null);
    const fetchSpy = jest
      .spyOn(global, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify(COMPLETION_BODY), { status: 200 }),
      );

    const runModel = (await createRemoteRunModel()) as RunModel;
    await runModel({ system: "s", user: "u", grammar: "" });

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    // A Headers instance in some environments, a plain record in others:
    // assert through the API both satisfy.
    const headers = new Headers(init.headers as HeadersInit);
    expect(headers.get("Authorization")).toBeNull();
    fetchSpy.mockRestore();
  });

  it("throws RemoteModelError when the endpoint answers a non-2xx status", async () => {
    jest
      .spyOn(global, "fetch")
      .mockResolvedValue(new Response("denied", { status: 401 }));

    const runModel = (await createRemoteRunModel()) as RunModel;

    await expect(
      runModel({ system: "s", user: "u", grammar: "" }),
    ).rejects.toThrow(RemoteModelError);
  });

  it("throws RemoteModelError when the fetch itself fails", async () => {
    jest.spyOn(global, "fetch").mockRejectedValue(new Error("offline"));

    const runModel = (await createRemoteRunModel()) as RunModel;

    await expect(
      runModel({ system: "s", user: "u", grammar: "" }),
    ).rejects.toThrow(RemoteModelError);
  });

  it("throws RemoteModelError when the response holds no answer", async () => {
    jest
      .spyOn(global, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ choices: [] }), { status: 200 }),
      );

    const runModel = (await createRemoteRunModel()) as RunModel;

    await expect(
      runModel({ system: "s", user: "u", grammar: "" }),
    ).rejects.toThrow(RemoteModelError);
  });
});
