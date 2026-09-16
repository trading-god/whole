// The recognition loop, HYBRID edition: the deterministic engine owns
// structure, the model owns semantics.
//
// The engine's pipeline (`parser.ts` → `account-grouping.ts`) clusters, groups
// and reads — accounts, balances, currencies, debt signs, last fours — with a
// 100% pass over the eval corpus. The model is asked only what rules cannot
// know: which institution this is when no brand appears on screen, what KIND
// of account each region shows beyond the keyword vocabulary, and which
// currency a domestic app means when it prints a bare number.
//
// The third question is newer than the other two, and it was chosen by
// measurement rather than intuition: the currency default is the largest single
// thing a missing institution config costs, because a figure nothing can
// denominate is dropped rather than shown. It is also the tier a picture could
// not supply — a bare "76,007.05" looks identical in every currency, which is
// what makes it a question for a model that knows what CMB is.
//
// The one screen the model cannot recover is IBKR, and it is not recoverable: a
// broker reports in the ACCOUNT'S base currency, which is the user's own setting
// rather than anything knowable about the institution. The model answers USD
// where the account is SGD — the wrong-currency case the prompt warns about, and
// the reason the prompt offers `none` at all. It is the argument for declaring
// `defaultCurrency` on a broker rather than leaving it inferred.
//
// The division is load-bearing and measured, not stylistic: a model doing the
// WHOLE job scores far below the engine on the same corpus, with account
// grouping the dominant failure. Letting it "help" with structure can only lose
// money; every value it reports here is verified against the region the engine
// already extracted before it is believed. The numbers behind both claims live
// in `packages/ocr-eval/README.md`, which is where they are produced — a copy
// here would go stale the next time the quant or the prompt changes.
//
// The model call is a PARAMETER, not something this module performs — the
// same injected seam as ever, which is what keeps this loop reachable from a
// plain unit test and puts the runtime (llama.rn on device, node-llama-cpp in
// the harness) behind it.
//
// There is deliberately no multi-turn agent loop. The whole screen is supplied
// at once, so the model has nothing to go and look up; more turns would buy
// latency and a more confidently held wrong answer. What the loop DOES do is
// tell the model exactly what was wrong with its last answer, which is the one
// thing a second attempt can act on.
import { z } from "zod";

import type { Currency } from "../contract/currency";
import type { InstitutionAblation } from "../institutions/ablation";
import type { OcrTextBlock } from "../contract/block";
import type { RecognizedAccount } from "../contract/recognized-account";

import { buildAnnotationPrompt } from "./annotate-prompt";
import {
  NO_HOME_CURRENCY,
  UNKNOWN_KIND,
  annotationKindSchema,
  homeCurrencySchema,
  institutionAnswerSchema,
  resolveInstitutionAnswer,
  type RecognizedInstitution,
} from "./annotation-fields";
import {
  assembleAssignedAccounts,
  lineCarriesAccountDigits,
  lineCarriesBalanceAmount,
} from "./account-grouping";
import {
  buildStructurePrompt,
  structureJsonSchema,
  structureSchema,
} from "./structure-prompt";
import { jsonSchemaToGrammar } from "./grammar";
import {
  groupScreen,
  groupToRecognized,
  kindWasGuessed,
  readScreen,
  type PipelineResult,
  type ScreenStructure,
} from "./parser";

/**
 * Three, and the third is the last.
 *
 * Past that the failure is not one a rewording fixes — the model cannot hold
 * the annotation contract — and continuing only spends the user's time to
 * tell them the same thing later.
 */
export const MAX_RECOGNITION_ATTEMPTS = 3;

