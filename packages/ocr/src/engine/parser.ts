// Orchestrates the OCR semantic pipeline: clusters flat blocks into visual
// lines, classifies row roles, groups into tentative accounts, then emits the
// app's `RecognizedAccount[]` contract. The output is validated with the same
// pure schemas the rest of the feature uses (`lastFourDigitsSchema`) so "what
// is a valid recognized account" is defined once, and the parser's heuristics
// stay on the "mostly-correct editable draft" side of perfect.
//
// This module is intentionally PURE (no React Native / Expo imports): it's
// shared by the RN app and the Node eval harness
// (`packages/ocr-eval/src/run-eval.ts`), which replays recorded OCR blocks
// through it directly.
//
// Tracing: `parseOcrBlocksTraced` runs the same pipeline and also returns the
// intermediate stages (clustered lines, per-line roles, grouped accounts with
// their source line indexes). Trace data exists for diagnosis — it is what
// `pnpm ocr --trace` prints when the answer is wrong and the question is which
// rule decided it; production code calls `parseOcrBlocks`, which returns a bare
// `RecognizedAccount[]`.
import { lastFourDigitsSchema } from "../contract/asset-kind";
import type { Currency } from "../contract/currency";
import { detectAssetKind } from "./kind";
import { classifyRow, type RowRole } from "./line-classify";
import { clusterIntoLines } from "./line-clustering";
import { groupIntoAccounts, type OcrAccountGroup } from "./account-grouping";
import type { InstitutionId } from "../contract/institution";
import type { InstitutionConfig } from "../institutions/config";
import {
  ablateInstitution,
  type InstitutionAblation,
} from "../institutions/ablation";
import { resolveInstitutionConfig } from "../institutions/detect";
import { classifyTokens, type TokenWithRole } from "./token-classify";
import type { RecognizedAccount } from "../contract/recognized-account";
import type { OcrTextBlock } from "../contract/block";

export type OcrTrace = {
  classified: ClassifiedLine[];
  groups: OcrAccountGroup[]; // includes lineNumbers
  institutionId: InstitutionId; // detected institution id (institutions/detect)
};

// Builds a line's joined text and its per-token roles. `classifyTokens` does
// the word-level labeling (currency / amount / cardNumber / accountName / ...);
// the grouping step consumes those roles directly instead of re-splitting the
// joined text. Center-x is derived from the token's box for column-aligned
// multi-currency parsing.
function toStructuredLine(line: OcrTextBlock[]): {
  text: string;
  tokens: TokenWithRole[];
} {
  const text = line.map((b) => b.text).join(" ");
  return { text, tokens: classifyTokens(line, text) };
}

// A line with its row role and per-token roles, plus a 1-based index for the
// eval trace. Row role drives grouping; token roles feed the grouping step
// directly instead of it re-splitting the joined text.
type ClassifiedLine = {
  index: number; // 1-based
  text: string;
  role: RowRole;
  tokens: TokenWithRole[]; // per-token roles (token-level classifier output)
};

/** Knobs that change how a replay runs, never how the app runs. */
export type PipelineOptions = {
  /**
   * Removes one tier of the detected institution's config before grouping.
   *
   * The ablation harness's seam, and the only caller: it is how the corpus
   * measures what per-institution configuration is worth when the institution
   * is one nothing knows. See `institutions/ablation.ts`. Absent on every app
   * path, which is why it is an option rather than an argument.
   */
  ablate?: InstitutionAblation;
};

/**
 * Everything the pipeline reads out of the BLOCKS alone: the clustered,
 * classified lines and the institution config detection routed them to.
 *
 * Split out from grouping because the hybrid loop groups the same screen
 * twice — once to prompt the model, once with the home currency it inferred —
 * and none of this stage depends on that currency. Re-running it would re-do
 * the clustering and both classifiers to change one argument to the last step.
 */
export type ScreenStructure = {
  classified: ClassifiedLine[];
  institutionId: InstitutionId;
  /** As detected, and as ablated: the caller's fallback currency is not in it. */
  institutionConfig: InstitutionConfig;
};

