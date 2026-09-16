// Recognizing a BATCH of screenshots: the loop the add-account screen runs when
// the user picks several at once.
//
// Sequential, deliberately. Each recognition is an OCR pass plus a
// grammar-constrained decode over a multi-gigabyte local context, and running
// two at once on a phone does not halve the wait — it doubles the resident
// memory of the one thing most likely to be killed for using too much of it.
// Serially, the context loaded for the first screenshot is still warm for the
// second (`completeOnDevice` owns the idle timer), so the per-screenshot cost
// after the first is the decode alone.
//
// The loop reports each screenshot as it lands rather than only at the end,
// because a five-screenshot batch is a minute of waiting and a progress count
// is the difference between "working" and "hung".
//
// It is NOT the place recognition failures are explained: it collects one
// `ScreenshotIssue` per screenshot and lets the screen decide what to say, the
// same division `recognition-issue.ts` already draws.
import type { InstitutionId, RecognizedAccount } from "@whole/ocr";

import {
  type RecognitionIssue,
  issueForRecognition,
} from "@/features/recognition/recognition-issue";
import {
  EngineNotReadyError,
  RecognitionUnsupportedError,
  recognizeAccountFromScreenshot,
} from "@/features/recognition/screenshot-recognition";

/**
 * Everything one screenshot's recognition can fail with.
 *
 * The two beyond `RecognitionIssue` are properties of the DEVICE or the SETUP
 * rather than of a screenshot — this hardware cannot run OCR, or the chosen
 * engine has no model to run — which is why the loop stops on them instead of
 * carrying on to fail the same way on every remaining image.
 */
export type ScreenshotIssue =
  RecognitionIssue | "engineNotReady" | "ocrUnsupported";

/** One screenshot to recognize, with the dimensions the picker already knew. */
export type ScreenshotSource = {
  uri: string;
  width?: number;
  height?: number;
};

export type ScreenshotOutcome = {
  /** What the recognition produced, or the engine's read when the model failed. */
  accounts: RecognizedAccount[];
  /**
   * The institution the ENGINE detected, when it could place the screenshot.
   * `undefined` or `"unknown"` means it could not — `institutionName` is then
   * the only answer there is.
   */
  institutionId?: InstitutionId;
  /**
   * What the MODEL called the institution, free text.
   *
   * The app ignored this until batch recognition needed it, and the reason is
   * the batch: one screenshot's accounts are grouped under one institution, and
   * a batch spans several, so "which institution is this screenshot from" stops
   * being a single answer the screen can hold in one field. For an institution
   * the engine's 14-id enum knows, the localized catalog name is better and the
   * screen prefers it; for anything else this is all there is, and a name the
   * user can correct beats an empty field.
   */
  institutionName?: string;
  issue: ScreenshotIssue | null;
};

/** Whether this issue is about the device or the setup rather than the image. */
function stopsTheBatch(issue: ScreenshotIssue | null): boolean {
  return issue === "engineNotReady" || issue === "ocrUnsupported";
}

async function recognizeOne(
  source: ScreenshotSource,
): Promise<ScreenshotOutcome> {
  try {
    const result = await recognizeAccountFromScreenshot(
      source.uri,
      source.width,
      source.height,
    );
    // A failed recognition still carries the engine's read, exactly as the
    // single-screenshot path treats it: the user gets what was recognized AND
    // the reason the model could not finish, so they correct a form rather than
    // typing one.
    const accounts =
      result.status === "recognized"
        ? result.recognition.accounts
        : result.accounts;
    return {
      accounts,
      institutionId: accounts[0]?.institutionId,
      institutionName:
        result.status === "recognized"
          ? result.recognition.institution?.displayName
          : undefined,
      issue: issueForRecognition(result),
    };
  } catch (error) {
    return {
      accounts: [],
      issue:
        error instanceof EngineNotReadyError
          ? "engineNotReady"
          : error instanceof RecognitionUnsupportedError
            ? "ocrUnsupported"
            : "recognitionFailed",
    };
  }
}

/**
 * Recognizes each screenshot in turn, reporting every outcome as it lands.
 *
 * `onOutcome` is called once per screenshot with its index, so a caller can
 * render per-thumbnail state without waiting for the batch. `isCancelled` is
 * checked between screenshots and not within one: a recognition in flight
 * cannot be interrupted (the native decode owns the thread), but a batch that
 * lost its screen must not spend another forty seconds on the next image.
 *
 * The returned list is shorter than `sources` when the batch stopped early —
 * either cancelled, or stopped by an issue that would repeat on every
 * remaining screenshot.
 */
export async function recognizeScreenshots(
  sources: readonly ScreenshotSource[],
  onOutcome: (index: number, outcome: ScreenshotOutcome) => void,
  isCancelled: () => boolean = () => false,
): Promise<ScreenshotOutcome[]> {
  const outcomes: ScreenshotOutcome[] = [];
  for (const [index, source] of sources.entries()) {
    if (isCancelled()) {
      break;
    }
    const outcome = await recognizeOne(source);
    outcomes.push(outcome);
    onOutcome(index, outcome);
    if (stopsTheBatch(outcome.issue)) {
      break;
    }
  }
  return outcomes;
}