/** One turn's worth of instructions, ready for whichever runtime is configured. */
export type RecognitionAttempt = {
  system: string;
  user: string;
  /**
   * The turn's schema compiled to a GBNF grammar, which makes a malformed
   * answer unreturnable rather than merely retried. Invariant across a turn's
   * attempts — the correction fed back changes what to say, not the shape of an
   * answer — so it is compiled once per turn, not per attempt. An EMPTY string
   * requests an unconstrained completion instead: every runtime treats "" as
   * "no grammar", which is how the settings Test's plain ping rides the same
   * contract.
   *
   * There is more than one, and a runtime must not assume otherwise: a screen
   * whose institution is known takes the annotation turn and one whose
   * institution is not takes the structure turn, so a runner that compiled the
   * first grammar it saw and reused it steers the wrong turn with it. The eval
   * harness did exactly that, and every annotation turn in a mixed run failed
   * on a field the grammar it was actually given does not have.
   */
  grammar: string;
  /**
   * The same schema as JSON Schema, for a runtime that constrains by schema
   * rather than by grammar — an OpenAI-compatible endpoint's
   * `response_format.json_schema`.
   *
   * Carried on the attempt rather than imported by the runner for the reason
   * above: the runner cannot know which turn this is, and one that reached for
   * a fixed schema would constrain a structure answer to the annotation shape
   * and reject every reply. `undefined` pairs with an empty `grammar` — an
   * unconstrained completion, which is what the settings Test's ping wants.
   */
  schema?: unknown;
};

/** Runs one turn and returns the model's raw text. */
export type RunModel = (attempt: RecognitionAttempt) => Promise<string>;

/**
 * The inference parameters every runtime answering a `RecognitionAttempt`
 * decodes with. The app's llama.rn runner and the eval harness's
 * node-llama-cpp runner both read them from here rather than picking their own
 * numbers — that, the shared grammar and the shared prompt are what make the
 * harness a verdict on what ships. (The chat templating around the turns is
 * still each runtime's own; `llama-run-model.ts` says what that does and does
 * not buy.)
 */
export const ANNOTATION_INFERENCE = {
  /**
   * The context one recognition needs: the system prompt plus the serialized
   * screen, with the JSON answer on top.
   *
   * 8192, not the 4096 the corpus would justify. The largest prompt the
   * 17 samples produce is IBKR's, at 2,766 characters over 26 lines — but
   * characters are the wrong unit to size this in: the target corpus is CJK,
   * where a character is often a whole token, so a denser screen (a broker's
   * positions list, an 80-line overview) closes that gap much faster than the
   * character count suggests. And each retry appends its correction to the
   * same turn.
   *
   * Overrunning is not a clean failure: llama.cpp truncates rather than
   * refusing, so the model would annotate a screen missing its top lines while
   * the region numbers still counted from the engine's full grouping — a
   * grammar-valid answer about the wrong regions. What the user would see is
   * "restart and free up memory", advice that cannot fix a long screenshot.
   * The KV cache this buys is a small fraction of the ~3 GB the weights
   * already cost, and eliding lines instead would hide a whole region from the
   * model.
   */
  contextWindow: 8192,
  /**
   * One turn's output ceiling. The answer is a small JSON annotation — a few
   * dozen tokens even for a screen holding several accounts — so 2048 is
   * headroom, not a target.
   */
  maxOutputTokens: 2048,
  /** The task is a contract, not a conversation; sampling adds nothing. */
  temperature: 0,
} as const;

export type ResolvedRecognition = {
  accounts: RecognizedAccount[];
  /**
   * What the model called the institution, free text.
   *
   * Read by the eval harness, which judges it by eye; the app does NOT consume
   * it yet — accounts carry the engine's `institutionId`, which is an enum the
   * i18n catalog is keyed by. The question stays in the turn anyway, and not
   * only for the harness: making it required is what got the bundled 2B model
   * to emit `homeCurrency` at all (see the package README), so dropping it
   * would be a re-measurement, not a deletion.
   */
  institution?: RecognizedInstitution;
};

type RecognitionOutcome =
  | {
      ok: true;
      recognition: ResolvedRecognition;
      attempts: number;
    }
  | {
      ok: false;
      /** What was wrong with the last answer, in the terms fed back to the model. */
      reason: string;
      attempts: number;
    };

// ── The annotation contract ────────────────────────────────────────────────

// The grammar's digit-range expansion is proportional to the bound, and a
// screenshot has never carried more than a few dozen regions. 63 keeps the
// expansion to two digits. A group past it is not shown to the model at all
// (see `annotatable` below) and keeps whatever the engine read — which is
// every field but the kind, and the kind only where the engine had to guess.
export const MAX_REGION_NUMBER = 63;

