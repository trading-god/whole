import { z } from "zod";

// The remote endpoint's config SHAPE, in a module with no storage imports.
//
// Pure TypeScript on purpose, mirroring `remote-model-error.ts`: the store
// (`remote-model-config-store.ts`) pulls in kv-store and SecureStore, so a
// test that needs the REAL schema and normalizer — the form's validity is
// their behavior, and a hand-copied look-alike would keep validating the old
// shape after the real one tightened — imports them from here instead.
//
// The base URL is normalized WITHOUT a trailing slash and WITHOUT the
// `/chat/completions` suffix — the runner appends the path, so a user who
// pastes either form of the same endpoint ends up with the same request.
//
// A SCHEME is required and only `http`/`https` pass — a scheme-less host is
// ambiguous to paste, and anything else is not an OpenAI-compatible HTTP
// endpoint. `http://` is allowed for LOCAL services (Ollama, LM Studio on
// the same machine): the schema cannot tell local from public, so the gate
// is ATS's, not the form's — `NSAllowsLocalNetworking` (app.json) permits
// cleartext to local hosts while every public endpoint still has to answer
// https or the request itself fails.
const remoteBaseUrlSchema = z
  .string()
  .trim()
  .regex(
    /^https?:\/\/[^\s/]+([^\s]*[^\s/])?$/,
    "Base URL must be an http:// or https:// address",
  );

export const remoteConfigSchema = z.object({
  baseUrl: remoteBaseUrlSchema,
  // Which model the endpoint serves — OpenAI-compatible providers name it
  // (e.g. "deepseek-chat", "gpt-4o-mini"); the user copies it from their
  // provider's console.
  model: z.string().trim().min(1),
});
export type RemoteModelConfig = z.infer<typeof remoteConfigSchema>;

/**
 * Normalizes a pasted base URL: trims, strips trailing slashes, so the runner's
 * path append lands on `…/v1` rather than `…/v1//chat/completions`.
 */
export function normalizeRemoteBaseUrl(input: string): string {
  return input.trim().replace(/\/+$/, "");
}
