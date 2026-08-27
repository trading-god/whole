import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { ProviderConfig } from "@whole/llm";

// `mock` prefix is required: `jest.mock` factories are hoisted above every
// other statement, so a closed-over variable named anything else is refused.
const mockSecureStore = new Map<string, string>();
const mockKvStore = new Map<string, string>();

jest.mock("expo-secure-store", () => ({
  getItemAsync: async (key: string) => mockSecureStore.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    mockSecureStore.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    mockSecureStore.delete(key);
  },
}));

jest.mock("@/storage/kv-store", () => ({
  getItem: async (key: string) => mockKvStore.get(key) ?? null,
  setItem: async (key: string, value: string) => {
    mockKvStore.set(key, value);
  },
  removeItem: async (key: string) => {
    mockKvStore.delete(key);
  },
}));

const CONFIG: ProviderConfig = {
  baseUrl: "https://api.example.com/v1",
  api: "openai-chat",
  apiKey: "sk-secret",
  models: [{ id: "gpt-5.6" }],
};

// The store caches at module level, so each case needs a fresh instance.
//
// `require` rather than `await import()`: Jest runs these as CommonJS, where a
// dynamic import needs --experimental-vm-modules. The disable has to sit on the
// line immediately above the call — a two-line comment puts it out of range.
const importStore = () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- see above
  require("@/features/assets/model-provider-store") as typeof import("@/features/assets/model-provider-store");

beforeEach(() => {
  jest.resetModules();
  mockSecureStore.clear();
  mockKvStore.clear();
});

describe("the provider configuration", () => {
  it("is absent until something is saved", async () => {
    const { loadProviderConfig } = importStore();

    expect(await loadProviderConfig()).toBeNull();
  });

  it("round-trips a configuration", async () => {
    const { loadProviderConfig, saveProviderConfig } = importStore();

    await saveProviderConfig(CONFIG);

    expect(await loadProviderConfig()).toEqual(CONFIG);
  });

  // THE reason this module exists. `kv-store` is plaintext sqlite; a key sitting
  // in it is a credential in a file any backup copies. Everything else about a
  // provider is inert and belongs where the rest of the app's settings live.
  it("keeps the key out of the plaintext store", async () => {
    const { saveProviderConfig } = importStore();

    await saveProviderConfig(CONFIG);

    expect([...mockKvStore.values()].join()).not.toContain("sk-secret");
    expect([...mockSecureStore.values()]).toContain("sk-secret");
  });

  it("stores the rest of the configuration under a namespaced key", async () => {
    const { saveProviderConfig } = importStore();

    await saveProviderConfig(CONFIG);

    expect([...mockKvStore.keys()]).toEqual(["whole.model.provider"]);
  });

  // A local endpoint usually wants no key at all.
  it("round-trips a configuration with no key", async () => {
    const { apiKey: _omitted, ...withoutKey } = CONFIG;
    const { loadProviderConfig, saveProviderConfig } = importStore();

    await saveProviderConfig(withoutKey as ProviderConfig);

    expect(await loadProviderConfig()).toEqual(withoutKey);
  });

  it("forgets the previous key when a configuration arrives without one", async () => {
    const { apiKey: _omitted, ...withoutKey } = CONFIG;
    const { saveProviderConfig } = importStore();

    await saveProviderConfig(CONFIG);
    await saveProviderConfig(withoutKey as ProviderConfig);

    expect(mockSecureStore.size).toBe(0);
  });

  it("clears both halves", async () => {
    const { clearProviderConfig, loadProviderConfig, saveProviderConfig } =
      importStore();

    await saveProviderConfig(CONFIG);
    await clearProviderConfig();

    expect(await loadProviderConfig()).toBeNull();
    expect(mockSecureStore.size).toBe(0);
    expect(mockKvStore.size).toBe(0);
  });

  // A stored shape the app can no longer read is treated as no configuration:
  // the alternative is a crash on launch over a settings record.
  it.each([
    ["unparseable text", "{not json"],
    ["a shape the schema rejects", JSON.stringify({ baseUrl: "nope" })],
  ])("reads %s as no configuration", async (_label, stored) => {
    mockKvStore.set("whole.model.provider", stored);
    const { loadProviderConfig } = importStore();

    expect(await loadProviderConfig()).toBeNull();
  });

  // Probed once, then recorded — so the app never re-discovers what an endpoint
  // supports on every request.
  it("records a probed structured-output capability", async () => {
    const { loadProviderConfig, recordStructuredOutput, saveProviderConfig } =
      importStore();

    await saveProviderConfig(CONFIG);
    await recordStructuredOutput("tool");

    expect((await loadProviderConfig())?.structuredOutput).toBe("tool");
  });

  it("ignores a probe result when nothing is configured", async () => {
    const { loadProviderConfig, recordStructuredOutput } = importStore();

    await recordStructuredOutput("tool");

    expect(await loadProviderConfig()).toBeNull();
  });
});

describe("consent", () => {
  // Off by default. Configuring an endpoint is not the same act as agreeing
  // that a screenshot's text may be sent to it.
  it("is not given until it is recorded", async () => {
    const { hasConsentedTo } = importStore();

    expect(await hasConsentedTo("api.example.com")).toBe(false);
  });

  it("is remembered for the host it was given for", async () => {
    const { hasConsentedTo, recordConsent } = importStore();

    await recordConsent("api.example.com");

    expect(await hasConsentedTo("api.example.com")).toBe(true);
  });

  // Consent is to a DESTINATION, not to the feature. Pointing the app at
  // someone else's server is a new decision, and carrying the old agreement
  // over would answer it on the user's behalf.
  it("does not carry over to a different host", async () => {
    const { hasConsentedTo, recordConsent } = importStore();

    await recordConsent("localhost");

    expect(await hasConsentedTo("api.openai.com")).toBe(false);
  });

  it("moves to the new host once that one is agreed to", async () => {
    const { hasConsentedTo, recordConsent } = importStore();

    await recordConsent("localhost");
    await recordConsent("api.openai.com");

    expect(await hasConsentedTo("api.openai.com")).toBe(true);
    expect(await hasConsentedTo("localhost")).toBe(false);
  });

  it("is withdrawn when the configuration is cleared", async () => {
    const { clearProviderConfig, hasConsentedTo, recordConsent } =
      importStore();

    await recordConsent("api.example.com");
    await clearProviderConfig();

    expect(await hasConsentedTo("api.example.com")).toBe(false);
  });
});