const annotationAccountSchema = z.object({
  /**
   * The 1-based region number the prompt printed.
   *
   * `min(1)`, not `nonnegative()`: the prompt numbers from 1, so a 0 could
   * never match a region — and the grammar advertising it as legal is worse
   * than dead, because a model that answered 0-based would produce a fully
   * contract-holding annotation with every kind off by one, and nothing to
   * retry. Rejecting 0 makes that answer a violation the loop can correct.
   */
  group: z.number().int().min(1).max(MAX_REGION_NUMBER),
  /** The region's kind, or `unknown` — required, for the reason below. */
  kind: annotationKindSchema,
});

// Every field is REQUIRED, with `"unknown"` and `"none"` as the ways to
// decline, and that is a measurement rather than a preference: as optional
// fields the bundled 2B model simply never emitted them. See "Every annotation
// field is required" in the package README for the sample that showed it. A new
// field here should be required with a decline value, never optional.
const annotationSchema = z.object({
  institution: institutionAnswerSchema,
  homeCurrency: homeCurrencySchema,
  /**
   * One entry per region the prompt printed. An empty array is the answer for
   * a screen with no regions — required, not defaulted, because a default is
   * how the grammar learns the key is skippable, and a skipped `accounts` is
   * indistinguishable from "no region has a kind": every region would then
   * fall through to the engine's `cash` fallback with nothing retried.
   *
   * Bounded by the same number the region ids are: there cannot be more
   * annotations than annotatable regions, and an unbounded array is one more
   * place a repetition loop can run to the output ceiling and come back as
   * unparseable JSON three times over.
   */
  accounts: z.array(annotationAccountSchema).max(MAX_REGION_NUMBER),
});

type AccountAnnotation = z.infer<typeof annotationSchema>;

/**
 * The JSON Schema the grammar is compiled from.
 *
 * Derived from the zod schema the recognition loop validates every answer
 * against — two hand-maintained copies of a contract drift, and the drift
 * would be silent.
 */
export function annotationJsonSchema(): unknown {
  return z.toJSONSchema(annotationSchema, { io: "input" });
}

// The JSON Schema and the grammar a turn constrains its answer with. Both are
// pure functions of a module-level zod schema, so each is derived once and
// shared by every recognition that uses it — the eval harness replays seventeen
// samples against one process, and the app recognizes one screenshot after
// another. Keyed by turn, because there are now two schemas and a screen uses
// one or the other depending on whether its institution is known.
//
// The pair is cached TOGETHER because it travels together: a `RecognitionAttempt`
// carries both (the grammar for a local llama.cpp, the schema for an endpoint's
// `response_format`), and caching only the grammar left `z.toJSONSchema` walking
// the schema again on every screenshot — the same waste `remote-runner.ts`
// stopped doing per request.
const turnConstraints = new Map<
  string,
  Promise<{ grammar: string; schema: unknown }>
>();

function turnConstraint(
  turn: string,
  jsonSchema: () => unknown,
): Promise<{ grammar: string; schema: unknown }> {
  const cached = turnConstraints.get(turn);
  if (cached !== undefined) {
    return cached;
  }
  const schema = jsonSchema();
  const promise = jsonSchemaToGrammar(schema)
    .then((grammar) => ({ grammar, schema }))
    .catch((error: unknown) => {
      // Not cached as a failure, for the same reason the app's context and JSI
      // singletons are not: a memoized rejection makes every later recognition
      // fail with it for the life of the process, and the "try again" the copy
      // offers could never work. Deterministic today — the schemas are module
      // constants — but this is the one memoization that would keep a failure.
      turnConstraints.delete(turn);
      throw error;
    });
  turnConstraints.set(turn, promise);
  return promise;
}

