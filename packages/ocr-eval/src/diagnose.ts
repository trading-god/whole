// Decision-level diagnosis data for the OCR rule engine. The parser's `trace`
// (see `parseOcrBlocksTraced` in ocr-parser.ts, written to disk by dump.ts)
// records *outputs* — which role each line got, which groups were formed.
// That's necessary but not sufficient for an LLM teacher: to say *why*
// `classifyRow` put "360 360 Account >" on the amount path, the model needs
// the intermediate rule decisions, not just the result.
//
// This module re-runs the classifier/amount matcher internals per clustered
// line and tags each with the decision facts (`digitCount`, `isCardLike`,
// `matchAmount` outcome, currency mention), so `teach.ts` can hand the teacher
// an evidence table: line → role + the rule inputs that produced it.
import {
  matchAmount,
  isCardLike,
  isMaskedCard,
} from "@/features/assets/ocr-amount";
import { currencyMention } from "@/features/assets/ocr-currency";
import {
  hasLabelMarker,
  type RowRole,
} from "@/features/assets/ocr-line-classify";
import type { OcrTrace } from "@/features/assets/ocr-parser";

export type LineDiagnosis = {
  index: number;
  text: string;
  role: RowRole;
  digitCount: number;
  // The classifier's internal rule inputs, so a teacher can see which branch
  // fired and what a changed constant would affect.
  hasLabelMarker: boolean;
  isCardLike: boolean;
  isMaskedCard: boolean;
  amount: { ok: true; amount: number; currency: string | undefined } | null;
  currencyMention: { currency: string; index: number; token: string } | null;
};

// Re-runs the classifier's inputs for each clustered line and attaches the
// evidence. Iterates `trace.classified` directly — it already carries each
// line's text, role, and 1-based index, so no index lookup is needed.
export function diagnoseTrace(trace: OcrTrace): LineDiagnosis[] {
  return trace.classified.map(({ text, role, index }) => {
    const lower = text.toLowerCase();
    const parsed = matchAmount(text);
    const mention = currencyMention(text);
    return {
      index,
      text,
      role,
      digitCount: (text.match(/\d/g) ?? []).length,
      hasLabelMarker: hasLabelMarker(lower),
      isCardLike: isCardLike(text),
      isMaskedCard: isMaskedCard(text),
      amount: parsed.ok
        ? { ok: true, amount: parsed.amount, currency: parsed.currency }
        : null,
      currencyMention: mention
        ? {
            currency: mention.currency,
            index: mention.index,
            token: mention.token,
          }
        : null,
    };
  });
}
