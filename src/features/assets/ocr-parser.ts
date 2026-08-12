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
import type { RecognizedAccount } from "./recognition-types";
import type { OcrTextBlock } from "./ocr-types";

export type OcrTrace = {
  classified: { index: number; text: string; role: RowRole }[]; // 1-based
  groups: OcrAccountGroup[]; // includes lineNumbers
};

type OcrTokenPos = { text: string; x: number };

function toStructuredLine(line: OcrTextBlock[]): {
  text: string;
  tokens: OcrTokenPos[];
} {
  return {
    text: line.map((b) => b.text).join(" "),
    tokens: line.map((b) => ({
      text: b.text,
      x: b.normalizedBox.x + b.normalizedBox.width / 2,
    })),
  };
}

export function parseOcrBlocks(blocks: OcrTextBlock[]): RecognizedAccount[] {
  const lines = clusterIntoLines(blocks);
  const classified = lines.map((line) => {
    const { text, tokens } = toStructuredLine(line);
    return { text, role: classifyRow(text), tokens };
  });
  const groups = groupIntoAccounts(classified);
  return groups
    .map(groupToRecognized)
    .filter((account): account is RecognizedAccount => account !== null);
}

// Tracing variant used by the eval harness's diagnosis tooling: same pipeline,
// but also returns the intermediate stages (clustered lines, per-line roles,
// grouped accounts with their source line indexes) so an LLM can attribute
// parser failures to the classifying rule that mis-fired. Production code
// calls the non-tracing `parseOcrBlocks`; this stays out of the hot path.
export function parseOcrBlocksTraced(blocks: OcrTextBlock[]): {
  accounts: RecognizedAccount[];
  trace: OcrTrace;
} {
  const lines = clusterIntoLines(blocks);
  const classified = lines.map((line, index) => {
    const { text, tokens } = toStructuredLine(line);
    return { text, role: classifyRow(text), tokens, index: index + 1 };
  });
  const groups = groupIntoAccounts(classified);

  return {
    accounts: groups
      .map(groupToRecognized)
      .filter((account): account is RecognizedAccount => account !== null),
    trace: {
      classified: classified.map(({ text, role, index }) => ({
        text,
        role,
        index,
      })),
      groups,
    },
  };
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