// A grammar makes a code fence unreturnable, so on both shipping runtimes this
// is dead defence — but `runModel` is an INJECTED seam, and the engine cannot
// verify that whatever answered it actually steered on `attempt.grammar`. A
// runtime that quietly ignored it would otherwise spend all three attempts on
// punctuation.
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
 * Applies the model's annotations to the engine's accounts.
 *
 * Every annotation is verified against the region it names before it is
 * believed:
 * - a region number past what the engine grouped, or a region the engine
 *   dropped (it carried nothing worth reporting), is skipped;
 * - a `kind` is honored only where the engine had to GUESS: a keyword hit on
 *   the account's name, or a known institution's default-kind prior, outranks
 *   the model. Measured on the corpus this is what keeps the hybrid at parity
 *   with the engine — the model's overrides disagreed with correct reads
 *   where either signal existed — while its semantic read still covers the
 *   product names no vocabulary anticipated on an institution no config
 *   knows.
 */
function resolveRecognition(
  { groups, institutionId, institutionConfig }: PipelineResult,
  annotation: AccountAnnotation,
): ResolvedRecognition {
  // Keyed by the REGION NUMBER the prompt printed, which is how an annotation
  // addresses an account. One map rather than a pair keyed by object identity
  // plus a scan to invert them: the annotations arrive with the number already
  // in hand.
  //
  // The guessed-kind flag cannot be read back off the account —
  // `groupToRecognized` falls back to "cash", so a guessed kind is
  // indistinguishable from a read one by the time it returns. `kindWasGuessed`
  // is the one definition both turns ask.
  const accounts: RecognizedAccount[] = [];
  const byRegion = new Map<
    number,
    { account: RecognizedAccount; guessedKind: boolean }
  >();
  groups.forEach((group, index) => {
    const read = groupToRecognized(group, institutionConfig);
    if (read !== null) {
      const account = { ...read, institutionId };
      accounts.push(account);
      byRegion.set(index + 1, {
        account,
        guessedKind: kindWasGuessed(group, institutionConfig),
      });
    }
  });

  for (const { group, kind } of annotation.accounts) {
    const region = byRegion.get(group);
    if (kind !== UNKNOWN_KIND && region?.guessedKind) {
      region.account.kind = kind;
    }
  }

  const institution = resolveInstitutionAnswer(annotation.institution);
  return institution === undefined ? { accounts } : { accounts, institution };
}

/**
 * Re-groups the screen denominated in the currency the model inferred.
 *
 * The engine resolves a balance's currency during grouping — long before the
 * model is asked anything — and a figure nothing could denominate is dropped
 * there. So an inferred currency cannot be patched onto the finished result;
 * the lines have to be grouped again with it in hand. Only the grouping stage
 * re-runs: `readScreen`'s clustering, classifiers and institution detection are
 * functions of the blocks alone, so `structure` is reused as is.
 *
 * The annotations address regions by the number the PROMPT printed, which is
 * the FIRST grouping's numbering — so this is only safe if a supplied currency
 * cannot move a region boundary. It cannot, and structurally rather than as an
 * observation: `groupIntoAccounts` decides whether to emit a region with
 * `groupHasContent`, and whether one counts as identified from its name and
 * last four, all before `finish` — which is the only place `defaultCurrency` is
 * read, and it only fills in balances. There is deliberately no runtime guard
 * comparing the two shapes: it would be a branch nothing could reach.
 * `index-contract.test.ts` pins the invariant over the real corpus instead, so
 * a grouping change that ever made currency structural fails there rather than
 * silently misplacing an annotation here.
 *
 * A configured institution keeps its own currency and is not re-grouped at all.
 * `groupScreen` enforces that precedence anyway; this check is what stops the
 * work being spent to arrive at the same answer.
 */
function redenominate(
  structure: ScreenStructure,
  first: PipelineResult,
  homeCurrency: Currency | undefined,
): PipelineResult {
  return homeCurrency === undefined ||
    first.institutionConfig.defaultCurrency !== undefined
    ? first
    : groupScreen(structure, homeCurrency);
}

/** Knobs for a replay, never for the app. */
/**
 * The turns recognition can run, as a value the harness can validate against.
 *
 * Exported as a list rather than only as a type for the same reason
 * `INSTITUTION_ABLATIONS` is: `pnpm eval:ocr:llama -- --turn <name>` has to
 * reject a typo, and a list retyped in the CLI would drift from the turns the
 * engine actually implements.
 */
