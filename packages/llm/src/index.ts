// The package's only entry point.
//
// What it deliberately does NOT export is a client that performs anything: the
// transport is a parameter (`LlmFetch`), so this package stays free of globals
// and every failure path stays reachable from a plain unit test. The app owns
// the real fetch, the key, and the retry loop.
export {
  isLocalEndpoint,
  providerApiSchema,
  providerConfigSchema,
  providerModelSchema,
  resolveEndpointHost,
  structuredOutputModeSchema,
  type ProviderApi,
  type ProviderConfig,
  type StructuredOutputMode,
} from "./provider";

export { probeEndpoint, type ProbeResult } from "./probe";

export { buildChatRequest, type ChatPrompt, type ChatRequest } from "./request";

export {
  LlmError,
  sendChat,
  type ChatResult,
  type LlmFailureKind,
  type LlmFetch,
  type LlmResponse,
  type LlmUsage,
} from "./send";
