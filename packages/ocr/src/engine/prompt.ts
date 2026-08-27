// The two halves of the turn the model is asked to take.
//
// The prompt is a rule table like any other in this package — it is just
// written in English instead of in regexes, and it is under test for the same
// reason: every instruction in it is there because a specific screenshot went
// wrong without it, and nothing but a test stops one being edited away.
import { z } from "zod";

import type { Grid } from "./grid";
import { recognitionSelectionSchema } from "./resolve";
import { serializeGrid } from "./serialize";

/** Names the output contract; both wire protocols surface it as a tool name. */
export const RECOGNITION_SCHEMA_NAME = "recognized_accounts";

/**
 * The JSON Schema the endpoint is asked to enforce.
 *
 * Derived from the zod schema the resolver validates against, rather than
 * written out beside it: two hand-maintained copies of a contract drift, and
 * the drift would be silent — the model would satisfy the schema it was given
 * and fail the parse it was never shown. zod 4 does the conversion itself,
 * which is why this package needs no SDK for it.
 */
export function recognitionJsonSchema(): unknown {
  return z.toJSONSchema(recognitionSelectionSchema, { io: "input" });
}

export type RecognitionPromptOptions = {
  /**
   * Institutions the user already holds accounts with.
   *
   * A prior, not a menu. Someone with six institutions on file collapses most
   * of the ambiguity for one line of prompt — but the seventh has to stay
   * recognizable, which is why the instruction says the list is not a limit.
   */
  knownInstitutions?: readonly string[];
};

// Every paragraph below is load-bearing, and the tests say which failure each
// one prevents:
//
// - Indices, never text, is the whole design. It is what makes a fabricated
//   balance unrepresentable rather than merely unlikely.
// - The institution is inferred, not searched for. Seven of seventeen real
//   screenshots carry no brand name ANYWHERE — OCBC's overview identifies
//   itself only by "360 Account" and "GSA", China Merchants' only by "朝朝宝"
//   and "买理财，来招行". A model told to find a brand string finds nothing.
// - Blank beats a guess, because the institution is a display field a person
//   corrects in one tap, while a confident wrong one is a thing they have to
//   notice first.
// - The debt sign, because a card's balance is a liability and net worth
//   subtracts it — and the minus is frequently in the LABEL rather than in the
//   figure, which no amount of looking at the digits reveals.
// - The stated last four, because a trailing check digit makes the mechanical
//   tail wrong and the per-institution rule that knew so is gone. The model may
//   state the digits, but they must be IN the cell it pointed at.
// - Only what is on screen, because a screenshot is taken wherever the user
//   happened to be scrolled: page-level totals and headers are often simply
//   not in the image, and reconstructing one invents a number.
const SYSTEM_PROMPT = `You read a bank, broker or crypto-exchange account screenshot that has already been through OCR.

You are given the screen as rows of cells. Every cell looks like #N "text", where N is that cell's index. Cells that line up in a column carry a cN marker.

ANSWER WITH INDICES. For every account name, balance, currency and account number, return the INDEX of the cell it came from. Never copy the text or the number into your answer — the application reads those from the cell itself. An index that points at no cell, or at a cell holding something other than what you claimed, is discarded.

Group the cells into accounts. One account may hold several currencies, and each gets its own balance entry. A balance of zero is a real balance.

A credit card's balance is what is OWED, and it has to reach the app as a negative figure. Some cards print it already signed ("-1,745.52"); others print what was SPENT as a positive beside a label that says so ("您花了", "Amount owed", "Statement balance"). When the label says the figure is money owed, mark that balance as a debt. When a card shows a bare positive with no such label, leave it unmarked — it is genuinely ambiguous, and the user will decide.

For the account number: the last four digits are taken off the end of the cell you point at. Some banks print a trailing check digit, so the identifying four are not the last four on screen ("012-394-2-033676-3" is account 033676, whose last four are 3676). When that is the case, state the four digits yourself — they must appear in the cell you pointed at.

For the currency: point at the cell naming it whenever the screen prints one. Only when the screen names no currency at all should you state one instead, from what the screen tells you about where the account is.

For the institution: the brand name may not appear anywhere on the screen. Infer it from product names, account-number format, vocabulary and marketing copy — those identify a bank as reliably as a logo. If you cannot place it, leave it blank rather than guessing; if two institutions both fit, name the likelier one and list the other as an alternate.

Report only what is on the screen. If a page-level total or a header is not in the image, do not reconstruct it.`;

/**
 * Builds the system and user turns for one recognition.
 */
export function buildRecognitionPrompt(
  grid: Grid,
  options: RecognitionPromptOptions = {},
): { system: string; user: string } {
  const known = options.knownInstitutions ?? [];

  const system =
    known.length > 0
      ? `${SYSTEM_PROMPT}\n\nThis user already holds accounts with: ${known.join(", ")}. Treat that as a hint, not a limit — the screenshot may be from another institution entirely.`
      : SYSTEM_PROMPT;

  return { system, user: serializeGrid(grid) };
}
