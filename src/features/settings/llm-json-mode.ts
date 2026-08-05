import { z } from "zod";

import {
  type LlmConfig,
  normalizeBaseUrl,
} from "@/features/settings/llm-config-store";
import { readJson, setItem } from "@/storage/kv-store";

// Remembers which endpoints rejected `response_format: {"type": "json_object"}`
// so the probe that discovers it runs once per endpoint instead of on every
// recognition.
//
// The app talks to whatever OpenAI-compatible endpoint the user configures, so
// there is no way to know up front whether JSON mode is available: hosted
// providers and the mainstream local servers support it, but an older build or
// a thin proxy in front of one may not. `callVisionModel` therefore asks for
// JSON mode, retries without it when the request is rejected, and records the
// endpoint here — turning a permanent per-request cost into a one-off.
const JSON_MODE_UNSUPPORTED_KEY = "whole.llm.jsonModeUnsupported";

// Keyed by endpoint + model, not by config: the API key is irrelevant to what
// the endpoint can parse and must not be written to unencrypted storage, and
// one endpoint can serve models with different capabilities.
const endpointKeySchema = z.object({
  baseUrl: z.string(),
  model: z.string(),
});

const storedEndpointsSchema = z.array(endpointKeySchema);

// A handful of endpoints is more than a personal install ever accumulates;
// the cap stops a user who cycles through many endpoints from growing the
// record without bound. Oldest entries fall off first.
const MAX_REMEMBERED_ENDPOINTS = 8;

function endpointKey(config: LlmConfig): z.infer<typeof endpointKeySchema> {
  return { baseUrl: normalizeBaseUrl(config.baseUrl), model: config.model };
}

// Reads the stored list, degrading to an empty list on unparseable or absent
// data — a lost record only costs one extra probe, so there is nothing to
// surface to the user.
async function readUnsupportedEndpoints(): Promise<
  z.infer<typeof storedEndpointsSchema>
> {
  const result = storedEndpointsSchema.safeParse(
    await readJson(JSON_MODE_UNSUPPORTED_KEY),
  );
  return result.success ? result.data : [];
}

// The record's identity rule, stated once: an endpoint is the base URL and the
// model together. Both the lookup and the write below go through this, so
// adding a component to the key can't leave one of them matching on the old
// shape — which would make `remember` append a duplicate on every recognition
// until the cap evicted genuine entries.
function hasEndpoint(
  endpoints: readonly z.infer<typeof endpointKeySchema>[],
  key: z.infer<typeof endpointKeySchema>,
): boolean {
  return endpoints.some(
    (entry) => entry.baseUrl === key.baseUrl && entry.model === key.model,
  );
}

export async function isJsonModeUnsupported(
  config: LlmConfig,
): Promise<boolean> {
  return hasEndpoint(await readUnsupportedEndpoints(), endpointKey(config));
}

// Records that this endpoint rejected JSON mode. Best-effort: a failed write
// costs one extra probe on the next recognition, which is not worth failing a
// recognition that has already succeeded.
export async function rememberJsonModeUnsupported(
  config: LlmConfig,
): Promise<void> {
  const key = endpointKey(config);

  try {
    const endpoints = await readUnsupportedEndpoints();
    if (hasEndpoint(endpoints, key)) {
      return;
    }

    await setItem(
      JSON_MODE_UNSUPPORTED_KEY,
      JSON.stringify([...endpoints, key].slice(-MAX_REMEMBERED_ENDPOINTS)),
    );
  } catch {
    // Ignore — see the best-effort note above.
  }
}
