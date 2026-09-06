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
// `https://` required: the app's ATS policy allows no cleartext, and a
// credential sent over http:// would be readable on the wire. The settings
// form says this in words; the schema enforces it.

const remoteBaseUrlSchema = z
  .string()
  .trim()
  .regex(
    /^https:\/\/[^\s/]+([^\s]*[^\s/])?$/,
    "Base URL must be an https:// address",
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
