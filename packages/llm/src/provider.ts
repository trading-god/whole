import { z } from "zod";

// A model endpoint the user configured, in the shape `pi-ai` uses: one entry
// per provider, with the wire protocol as a FIELD rather than a subclass.
//
// That field is what keeps two protocols to two request builders instead of two
// provider abstractions. Adding a third means one more `api` value and one more
// builder, not another layer.
export const providerApiSchema = z.enum(["openai-chat", "anthropic-messages"]);

export type ProviderApi = z.infer<typeof providerApiSchema>;

// How an endpoint can be made to return parseable JSON, discovered by probing
// once and then recorded here.
//
// The three tiers descend in reliability: `json_schema` is enforced by the
// server, `tool` is enforced by a forced tool call, and `prompt` is enforced by
// nothing but the model's willingness to comply. Absent means NOT PROBED YET,
// which is a different state from "probed and found to support only prompting"
// — the first should probe, the second should not.
export const structuredOutputModeSchema = z.enum([
  "json_schema",
  "tool",
  "prompt",
]);

export type StructuredOutputMode = z.infer<typeof structuredOutputModeSchema>;

export const providerModelSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  contextWindow: z.number().int().positive().optional(),
  maxTokens: z.number().int().positive().optional(),
});

// Scheme, optional credentials, then the host — enough of a URL to name where a
// request is going.
//
// Hand-parsed rather than handed to `URL`, because `URL` is a global and this
// package deliberately has none (`"types": []` in its tsconfig). The rule is
// worth keeping for a ten-line regex: a package that cannot reach a global is a
// package that runs identically under Node, Metro and Vitest.
const HOST_PATTERN =
  /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/(?:[^@/]*@)?(\[[^\]]+\]|[^:/?#]+)/;

/**
 * The host a base URL points at, or null when the string is not a URL at all.
 *
 * The consent screen names the host rather than echoing the whole URL: the host
 * is the part that decides where the data goes, and a long path only buries it.
 */
export function resolveEndpointHost(baseUrl: string): string | null {
  const match = HOST_PATTERN.exec(baseUrl);
  if (!match) {
    return null;
  }

  const host = match[1] as string;
  // IPv6 literals arrive bracketed ("[::1]"); the brackets are URL syntax, not
  // part of the address anyone reads.
  return host.startsWith("[") ? host.slice(1, -1) : host;
}

export const providerConfigSchema = z.object({
  // `z.url()` alone is not enough: it reads "localhost:11434" as a URL whose
  // SCHEME is "localhost". That saves cleanly and then never works, because
  // consent is keyed on the host and there is no host to resolve — so the
  // request would be refused every time by a rule the settings form never
  // mentioned. Requiring a resolvable host here means a stored configuration
  // can never be one nobody can name.
  baseUrl: z.url().refine((value) => resolveEndpointHost(value) !== null, {
    message: "The endpoint address needs a scheme, like https://",
  }),
  api: providerApiSchema,
  // Optional on purpose. A locally hosted endpoint usually wants no key at all,
  // and requiring a placeholder would be a field nobody can fill in honestly.
  apiKey: z.string().optional(),
  // At least one, because a configuration naming no model cannot be used for
  // anything — the failure belongs here rather than at the first request.
  models: z.array(providerModelSchema).min(1),
  structuredOutput: structuredOutputModeSchema.optional(),
});

export type ProviderConfig = z.infer<typeof providerConfigSchema>;

// Loopback, the three RFC 1918 private ranges, and mDNS names. Anchored one by
// one rather than matched by prefix: "172." alone would call the public
// 172.32.0.0/12 space private, and `endsWith("localhost")` would do the same
// for "localhost.evil.com".
const LOCAL_HOST_PATTERNS = [
  /^localhost$/,
  /^::1$/,
  /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^192\.168\.\d{1,3}\.\d{1,3}$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/,
  /\.local$/,
];

/**
 * Whether a base URL points at the user's own machine or their own network.
 *
 * The consent screen leans on this. "This screenshot's text goes to a model on
 * your Mac" and "…goes to a company in another country" are not the same
 * promise, and the difference is not something a user should have to read out
 * of a URL themselves.
 */
export function isLocalEndpoint(baseUrl: string): boolean {
  const host = resolveEndpointHost(baseUrl);
  if (host === null) {
    return false;
  }

  return LOCAL_HOST_PATTERNS.some((pattern) => pattern.test(host));
}