/** The grouped screen: the structure above, plus the accounts read out of it. */
export type PipelineResult = ScreenStructure & {
  groups: OcrAccountGroup[];
};

// Stage one: clusters blocks into lines, labels row roles and per-token roles,
// and resolves the detected institution's config. A pure function of the blocks
// (and, for a replay, the ablation) — nothing here depends on the caller.
//
// Exported because the model pipeline (`recognize.ts`) reads the SAME structure
// and then asks the model to annotate the regions — the hybrid's whole premise
// is that the engine, not the model, decides what an account IS.
export function readScreen(
  blocks: OcrTextBlock[],
  ablate?: InstitutionAblation,
): ScreenStructure {
  // The typographic minus (U+2212) normalized to ASCII before anything reads a
  // sign. Apple Vision emits it for a real minus glyph, and every sign rule in
  // the engine — `NUMBER_SOURCE`, `anchoredAmountRegex`, the `-<currency>`
  // merge, `foldLeadingSign` — tests ASCII, so the character was dropped as
  // noise and a card's debt was reported as an asset. Normalized here, at the
  // one place every path enters, rather than in four patterns that must agree.
  const lines = clusterIntoLines(
    blocks.map((block) => ({
      ...block,
      text: block.text.replace(/\u2212/g, "-"),
    })),
  );
  const classified = lines.map((line, index) => {
    const { text, tokens } = toStructuredLine(line);
    return { text, role: classifyRow(text), tokens, index: index + 1 };
  });
  // Detect which institution this screenshot belongs to from the labeled
  // tokens; grouping then runs with that institution's config (icon tags,
  // equivalent-total pattern, product keywords) layered on the shared defaults.
  // "unknown" runs with the shared defaults only.
  const detected = resolveInstitutionConfig(classified.map((l) => l.tokens));
  // The ablation is applied AFTER detection, not instead of it: what is being
  // measured is the config's contribution, and short-circuiting detection
  // would also remove the routing evidence the report reads. It belongs to the
  // structure, so a second grouping pass cannot forget to carry it.
  const { institutionId, config } =
    ablate === undefined ? detected : ablateInstitution(detected, ablate);
  return { classified, institutionId, institutionConfig: config };
}

/**
 * Stage two: groups the classified lines into accounts.
 *
 * `inferredCurrency` denominates bare figures a MODEL supplied a home currency
 * for. It is passed alongside the config rather than folded into
 * `defaultCurrency`, because the two do not rank the same: a configured
 * currency was checked against a real screen and outranks a currency printed
 * below the figure, while an inference ranks below everything the screen states
 * (`finish` in `account-grouping.ts` holds that order). The annotation turn
 * gives `kind` the same precedence, for the same reason.
 *
 * It is an argument to THIS stage rather than to the pipeline because the
 * engine resolves a balance's currency during grouping, long before the model
 * is asked anything, and a figure nothing could denominate is dropped there —
 * so an inferred currency has to arrive as a re-grouping, not as a patch.
 */
export function groupScreen(
  structure: ScreenStructure,
  inferredCurrency?: Currency,
): PipelineResult {
  return {
    ...structure,
    groups: groupIntoAccounts(
      structure.classified,
      structure.institutionConfig,
      inferredCurrency,
    ),
  };
}

// Both rule-engine entry points run the two stages back to back, so a pipeline
// change is one edit, not two copies.
function runPipeline(
  blocks: OcrTextBlock[],
  options: PipelineOptions = {},
): PipelineResult {
  return groupScreen(readScreen(blocks, options.ablate));
}

export function parseOcrBlocks(
  blocks: OcrTextBlock[],
  options: PipelineOptions = {},
): RecognizedAccount[] {
  const { groups, institutionId, institutionConfig } = runPipeline(
    blocks,
    options,
  );
  return toRecognizedAccounts(groups, institutionId, institutionConfig);
}