export const RECOGNITION_TURNS = ["structure", "annotation"] as const;

export type RecognitionTurn = (typeof RECOGNITION_TURNS)[number];

export type RecognitionOptions = {
  /**
   * Removes one tier of institution config from BOTH passes — the ablation
   * harness's seam, the same one `PipelineOptions` carries and for the same
   * reason (`institutions/ablation.ts`).
   *
   * It is what lets the on-device gate measure the question this turn was
   * extended to answer: with the corpus's institutions all configured, a
   * plain run cannot show whether the model's home currency helps, because
   * the engine already had one. Ablated, it can.
   */
  ablate?: InstitutionAblation;
  /**
   * Forces one turn regardless of whether the institution is known.
   *
   * The seam for re-deciding the gate below, which is the one thing about this
   * module that is a judgement rather than a measurement. "Configured
   * institution" is a proxy for "layout the rules were written against", and it
   * is an imperfect one — a config is authored against ONE screen, so the same
   * bank's account-detail page is as unfamiliar as a bank nothing knows. This
   * is how the corpus answers whether the proxy is worth keeping: run the real
   * corpus through `structure` and see whether 17/17 survives.
   */
  turn?: RecognitionTurn;
};

/**
 * Runs one turn to a validated answer, retrying with the specific violation fed
 * back.
 *
 * Shared by both turns, because the retry policy is a property of asking a
 * small model for structured output, not of what is being asked. What the loop
 * DOES do is tell the model exactly what was wrong with its last answer, which
 * is the one thing a second attempt can act on; there is deliberately no
 * multi-turn agent loop, because the whole screen is supplied at once and the
 * model has nothing to go and look up.
 */
async function runTurn<T>(
  runModel: RunModel,
  prompt: { system: string; user: string },
  constraint: { grammar: string; schema: unknown },
  schema: z.ZodType<T>,
): Promise<
  | { ok: true; data: T; attempts: number }
  | { ok: false; reason: string; attempts: number }
> {
  // Assigned before every `continue`, and read once the attempts run out. Held
  // as a plain string rather than `string | null` so the exhausted-attempts
  // return needs no fallback: a `?? "…"` there would be a branch no test could
  // ever reach, which is exactly the kind of thing AGENTS.md forbids hiding
  // behind an ignore comment.
  let correction = "";

  for (let attempt = 1; attempt <= MAX_RECOGNITION_ATTEMPTS; attempt += 1) {
    const answer = await runModel({
      system: prompt.system,
      user: attempt === 1 ? prompt.user : `${prompt.user}\n\n${correction}`,
      grammar: constraint.grammar,
      schema: constraint.schema,
    });

    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJson(answer));
    } catch {
      correction =
        "Your previous answer was not valid JSON. Return only the JSON object, with no prose and no code fence.";
      continue;
    }

    const validated = schema.safeParse(parsed);
    if (!validated.success) {
      // The specific violation, by field. A retry told only "that was wrong"
      // has nothing to change.
      const problems = validated.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ");
      correction = `Your previous answer did not match the required shape: ${problems}. Fix those fields and answer again.`;
      continue;
    }

    return { ok: true, data: validated.data, attempts: attempt };
  }

  return { ok: false, reason: correction, attempts: MAX_RECOGNITION_ATTEMPTS };
}

/**
 * Recognizes a screen whose institution nothing knows, by asking the model
 * which lines belong to which account.
 *
 * The engine's grouping is not consulted at all here, and that is the point.
 * Where no `InstitutionConfig` was written against the layout, the state
 * machine does not merely miss accounts — it merges them, and `finish` sums the
 * merged region into one balance the screen never printed. A four-account US
 * overview comes back as one account holding the sum of all four. The synthetic
 * corpus measures that at 0/12 samples and 15% on accountName, and every one of
 * the failures has that shape.
 *
 * What the model supplies is assignment, never values: `assembleAssignedAccounts`
 * reads each name, last four and figure off the same tokens the rules parse, so
 * the worst a wrong answer can do is file a real figure under the wrong real
 * name — where the rules' failure mode is a figure that exists nowhere.
 *
 * An empty answer is returned as empty. Falling back to the rules' read would
 * put exactly the fabricated total back on the form, under a badge saying the
 * screenshot was recognized — and this repo's rule for money is that a missing
 * figure beats a wrong one (`convertCurrency` returns null rather than 0 for
 * the same reason).
 */
