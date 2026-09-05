import type {
  ModelRecognitionResult,
  RecognitionFailureCause,
} from "@/features/recognition/model-recognition";

// What to tell the user when a screenshot did not turn into accounts.
//
// Pure, and importing only the TYPE of a recognition result, so it stays
// loadable by plain Node — the mapping is a rule worth testing on its own,
// and it would otherwise live inside a 400-line component where no runner
// could reach it.
//
// Every entry below is a DIFFERENT next step. Recognition runs on the device,
// so the only things that can go wrong are the device and the model — but
// "free up memory and restart", "the model couldn't read this screen, check
// what was filled in" and "something else went wrong, check what was filled
// in" are three separate pieces of advice, and a screen that cannot tell them
// apart will show the last one when it means one of the first two.
//
// One thing every FAILED-result message has in common: the engine's read is
// already on the form when it shows. So none of them may say "fill in the
// details manually" — that wording is reserved for the cases where nothing
// landed at all (`recognitionFailed`, `ocrUnsupported`).

/** The message key for a recognition that produced nothing usable. */
export type RecognitionIssue =
  /** The bundled model could not load or run (out of memory, unsupported device). */
  | "modelLoadFailed"
  /** The model answered, but never held the annotation contract. */
  | "modelUnusable"
  /** The model run broke off for a reason none of the above describes. */
  | "modelInterrupted"
  /** The pipeline ran and the screen simply held no accounts. */
  | "recognitionEmpty"
  /**
   * Recognition threw before the engine read anything, so the form is empty.
   * Never produced by `issueForRecognition` — a failed RESULT always carries
   * the engine's read — but it is part of the same vocabulary because the
   * uploader's catch clause reaches for it.
   */
  | "recognitionFailed";

// A `Record` rather than a `switch`: the compiler requires every cause to have
// an entry, so adding one to `RecognitionFailureCause` fails the build here
// instead of falling silently into a `default`. It also leaves no branch for a
// test to be unable to reach — see the coverage note in AGENTS.md.
const ISSUE_BY_CAUSE: Record<RecognitionFailureCause, RecognitionIssue> = {
  "load-failed": "modelLoadFailed",
  // The model answered with something that never held the annotation contract
  // on any of three attempts. On device there is no "try another endpoint":
  // the advice is to fill the form in by hand.
  "invalid-output": "modelUnusable",
  // Anything else the model call threw — a binding crash, a grammar that
  // failed to compile. NOT `recognitionFailed`: that copy says "fill in the
  // details manually", and by the time this mapping runs the engine's read is
  // already on the form. Telling the user to type over a form the app just
  // filled in, under a badge that says "Recognized", is the contradiction
  // this entry exists to avoid.
  unknown: "modelInterrupted",
};

export function issueForRecognition(
  result: ModelRecognitionResult,
): RecognitionIssue | null {
  if (result.status === "failed") {
    // A failure carries whatever the ENGINE read. When that is nothing either,
    // the failure messages are wrong in the way that matters: they tell the
    // user to check what was filled in, over a form where nothing was.
    //
    // "No accounts on this screen" is the honest verdict even for a device
    // failure, because the model cannot CREATE an account — regions come from
    // the engine — so retrying with more memory free would find nothing more.
    // Defensive rather than reachable today: the engine only reaches the model
    // when it grouped something, and every group it emits coerces to an
    // account. That is a rule in another package, not one this module can
    // assume.
    return result.accounts.length === 0
      ? "recognitionEmpty"
      : ISSUE_BY_CAUSE[result.cause];
  }

  // The pipeline ran and the screen held nothing. Worth its own message,
  // because unlike every failure above, retrying will not change it.
  return result.recognition.accounts.length === 0 ? "recognitionEmpty" : null;
}
