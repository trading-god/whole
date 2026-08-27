import type {
  ModelRecognitionResult,
  RecognitionFailureCause,
} from "@/features/assets/model-recognition";

// What to tell the user when a screenshot did not turn into accounts.
//
// Pure, and importing only the TYPE of a recognition result, so it stays
// loadable by plain Node — the mapping is a rule worth testing on its own,
// and it would otherwise live inside a 400-line component where no runner
// could reach it.
//
// Every entry below is a DIFFERENT next step. Under a bring-your-own endpoint
// the user is the only person who can fix any of these, and "go and set up a
// model", "agree to the destination", "your key is wrong", "you are out of
// quota", "you are offline" and "that model cannot do this" are six separate
// pieces of advice. Collapsing them into one "recognition failed" would leave
// the user re-uploading the same screenshot against a problem no upload fixes —
// which is exactly what the old single failure state did.

/** The message key for a recognition that produced nothing usable. */
export type RecognitionIssue =
  /** No model endpoint configured yet. */
  | "modelNotConfigured"
  /** Configured, but the user has not agreed to send text to this host. */
  | "modelConsentRequired"
  /** The endpoint rejected the credential. */
  | "modelUnauthorized"
  /** The endpoint's quota is exhausted for now. */
  | "modelRateLimited"
  /** The request never reached the endpoint. */
  | "modelOffline"
  /** The endpoint is there and answering with a fault. */
  | "modelUnavailable"
  /** The endpoint answered, but its model cannot hold the output contract. */
  | "modelUnusable"
  /** The pipeline ran and the screen simply held no accounts. */
  | "recognitionEmpty"
  /** Something went wrong that none of the above describes. */
  | "recognitionFailed";

// A `Record` rather than a `switch`: the compiler requires every cause to have
// an entry, so adding one to `RecognitionFailureCause` fails the build here
// instead of falling silently into a `default`. It also leaves no branch for a
// test to be unable to reach — see the coverage note in AGENTS.md.
const ISSUE_BY_CAUSE: Record<RecognitionFailureCause, RecognitionIssue> = {
  unauthorized: "modelUnauthorized",
  "rate-limited": "modelRateLimited",
  network: "modelOffline",
  server: "modelUnavailable",
  // A model that answers with prose and one that answers with a truncated body
  // are the same problem to the person holding the phone: this endpoint's model
  // cannot do the job, so try another one.
  malformed: "modelUnusable",
  "invalid-output": "modelUnusable",
  unknown: "recognitionFailed",
};

export function issueForRecognition(
  result: ModelRecognitionResult,
): RecognitionIssue | null {
  if (result.status === "not-configured") {
    return "modelNotConfigured";
  }

  if (result.status === "consent-required") {
    return "modelConsentRequired";
  }

  if (result.status === "failed") {
    return ISSUE_BY_CAUSE[result.cause];
  }

  // The pipeline ran and the screen held nothing. Worth its own message,
  // because unlike every failure above, retrying will not change it.
  return result.recognition.accounts.length === 0 ? "recognitionEmpty" : null;
}
