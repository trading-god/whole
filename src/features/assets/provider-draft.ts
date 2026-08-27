import {
  type ProviderApi,
  type ProviderConfig,
  isLocalEndpoint,
  providerConfigSchema,
  resolveEndpointHost,
} from "@whole/llm";

// The settings form's state, and the two conversions around it.
//
// Pure, so the rules that decide whether a configuration is usable — and what
// the consent copy should say about where it points — are testable without
// rendering a screen. The form itself only binds fields to these.
//
// Every field is a string because every field is a text input. That is the
// whole reason a draft type exists rather than the screen editing a
// `ProviderConfig` directly: a half-typed URL is a legitimate form state and
// not a legitimate configuration.

export type ProviderDraft = {
  baseUrl: string;
  api: ProviderApi;
  apiKey: string;
  model: string;
};

export function emptyProviderDraft(): ProviderDraft {
  return { baseUrl: "", api: "openai-chat", apiKey: "", model: "" };
}

/**
 * The configuration this draft describes, or null while it is incomplete.
 *
 * Null rather than a thrown error, because the save button is gated on it and
 * an incomplete form is the normal state of a form being filled in.
 */
export function draftToProviderConfig(
  draft: ProviderDraft,
): ProviderConfig | null {
  const model = draft.model.trim();
  const apiKey = draft.apiKey.trim();

  const parsed = providerConfigSchema.safeParse({
    baseUrl: draft.baseUrl.trim(),
    api: draft.api,
    // Omitted rather than empty: a local endpoint usually wants no key at all,
    // and an empty field means "no key", not "the empty-string key".
    ...(apiKey.length > 0 ? { apiKey } : {}),
    // No per-model ceiling: `DEFAULT_MAX_OUTPUT_TOKENS` covers the endpoints
    // people actually configure, and a field asking for a number nobody can
    // derive is a question with no good answer.
    models: model.length > 0 ? [{ id: model }] : [],
  });

  return parsed.success ? parsed.data : null;
}

export function providerConfigToDraft(
  config: ProviderConfig | null,
): ProviderDraft {
  if (config === null) {
    return emptyProviderDraft();
  }

  return {
    baseUrl: config.baseUrl,
    api: config.api,
    apiKey: config.apiKey ?? "",
    model: config.models[0].id,
  };
}

/**
 * Where this draft points, for the consent copy.
 *
 * Shown live as the user types, so a half-typed URL answers `null` rather than
 * throwing. "…to a model on your own Mac" and "…to a company in another
 * country" are not the same promise, and reading a URL should not be how a
 * person tells them apart.
 */
export function providerDraftHost(draft: ProviderDraft): {
  host: string | null;
  isLocal: boolean;
} {
  const baseUrl = draft.baseUrl.trim();
  const host = resolveEndpointHost(baseUrl);

  return { host, isLocal: host !== null && isLocalEndpoint(baseUrl) };
}

/**
 * The preset this draft currently matches, or null once it matches none.
 *
 * DERIVED rather than remembered. Tracking "which preset did they tap" as its
 * own state would be a second source of truth for something the fields already
 * answer — and it would go stale the moment the address was edited by hand,
 * leaving a chip marked for an endpoint the form no longer describes.
 */
export function activePresetId(draft: ProviderDraft): string | null {
  const baseUrl = draft.baseUrl.trim();

  return (
    PROVIDER_PRESETS.find(
      (preset) => preset.baseUrl === baseUrl && preset.api === draft.api,
    )?.id ?? null
  );
}

export type ProviderPreset = {
  id: string;
  baseUrl: string;
  api: ProviderApi;
};

/**
 * Starting points for the endpoints people actually use.
 *
 * A preset is only a base URL and which of the two wire shapes that host
 * speaks — there is no adapter behind it, because the protocol is a field.
 * The two local ones come first: they are what make the privacy promise
 * keepable, and putting them at the top is the recommendation.
 */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  { id: "ollama", baseUrl: "http://localhost:11434/v1", api: "openai-chat" },
  { id: "lm-studio", baseUrl: "http://localhost:1234/v1", api: "openai-chat" },
  { id: "openai", baseUrl: "https://api.openai.com/v1", api: "openai-chat" },
  {
    id: "anthropic",
    baseUrl: "https://api.anthropic.com",
    api: "anthropic-messages",
  },
];
