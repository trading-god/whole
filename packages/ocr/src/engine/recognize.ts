// The recognition loop: blocks in, resolved accounts out, with the model call
// injected.
//
// The model call is a PARAMETER, not something this module performs. That is
// what keeps the loop — including every retry path and every way an answer can
// be rejected — reachable from a plain unit test, and it is why the transport,
// the API key and the provider config live in the app rather than here.
//
// There is deliberately no multi-turn agent loop. The whole screen is supplied
// at once, so the model has nothing to go and look up; more turns would buy
// latency and a more confidently held wrong answer. What the loop DOES do is
// tell the model exactly what was wrong with its last answer, which is the one
// thing a second attempt can act on.
import type { OcrTextBlock } from "../contract/block";

import { type LayoutFingerprint, layoutFingerprint } from "./fingerprint";
import { buildGrid } from "./grid";
import {
  RECOGNITION_SCHEMA_NAME,
  buildRecognitionPrompt,
  recognitionJsonSchema,
} from "./prompt";
import {
  type ResolvedRecognition,
  recognitionSelectionSchema,
  resolveRecognition,
} from "./resolve";

/**
 * Three, and the third is the last.
 *
 * Past that the failure is not one a rewording fixes — the endpoint's model
 * cannot hold the contract — and continuing only spends the user's tokens to
 * tell them the same thing later.
 */
export const MAX_RECOGNITION_ATTEMPTS = 3;

/** One turn's worth of instructions, ready for whichever endpoint is configured. */
export type RecognitionAttempt = {
  system: string;
  user: string;
  schemaName: string;
  schema: unknown;
};

/** Runs one turn and returns the model's raw text. */
export type RunModel = (attempt: RecognitionAttempt) => Promise<string>;

export type RecognitionOptions = {
  knownInstitutions?: readonly string[];
};

export type RecognitionOutcome =
  | {
      ok: true;
      recognition: ResolvedRecognition;
      /** The layout this screen came from, for the template cache. */
      fingerprint: LayoutFingerprint;
      attempts: number;
    }
  | {
      ok: false;
      /** What was wrong with the last answer, in the terms fed back to the model. */
      reason: string;
      attempts: number;
    };

// A model told to return JSON very often returns it inside a code fence, and in
// prompt mode nothing on the wire stops it. Failing there would spend three
// attempts on punctuation.
function extractJson(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = (fenced?.[1] ?? text).trim();

  // Prose either side of the object is the same class of problem: the answer is
  // in there, and the braces say where.
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  return start !== -1 && end > start
    ? candidate.slice(start, end + 1)
    : candidate;
}

/**
 * Recognizes the accounts on a screen, retrying with feedback when the model's
 * answer does not hold the contract.
 *
 * A well-formed answer that resolves to nothing is NOT a retry: the model
 * answered, and the resolver dropped what it could not resolve. Asking again
 * would put the same question to the same model and get the same reply.
 *
 * Errors thrown by `runModel` propagate untouched. A mistyped key or an
 * exhausted quota is not something a differently-worded prompt fixes, and
 * retrying it three times only delays telling the user what to do about it.
 */
export async function recognizeWithModel(
  blocks: OcrTextBlock[],
  runModel: RunModel,
  options: RecognitionOptions = {},
): Promise<RecognitionOutcome> {
  const grid = buildGrid(blocks);
  const { system, user } = buildRecognitionPrompt(grid, options);
  const schema = recognitionJsonSchema();
  const fingerprint = layoutFingerprint(blocks);

  // Assigned before every `continue`, and read once the attempts run out. Held
  // as a plain string rather than `string | null` so the exhausted-attempts
  // return needs no fallback: a `?? "…"` there would be a branch no test could
  // ever reach, which is exactly the kind of thing AGENTS.md forbids hiding
  // behind an ignore comment.
  let correction = "";

  for (let attempt = 1; attempt <= MAX_RECOGNITION_ATTEMPTS; attempt += 1) {
    const answer = await runModel({
      system,
      user: attempt === 1 ? user : `${user}\n\n${correction}`,
      schemaName: RECOGNITION_SCHEMA_NAME,
      schema,
    });

    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJson(answer));
    } catch {
      correction =
        "Your previous answer was not valid JSON. Return only the JSON object, with no prose and no code fence.";
      continue;
    }

    const validated = recognitionSelectionSchema.safeParse(parsed);
    if (!validated.success) {
      // The specific violation, by field. A retry told only "that was wrong"
      // has nothing to change.
      const problems = validated.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ");
      correction = `Your previous answer did not match the required shape: ${problems}. Fix those fields and answer again.`;
      continue;
    }

    return {
      ok: true,
      recognition: resolveRecognition(blocks, validated.data),
      fingerprint,
      attempts: attempt,
    };
  }

  return {
    ok: false,
    reason: correction,
    attempts: MAX_RECOGNITION_ATTEMPTS,
  };
}
