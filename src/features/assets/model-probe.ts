import {
  type ProbeResult,
  type ProviderConfig,
  probeEndpoint,
} from "@whole/llm";

// The app's binding for the endpoint probe: the pure package works out WHICH
// tier a host supports, and this hands it the platform's real `fetch`.
//
// It exists as its own module for the same reason `model-runner` does — that
// one line is the only place `@whole/llm` meets a global, and keeping it here
// is what lets the package stay free of one.
export function probeConfiguredEndpoint(
  config: ProviderConfig,
): Promise<ProbeResult> {
  return probeEndpoint(config, fetch);
}
