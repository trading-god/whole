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
import { detectAssetKind } from "./kind";
import { classifyRow, type RowRole } from "./line-classify";
import { clusterIntoLines } from "./line-clustering";
import { groupIntoAccounts, type OcrAccountGroup } from "./account-grouping";
import type { InstitutionId } from "../contract/institution";
import type { InstitutionConfig } from "../institutions/config";
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

// Shared pipeline core: clusters blocks into lines, labels row roles and
// per-token roles, resolves the detected institution's config, and groups into
// accounts. Both the plain and tracing entry points run these same steps so a
// pipeline change is one edit, not two copies.
function runPipeline(blocks: OcrTextBlock[]): {
  classified: ClassifiedLine[];
  institutionId: InstitutionId;
  institutionConfig: InstitutionConfig;
  groups: OcrAccountGroup[];
} {
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
  // tokens, then run the grouping step with that institution's config (icon
  // tags, equivalent-total pattern, product keywords) layered on the shared
  // defaults. "unknown" runs with the shared defaults only.
  const { institutionId, config: institutionConfig } = resolveInstitutionConfig(
    classified.map((l) => l.tokens),
  );
  const groups = groupIntoAccounts(classified, institutionConfig);
  return { classified, institutionId, institutionConfig, groups };
}

export function parseOcrBlocks(blocks: OcrTextBlock[]): RecognizedAccount[] {
  const { groups, institutionId, institutionConfig } = runPipeline(blocks);
  return toRecognizedAccounts(groups, institutionId, institutionConfig);
}

// Tracing variant used by the eval harness's diagnosis tooling: same pipeline,
// but also returns the intermediate stages (clustered lines, per-line roles,
// per-token roles, detected institution, grouped accounts with their source line
// indexes) so an LLM can attribute parser failures to the classifying rule
// that mis-fired. Production code calls the non-tracing `parseOcrBlocks`; this
// stays out of the hot path.
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

function groupToRecognized(
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