async function recognizeByAssignment(
  structure: ScreenStructure,
  runModel: RunModel,
): Promise<RecognitionOutcome> {
  const lines = structure.classified.map((line) => ({
    text: line.text,
    // The engine's own reading, not a hint: a line it parsed no figure on
    // cannot become a balance however it is assigned, because
    // `assembleAssignedAccounts` drops the reference. Marking them tells the
    // model which answers are available rather than which are right.
    //
    // Asked through the READER rather than off the token roles, for the same
    // reason `#` is: the roles alone said yes to a row whose only figure was an
    // explicitly `+`-signed gain, which `balanceAmountsOf` then drops — so the
    // model was invited to assign a balance that came back empty.
    hasAmount: lineCarriesBalanceAmount(line),
    // The digits an account is identified by, as the engine reads them — the
    // same question `lastFourFromLine` answers, asked of the line rather than
    // of a chosen one, so a `#` never marks a line that could not yield a last
    // four.
    hasDigits: lineCarriesAccountDigits(line),
  }));

  // No figure anywhere is no account anywhere, and it is the honest verdict
  // rather than merely the cheap one: on a memory-tight device, loading three
  // gigabytes to arrive at `[]` can FAIL, and the user would be told to free up
  // memory over a screenshot whose real verdict is "no accounts on this
  // screen". An account with no figure is only worth a draft beside one that
  // has one — the form's `isWorthDrafting` says the same thing from its end.
  if (!lines.some((line) => line.hasAmount)) {
    return { ok: true, recognition: { accounts: [] }, attempts: 0 };
  }

  const turn = await runTurn(
    runModel,
    buildStructurePrompt(lines),
    await turnConstraint("structure", structureJsonSchema),
    structureSchema,
  );
  if (!turn.ok) {
    return { ok: false, reason: turn.reason, attempts: turn.attempts };
  }

  const { homeCurrency } = turn.data;
  // The answer's accounts ARE the assignments — each carries the three line
  // numbers `assembleAssignedAccounts` reads plus the kind, and the assembled
  // list stays index-aligned with them (a dropped assignment leaves a `null`),
  // so the kind is read back off the same entry rather than off a second list
  // that has to be kept parallel to this one.
  const assembled = assembleAssignedAccounts(
    structure.classified,
    turn.data.accounts,
    structure.institutionConfig,
    homeCurrency === NO_HOME_CURRENCY ? undefined : homeCurrency,
  );

  const accounts: RecognizedAccount[] = [];
  assembled.forEach((group, index) => {
    if (group === null) {
      return;
    }
    const read = groupToRecognized(group, structure.institutionConfig);
    if (read === null) {
      return;
    }
    // The same precedence the annotation turn gives a kind, and for the same
    // measured reason: a keyword hit on the account's own name outranks the
    // model, which disagreed with correct reads wherever that signal existed.
    // On an unknown institution there is no `defaultKind` to outrank it either,
    // so the model's answer is what covers the product names no vocabulary
    // anticipated — but the config is still asked, because `options.turn`
    // forces this path onto CONFIGURED institutions and that is precisely what
    // `pnpm eval:ocr:llama -- --turn structure` runs. Dropping the clause there
    // let the model overwrite a declared `defaultKind` ("crypto" on OKX,
    // "investment" on IBKR), so the gate would have measured a kind rule that
    // never ships.
    const answered = turn.data.accounts[index]?.kind;
    const kind =
      kindWasGuessed(group, structure.institutionConfig) &&
      answered !== undefined &&
      answered !== UNKNOWN_KIND
        ? answered
        : read.kind;
    accounts.push({
      ...read,
      kind,
      institutionId: structure.institutionId,
    });
  });

  const institution = resolveInstitutionAnswer(turn.data.institution);
  return {
    ok: true,
    recognition:
      institution === undefined ? { accounts } : { accounts, institution },
    attempts: turn.attempts,
  };
}

