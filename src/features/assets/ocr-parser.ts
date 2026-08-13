// Orchestrates the OCR semantic pipeline: clusters flat blocks into visual
// lines, classifies row roles, groups into tentative accounts, then emits the
// app's `RecognizedAccount[]` contract. The output is validated with the same
// pure schemas the rest of the feature uses (`currencySchema`,
// `assetKindSchema`, `lastFourDigitsSchema`) so "what is a valid recognized
// account" is defined once, and the parser's heuristics stay on the
// "mostly-correct editable draft" side of perfect.
//
// This module is intentionally PURE (no React Native / Expo imports): it's
// shared by the RN app and the Node eval harness (`packages/ocr-eval/run-eval.ts`),
// which replays recorded OCR blocks through it directly.
//
// Tracing: `parseOcrBlocksTraced` runs the same pipeline and also returns the
// intermediate stages (clustered lines, per-line roles, grouped accounts with
// their source line indexes). Trace data is only produced for diagnosis
// tooling (the eval harness's LLM-driven `teach` pass); production code calls
// `parseOcrBlocks`, which returns a bare `RecognizedAccount[]`.
import { assetKindSchema, lastFourDigitsSchema } from "./account-appearance";
import { currencySchema } from "./currencies";
import { detectKind } from "./ocr-kind";
import { classifyRow, type RowRole } from "./ocr-line-classify";
import { clusterIntoLines } from "./ocr-line-clustering";
import {
  groupIntoAccounts,
  type OcrAccountGroup,
} from "./ocr-account-grouping";
import type { BankId } from "./ocr-bank-config";
import { resolveBankConfig } from "./ocr-bank-detect";
import { classifyTokens, type TokenWithRole } from "./ocr-token-classify";
import type { RecognizedAccount } from "./recognition-types";
import type { OcrTextBlock } from "./ocr-types";

export type OcrTrace = {
  classified: ClassifiedLine[];
  groups: OcrAccountGroup[]; // includes lineNumbers
  bankId: BankId; // detected bank id (ocr-bank-detect)
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
// per-token roles, resolves the detected bank's config, and groups into
// accounts. Both the plain and tracing entry points run these same steps so a
// pipeline change is one edit, not two copies.
function runPipeline(blocks: OcrTextBlock[]): {
  classified: ClassifiedLine[];
  bankId: BankId;
  groups: OcrAccountGroup[];
} {
  const lines = clusterIntoLines(blocks);
  const classified = lines.map((line, index) => {
    const { text, tokens } = toStructuredLine(line);
    return { text, role: classifyRow(text), tokens, index: index + 1 };
  });
  // Detect which bank this screenshot belongs to from the labeled tokens, then
  // run the grouping step with that bank's config (icon tags, equivalent-total
  // pattern, product keywords) layered on the shared defaults. "unknown" runs
  // with the shared defaults only.
  const { bankId, config: bankConfig } = resolveBankConfig(
    classified.flatMap((l) => l.tokens),
  );
  const groups = groupIntoAccounts(classified, bankConfig);
  return { classified, bankId, groups };
}

export function parseOcrBlocks(blocks: OcrTextBlock[]): RecognizedAccount[] {
  const { groups, bankId } = runPipeline(blocks);
  return toRecognizedAccounts(groups, bankId);
}

// Tracing variant used by the eval harness's diagnosis tooling: same pipeline,
// but also returns the intermediate stages (clustered lines, per-line roles,
// per-token roles, detected bank, grouped accounts with their source line
// indexes) so an LLM can attribute parser failures to the classifying rule
// that mis-fired. Production code calls the non-tracing `parseOcrBlocks`; this
// stays out of the hot path.
export function parseOcrBlocksTraced(blocks: OcrTextBlock[]): {
  accounts: RecognizedAccount[];
  trace: OcrTrace;
} {
  const { classified, groups, bankId } = runPipeline(blocks);
  return {
    accounts: toRecognizedAccounts(groups, bankId),
    trace: { classified, groups, bankId },
  };
}

// The shared tail both entry points run on grouped accounts: coerce each group
// to the app's `RecognizedAccount` contract, drop un-parseable ones, and tag
// each with the detected bank id.
function toRecognizedAccounts(
  groups: OcrAccountGroup[],
  bankId: BankId,
): RecognizedAccount[] {
  return groups
    .map(groupToRecognized)
    .filter((account): account is RecognizedAccount => account !== null)
    .map((account) => ({ ...account, bankId }));
}

function groupToRecognized(group: OcrAccountGroup): RecognizedAccount | null {
  const result: RecognizedAccount = {};

  const name = group.name.trim();
  if (name) {
    result.accountName = name;
  }

  if (lastFourDigitsSchema.safeParse(group.lastFour).success) {
    result.accountLastFourDigits = group.lastFour;
  }

  const balances = group.balances
    .map(({ currency, amount }) => {
      const currencyOk = currencySchema.safeParse(currency);
      if (!currencyOk.success || !Number.isFinite(amount)) {
        return null;
      }
      return { currency: currencyOk.data, balance: amount };
    })
    .filter((entry) => entry !== null);
  if (balances.length > 0) {
    result.balances = balances;
  }

  const kind = assetKindSchema.safeParse(
    detectKind(group.name, group.sourceText.join(" ")),
  );
  if (kind.success) {
    result.kind = kind.data;
  }

  // `result.balances` is only ever set to a non-empty array, so a truthiness
  // check is enough — the `&& length > 0` it used to carry was unreachable.
  return result.accountName || result.accountLastFourDigits || result.balances
    ? result
    : null;
}
