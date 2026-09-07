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
// A SCHEME is required and only `http`/`https` pass, and `http://` is allowed
// only for hosts that are local BY CONSTRUCTION — `localhost` plus the
// loopback and private IPv4 ranges a LAN service lives at. The schema is the
// only layer that can keep a credential off a cleartext public wire: ATS
// exempts numeric IP addresses entirely before iOS 17 and the deployment
// target is 16.4, so `http://<public-IP>` would otherwise POST the
// `Authorization: Bearer` key in the clear on every supported iOS 16 device —
// a named public host is safe (ATS blocks cleartext to it), but the IP-literal
// hole is closed here, at save time. Local hosts are exactly what the platform
// allowances exist for (`NSAllowsLocalNetworking` in app.json on iOS; the
// loopback-only network security config on Android, where a LAN-IP endpoint
// stays https-only).
const LOCAL_HTTP_HOST =
  "(?:localhost|(?:127|10)\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}|172\\.(?:1[6-9]|2\\d|3[01])\\.\\d{1,3}\\.\\d{1,3}|192\\.168\\.\\d{1,3}\\.\\d{1,3}|169\\.254\\.\\d{1,3}\\.\\d{1,3})";

const remoteBaseUrlSchema = z
  .string()
  .trim()
  .regex(
    new RegExp(
      `^(?:https://[^\\s/]+(?:[^\\s]*[^\\s/])?|http://${LOCAL_HTTP_HOST}(?::\\d+)?(?:/[^\\s]*)?)$`,
    ),
    "Base URL must be an https:// address, or http:// for a local service",
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