// Tracing variant for `pnpm ocr --trace`: same pipeline, but also returns the
// intermediate stages (clustered lines, per-line roles, per-token roles,
// detected institution, grouped accounts with their source line indexes) so a
// wrong answer can be attributed to the classifying rule that mis-fired.
// Production code calls the non-tracing `parseOcrBlocks`; this stays out of
// the hot path.
export function parseOcrBlocksTraced(blocks: OcrTextBlock[]): {
  accounts: RecognizedAccount[];
  trace: OcrTrace;
} {
  const { classified, groups, institutionId, institutionConfig } =
    runPipeline(blocks);
  return {
    accounts: toRecognizedAccounts(groups, institutionId, institutionConfig),
    trace: { classified, groups, institutionId },
  };
}

// The shared tail both entry points run on grouped accounts: coerce each group
// to the app's `RecognizedAccount` contract, drop un-parseable ones, and tag
// each with the detected institution id.
function toRecognizedAccounts(
  groups: OcrAccountGroup[],
  institutionId: InstitutionId,
  institutionConfig: InstitutionConfig,
): RecognizedAccount[] {
  return groups
    .map((group) => groupToRecognized(group, institutionConfig))
    .filter((account): account is RecognizedAccount => account !== null)
    .map((account) => ({ ...account, institutionId }));
}

// Exported for the model pipeline: it coerces each group this same way, but
// keeps the group each account came FROM, because the model's annotations are
// addressed by region number.
export function groupToRecognized(
  group: OcrAccountGroup,
  institutionConfig: InstitutionConfig,
): RecognizedAccount | null {
  const result: RecognizedAccount = {};

  const name = group.name.trim();
  if (name) {
    result.accountName = name;
  }

  if (lastFourDigitsSchema.safeParse(group.lastFour).success) {
    result.accountLastFourDigits = group.lastFour;
  }

  // The grouping step only ever emits a known `Currency`, so the only thing
  // left to reject here is a non-finite amount (an unparseable figure).
  const balances = group.balances
    .filter(({ amount }) => Number.isFinite(amount))
    .map(({ currency, amount }) => ({ currency, balance: amount }));
  if (balances.length > 0) {
    result.balances = balances;
  }

  // The account's own name is the most reliable signal, then what the
  // institution is, then cash. Surrounding rows are deliberately NOT consulted:
  // navigation labels ("理财", "投资") sit next to every account and say
  // nothing about it. See `detectAssetKind`.
  //
  // Not even the group's OWN rows (`group.sourceText`), which look like fair
  // evidence and are not: measured over the corpus, adding them regressed 7
  // kinds and fixed none. A group absorbs the scaffolding rows around its
  // account — a 理财 nav tab, a 基金 product shelf — and each one outvotes the
  // name. The predecessor took a `wholeText` argument for this; dropping it was
  // the fix, not an oversight.
  result.kind =
    detectAssetKind(group.name) ?? institutionConfig.defaultKind ?? "cash";

  // `result.balances` is only ever set to a non-empty array, so a truthiness
  // check is enough — the `&& length > 0` it used to carry was unreachable.
  //
  // The flag itself deliberately does NOT cross into `RecognizedAccount`. What
  // reaches the app is the account minus the figure, which is exactly what the
  // contract can express, and the form then decides whether it is worth a draft
  // (`isWorthDrafting`) — an account with a name or a number is offered for the
  // user to complete, one carrying nothing at all is not. Putting the flag on
  // the contract would only let the form say something more specific about a
  // draft it currently declines to seed; that is a product decision, not a
  // recognition one, and no screen asks for it yet.
  //
  // A group that showed money the app cannot represent counts as having
  // something too. `groupIntoAccounts` deliberately keeps that group —
  // the account is real, only its figure is unrepresentable — and this second,
  // stricter gate one layer up was deleting exactly the groups that clause
  // exists for, so a JPY-only screen still recognized nothing.
  return result.accountName ||
    result.accountLastFourDigits ||
    result.balances ||
    group.sawUnstorableBalance
    ? result
    : null;
}
