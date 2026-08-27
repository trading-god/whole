import type { ProviderConfig } from "@whole/llm";
import { describe, expect, it } from "vitest";

import {
  PROVIDER_PRESETS,
  activePresetId,
  draftToProviderConfig,
  emptyProviderDraft,
  providerConfigToDraft,
  providerDraftHost,
} from "@/features/assets/provider-draft";

const DRAFT = {
  baseUrl: "https://api.example.com/v1",
  api: "openai-chat" as const,
  apiKey: "sk-test",
  model: "gpt-5.6",
};

describe("draftToProviderConfig", () => {
  it("builds a configuration from a complete draft", () => {
    expect(draftToProviderConfig(DRAFT)).toEqual({
      baseUrl: "https://api.example.com/v1",
      api: "openai-chat",
      apiKey: "sk-test",
      models: [{ id: "gpt-5.6" }],
    });
  });

  // Typed into a field, so it arrives with whatever the keyboard added.
  it("trims what the user typed", () => {
    expect(
      draftToProviderConfig({
        ...DRAFT,
        baseUrl: "  https://api.example.com/v1  ",
        model: "  gpt-5.6  ",
        apiKey: "  sk-test  ",
      }),
    ).toMatchObject({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test",
      models: [{ id: "gpt-5.6" }],
    });
  });

  // A locally hosted endpoint usually wants no key at all, and an empty field
  // must mean "no key" rather than "the empty-string key".
  it("omits an empty key entirely", () => {
    const config = draftToProviderConfig({ ...DRAFT, apiKey: "   " });

    expect(config).not.toBeNull();
    expect(config && "apiKey" in config).toBe(false);
  });

  // The save button is gated on this, so every incomplete state has to answer
  // null rather than throw.
  it.each([
    ["a base URL that is not a URL", { baseUrl: "localhost:11434" }],
    ["no base URL", { baseUrl: "" }],
    ["no model", { model: "  " }],
  ])("refuses a draft with %s", (_label, overrides) => {
    expect(draftToProviderConfig({ ...DRAFT, ...overrides })).toBeNull();
  });

  // Probing is the app's job, not the user's — the field does not exist in the
  // form, and a saved draft must not claim a capability nobody measured.
  it("leaves the structured-output capability unprobed", () => {
    expect(draftToProviderConfig(DRAFT)?.structuredOutput).toBeUndefined();
  });
});

describe("providerConfigToDraft", () => {
  it("fills the form from a stored configuration", () => {
    expect(
      providerConfigToDraft({
        baseUrl: "https://api.example.com/v1",
        api: "anthropic-messages",
        apiKey: "sk-test",
        models: [{ id: "claude" }],
      }),
    ).toEqual({
      baseUrl: "https://api.example.com/v1",
      api: "anthropic-messages",
      apiKey: "sk-test",
      model: "claude",
    });
  });

  // Fields are strings because they are bound to text inputs; an absent key
  // becomes an empty field, not the literal "undefined".
  it("renders an absent key as an empty field", () => {
    expect(
      providerConfigToDraft({
        baseUrl: "http://localhost:11434/v1",
        api: "openai-chat",
        models: [{ id: "llama" }],
      }).apiKey,
    ).toBe("");
  });

  it("opens an empty form when nothing is configured", () => {
    expect(providerConfigToDraft(null)).toEqual(emptyProviderDraft());
  });

  it("round-trips a configuration", () => {
    const config: ProviderConfig = {
      baseUrl: "https://api.example.com/v1",
      api: "openai-chat",
      apiKey: "sk-test",
      models: [{ id: "gpt-5.6" }],
    };

    expect(draftToProviderConfig(providerConfigToDraft(config))).toEqual(
      config,
    );
  });
});

describe("providerDraftHost", () => {
  // What the consent copy needs. A loopback address and a company in another
  // country are not the same promise, and the user should not have to read a
  // URL to tell them apart.
  it("names the host and says it is the user's own machine", () => {
    expect(
      providerDraftHost({ ...DRAFT, baseUrl: "http://localhost:11434/v1" }),
    ).toEqual({ host: "localhost", isLocal: true });
  });

  it("names an external host as external", () => {
    expect(providerDraftHost(DRAFT)).toEqual({
      host: "api.example.com",
      isLocal: false,
    });
  });

  // Shown live as the user types, so a half-typed URL must not throw.
  it("reports no host for something that is not a URL yet", () => {
    expect(providerDraftHost({ ...DRAFT, baseUrl: "http" })).toEqual({
      host: null,
      isLocal: false,
    });
  });
});

describe("activePresetId", () => {
  // Derived from the fields, so it needs no memory of what was tapped — and
  // cannot go stale against an address the user edited by hand.
  it("names the preset the draft matches", () => {
    expect(
      activePresetId({
        ...DRAFT,
        baseUrl: "http://localhost:11434/v1",
        api: "openai-chat",
      }),
    ).toBe("ollama");
  });

  it("is null once the address no longer matches", () => {
    expect(
      activePresetId({ ...DRAFT, baseUrl: "http://localhost:9999/v1" }),
    ).toBeNull();
  });

  // The protocol is half of what a preset sets, so switching it alone is enough
  // to stop the form describing that preset.
  it("is null when the protocol was switched away", () => {
    expect(
      activePresetId({
        ...DRAFT,
        baseUrl: "http://localhost:11434/v1",
        api: "anthropic-messages",
      }),
    ).toBeNull();
  });

  it("ignores whitespace around the address", () => {
    expect(
      activePresetId({
        ...DRAFT,
        baseUrl: "  http://localhost:11434/v1  ",
        api: "openai-chat",
      }),
    ).toBe("ollama");
  });

  it("matches every preset it offers", () => {
    for (const preset of PROVIDER_PRESETS) {
      expect(
        activePresetId({
          ...DRAFT,
          baseUrl: preset.baseUrl,
          api: preset.api,
        }),
      ).toBe(preset.id);
    }
  });
});

describe("PROVIDER_PRESETS", () => {
  // The protocol is a field, not an adapter tree, so a preset is just a base
  // URL and which of the two wire shapes that host speaks.
  it("offers a starting point for the usual endpoints", () => {
    expect(PROVIDER_PRESETS.map((preset) => preset.id)).toEqual([
      "ollama",
      "lm-studio",
      "openai",
      "anthropic",
    ]);
  });

  it("gives every preset a base URL the schema accepts", () => {
    for (const preset of PROVIDER_PRESETS) {
      expect(
        draftToProviderConfig({
          ...emptyProviderDraft(),
          baseUrl: preset.baseUrl,
          api: preset.api,
          model: "some-model",
        }),
      ).not.toBeNull();
    }
  });

  // The two local ones are what make the privacy promise keepable, so the
  // consent screen has to read them as local.
  it.each(["ollama", "lm-studio"])(
    "points %s at the user's own machine",
    (id) => {
      const preset = PROVIDER_PRESETS.find((entry) => entry.id === id);

      expect(
        providerDraftHost({ ...emptyProviderDraft(), baseUrl: preset!.baseUrl })
          .isLocal,
      ).toBe(true);
    },
  );

  it.each(["openai", "anthropic"])("points %s at an external host", (id) => {
    const preset = PROVIDER_PRESETS.find((entry) => entry.id === id);

    expect(
      providerDraftHost({ ...emptyProviderDraft(), baseUrl: preset!.baseUrl })
        .isLocal,
    ).toBe(false);
  });
});