/**
 * Recognizes the accounts on a screen.
 *
 * Which turn runs depends on what the engine already knows about the
 * institution, and the split is measured rather than stylistic:
 *
 * - a **configured** institution takes the ANNOTATION turn. The engine's
 *   grouping passes 17/17 of the real corpus, a model doing that job scores far
 *   below it, and letting one "help" with structure can only lose money. The
 *   model is asked only what rules cannot know.
 * - an **unknown** institution takes the STRUCTURE turn. There the engine's
 *   grouping is not 100%, it is 0/12 over the synthetic corpus, and its
 *   failures fabricate balances rather than miss them. See
 *   `recognizeByAssignment`.
 *
 * A well-formed annotation that names no known region is NOT a retry: the
 * model answered, and `resolveRecognition` dropped what it could not place.
 * Asking again would put the same question to the same model and get the same
 * reply.
 *
 * Errors thrown by `runModel` propagate untouched. A load failure or an
 * exhausted runtime is not something a differently-worded prompt fixes, and
 * retrying it three times only delays telling the user what to do about it.
 */
export async function recognizeWithModel(
  blocks: OcrTextBlock[],
  runModel: RunModel,
  options: RecognitionOptions = {},
): Promise<RecognitionOutcome> {
  const structure = readScreen(blocks, options.ablate);

  if (
    options.turn === "structure" ||
    (options.turn === undefined && structure.institutionId === "unknown")
  ) {
    return recognizeByAssignment(structure, runModel);
  }

  const first = groupScreen(structure);
  const { classified, groups } = first;

  // Nothing to annotate, so nothing to ask. An answer could not change this
  // result: there is no region for a kind to attach to, a home currency cannot
  // conjure one (a supplied currency never moves a region boundary — the
  // invariant `redenominate` rests on), and the institution name has no
  // consumer. Skipping is not just the cheap path but the honest one: on a
  // memory-tight device, loading three gigabytes to arrive at `[]` can FAIL,
  // and the user would be told to free up memory over a screenshot whose real
  // verdict is "no accounts on this screen".
  if (groups.length === 0) {
    return { ok: true, recognition: { accounts: [] }, attempts: 0 };
  }

  // Only the regions the grammar can address. A group past the bound cannot be
  // NAMED by the model — the compiled digit range makes a higher number
  // undecodable — so it must not be numbered in the prompt either: shown with a
  // region label it cannot answer with, the model's kind for it can only come
  // back as some number in range, landing on a different account. Its lines
  // still appear, unprefixed, as screen context for the institution question.
  const annotatable = groups.slice(0, MAX_REGION_NUMBER);

  // Region numbers are 1-based against the classified lines; a line the
  // engine grouped carries the region it landed in, and everything else is
  // unprefixed — the institution question is answered from the whole screen.
  const regionOfLine = new Array<number | undefined>(classified.length);
  annotatable.forEach((group, regionIndex) => {
    for (const lineNumber of group.lineNumbers) {
      const lineIndex = lineNumber - 1;
      if (lineIndex >= 0 && lineIndex < regionOfLine.length) {
        regionOfLine[lineIndex] = regionIndex + 1;
      }
    }
  });

  const turn = await runTurn(
    runModel,
    buildAnnotationPrompt(classified, regionOfLine, annotatable),
    await turnConstraint("annotation", annotationJsonSchema),
    annotationSchema,
  );
  if (!turn.ok) {
    return { ok: false, reason: turn.reason, attempts: turn.attempts };
  }

  const { homeCurrency } = turn.data;
  const read = redenominate(
    structure,
    first,
    homeCurrency === NO_HOME_CURRENCY ? undefined : homeCurrency,
  );
  return {
    ok: true,
    recognition: resolveRecognition(read, turn.data),
    attempts: turn.attempts,
  };
}
