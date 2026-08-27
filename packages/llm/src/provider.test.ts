import { describe, expect, it } from "vitest";

import {
  isLocalEndpoint,
  providerConfigSchema,
  resolveEndpointHost,
} from "./provider";

const VALID = {
  baseUrl: "https://api.example.com/v1",
  api: "openai-chat",
  apiKey: "sk-test",
  models: [{ id: "gpt-5.6" }],
};

describe("providerConfigSchema", () => {
  it("accepts a complete configuration", () => {
    expect(providerConfigSchema.parse(VALID)).toMatchObject({
      baseUrl: "https://api.example.com/v1",
      api: "openai-chat",
    });
  });

  // The protocol is a discriminator field, not an adapter tree — the shape
  // `pi-ai` uses, and the reason two protocols cost a request builder each
  // rather than a provider abstraction each.
  it.each(["openai-chat", "anthropic-messages"])(
    "accepts the %s protocol",
    (api) => {
      expect(providerConfigSchema.safeParse({ ...VALID, api }).success).toBe(
        true,
      );
    },
  );

  it("rejects a protocol nothing can speak", () => {
    expect(
      providerConfigSchema.safeParse({ ...VALID, api: "grpc" }).success,
    ).toBe(false);
  });

  // `z.url()` alone accepts "localhost:11434" — it reads "localhost" as the
  // scheme. Such a config saves cleanly and then never works: consent is keyed
  // on the HOST, and there is no host to resolve. The schema is where that has
  // to be caught, so a stored configuration can never be one nobody can name.
  it.each([
    ["a bare host and port", "localhost:11434"],
    ["a host with no scheme", "api.example.com/v1"],
  ])("rejects %s", (_label, baseUrl) => {
    expect(providerConfigSchema.safeParse({ ...VALID, baseUrl }).success).toBe(
      false,
    );
  });

  it.each([
    ["http", "http://localhost:11434/v1"],
    ["https", "https://api.example.com/v1"],
  ])("accepts an %s endpoint", (_label, baseUrl) => {
    expect(providerConfigSchema.safeParse({ ...VALID, baseUrl }).success).toBe(
      true,
    );
  });

  it("rejects a base URL that is not a URL", () => {
    expect(
      providerConfigSchema.safeParse({ ...VALID, baseUrl: "not a url" })
        .success,
    ).toBe(false);
  });

  // A locally hosted endpoint usually wants no key at all, and demanding a
  // placeholder would be a checkbox nobody can answer honestly.
  it("accepts a configuration with no API key", () => {
    const { apiKey: _omitted, ...withoutKey } = VALID;

    expect(providerConfigSchema.safeParse(withoutKey).success).toBe(true);
  });

  it("requires at least one model", () => {
    expect(
      providerConfigSchema.safeParse({ ...VALID, models: [] }).success,
    ).toBe(false);
  });

  // Probed once and recorded, so the app never re-discovers what an endpoint
  // supports. Absent means "not probed yet", which is different from "probed
  // and found to support nothing".
  it("leaves the structured-output capability unset until it is probed", () => {
    expect(providerConfigSchema.parse(VALID).structuredOutput).toBeUndefined();
  });

  it.each(["json_schema", "tool", "prompt"])(
    "records a probed %s capability",
    (structuredOutput) => {
      expect(
        providerConfigSchema.parse({ ...VALID, structuredOutput })
          .structuredOutput,
      ).toBe(structuredOutput);
    },
  );

  it("rejects a capability nothing implements", () => {
    expect(
      providerConfigSchema.safeParse({ ...VALID, structuredOutput: "magic" })
        .success,
    ).toBe(false);
  });
});

describe("resolveEndpointHost", () => {
  // The consent screen names the host rather than showing a URL, because the
  // host is the part that decides where the data goes.
  it.each([
    ["https://api.example.com/v1", "api.example.com"],
    ["http://localhost:11434", "localhost"],
    ["http://192.168.1.20:8080/v1", "192.168.1.20"],
  ])("reads the host out of %s", (baseUrl, expected) => {
    expect(resolveEndpointHost(baseUrl)).toBe(expected);
  });

  it("returns null for something that is not a URL", () => {
    expect(resolveEndpointHost("not a url")).toBeNull();
  });
});

// The privacy meaning of a loopback address and a public API are not remotely
// the same, so the UI must not make the user parse a URL to tell them apart.
describe("isLocalEndpoint", () => {
  it.each([
    "http://localhost:11434",
    "http://127.0.0.1:8080",
    "http://[::1]:8080",
    "http://192.168.1.20:1234",
    "http://10.0.0.5:1234",
    "http://172.16.0.5:1234",
    "http://172.31.255.1:1234",
    "http://my-mac.local:1234",
  ])("treats %s as local", (baseUrl) => {
    expect(isLocalEndpoint(baseUrl)).toBe(true);
  });

  it.each([
    "https://api.openai.com/v1",
    "https://api.anthropic.com",
    // Deliberately adjacent to the private ranges without being in them: 172.32
    // is public, and a prefix match on "172." would get this wrong.
    "http://172.32.0.1:1234",
    "http://11.0.0.1:1234",
    "http://localhost.evil.com",
  ])("treats %s as external", (baseUrl) => {
    expect(isLocalEndpoint(baseUrl)).toBe(false);
  });

  it("treats something that is not a URL as external", () => {
    expect(isLocalEndpoint("not a url")).toBe(false);
  });
});
