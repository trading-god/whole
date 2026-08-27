import {
  LlmError,
  type LlmFailureKind,
  type LlmUsage,
  isLocalEndpoint,
  resolveEndpointHost,
} from "@whole/llm";
import {
  type LayoutFingerprint,
  type OcrTextBlock,
  type ResolvedRecognition,
  recognizeWithModel,
} from "@whole/ocr";

import { createModelRunner } from "@/features/assets/model-runner";
import {
  hasConsentedTo,
  loadProviderConfig,
} from "@/features/assets/model-provider-store";

// The app-facing entry point: a screenshot's OCR blocks in, recognized accounts
// out — or a reason why not.
//
// Every reason here is one the USER can act on, which is the whole point of not
// collapsing them into a single failure. Under a bring-your-own endpoint nobody
// else can fix a mistyped key, an exhausted quota, or a model that will not
// hold the output contract, and each calls for a different next step.

/** Why a recognition could not happen, in terms a screen can act on. */
export type RecognitionFailureCause =
  | LlmFailureKind
  /** The model never produced an answer matching the contract. */
  | "invalid-output"
  | "unknown";

export type ModelRecognitionResult =
  | {
      status: "recognized";
      recognition: ResolvedRecognition;
      /** The layout this screen came from, for the template cache. */
      fingerprint: LayoutFingerprint;
      /** What the whole recognition cost, retries included. */
      usage: LlmUsage;
    }
  /** No endpoint configured — recognition is unavailable, not broken. */
  | { status: "not-configured" }
  /**
   * An endpoint is configured but the user has not agreed to send text there.
   *
   * `host` and `isLocal` are what the consent screen needs: naming the host is
   * more honest than echoing a URL, and a loopback address means something
   * entirely different from a company in another country.
   */
  | { status: "consent-required"; host: string; isLocal: boolean }
  | { status: "failed"; cause: RecognitionFailureCause; message: string };

export type ModelRecognitionOptions = {
  /** Institutions the user already holds accounts with, as a prior. */
  knownInstitutions?: readonly string[];
};

export async function recognizeAccountsWithModel(
  blocks: OcrTextBlock[],
  options: ModelRecognitionOptions = {},
): Promise<ModelRecognitionResult> {
  const config = await loadProviderConfig();
  if (config === null) {
    return { status: "not-configured" };
  }

  // Consent is recorded per HOST, so a configuration whose host cannot be read
  // cannot have been consented to. Failing here rather than falling back to the
  // raw URL keeps that invariant true: the alternative would compare consent
  // against a string that is not a host, and quietly never match.
  const host = resolveEndpointHost(config.baseUrl);
  if (host === null) {
    return {
      status: "failed",
      cause: "unknown",
      message: `The configured endpoint has no readable host: ${config.baseUrl}`,
    };
  }

  if (!(await hasConsentedTo(host))) {
    return {
      status: "consent-required",
      host,
      isLocal: isLocalEndpoint(config.baseUrl),
    };
  }

  // Totalled across turns rather than taken from the last one: every retry is a
  // turn the user paid for.
  const usage: LlmUsage = { inputTokens: 0, outputTokens: 0 };

  const runModel = createModelRunner({
    config,
    // The first configured model. Choosing among several is a settings
    // decision, and the config lists them in the order the user gave.
    model: config.models[0].id,
    fetchImpl: fetch,
    onUsage: (turn) => {
      usage.inputTokens += turn.inputTokens;
      usage.outputTokens += turn.outputTokens;
    },
  });

  try {
    const outcome = await recognizeWithModel(blocks, runModel, {
      knownInstitutions: options.knownInstitutions,
    });

    if (!outcome.ok) {
      return {
        status: "failed",
        cause: "invalid-output",
        message: outcome.reason,
      };
    }

    return {
      status: "recognized",
      recognition: outcome.recognition,
      fingerprint: outcome.fingerprint,
      usage,
    };
  } catch (error) {
    return {
      status: "failed",
      cause: error instanceof LlmError ? error.kind : "unknown",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
