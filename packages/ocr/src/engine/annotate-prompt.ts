// The annotation turn: what the model is asked, once the ENGINE has already
// decided what the screen's accounts are.
//
// The hybrid's division of labor is the whole design — the engine reads
// structure (grouping, balances, currencies, debt signs, last fours; the
// measured argument lives in `recognize.ts`'s header), and the only questions
// asked here are the semantics rules cannot know: naming the institution when
// the brand appears nowhere on screen, classifying an account kind from
// product vocabulary the keyword list never anticipated, and knowing which
// currency a domestic app means by a bare number.
//
// The three share a shape, which is why they are one turn: each is world
// knowledge about the INSTITUTION rather than a reading of the screen.
//
// The model references REGIONS, not block indices: a region is the engine's
// grouping, printed with its own lines. An answer can therefore only annotate
// something the engine already extracted — it cannot invent an account, and it
// cannot change a figure the screen stated.
//
// The home currency is the one answer that reaches a figure at all, and only
// where the screen stated no currency and no config supplied one: it turns a
// figure the engine would have DROPPED into a reported balance. It can never
// redenominate a figure the screen or a config already settled — that
// precedence lives in `groupScreen`, not in the wording below.
import { knownAssetCurrencies } from "../contract/currency";

import type { OcrAccountGroup } from "./account-grouping";

const SYSTEM_PROMPT = `You annotate the accounts on a bank, broker or crypto-exchange screenshot that OCR and a rules engine have already read.

The screen's text is in the message that follows this one. Lines there are prefixed with the number of the account REGION the rules engine grouped them into; a line with no prefix belongs to no region (screen furniture, or the institution's own branding).

Answer three things:

1. For each region, in order: what KIND of account it shows — "cash" (a deposit, checking or wallet account), "investment" (securities, funds, wealth products), or "crypto" (an exchange or on-chain account). Infer from product names and vocabulary, not from any single word. List EVERY region, and answer "unknown" for one you cannot tell rather than leaving it out or guessing.

2. The INSTITUTION (a bank, a broker, or a crypto exchange) this screen belongs to. The brand name may not appear anywhere on the screen; infer it from product names, account-number format, vocabulary and marketing copy — those identify an institution as reliably as a logo. This answer is required: give the institution's name, or exactly "unknown" if you cannot place the screen. If two fit, name the likelier and list the other as an alternate.

3. The screen's HOME CURRENCY — what this institution's app means when it prints a figure without naming a currency. A bank serving one country prints its home currency as a bare number. Answer ${knownAssetCurrencies.join(", ")} when the institution implies one, or "none" when it does not: a broker or a crypto exchange holds many currencies and has no home currency, and neither does a screen you could not place. This answer is required — say "none" rather than guess, because a figure with no currency is reported to the user as missing, while a figure in the WRONG currency is reported as money they do not have.

Never report balances, account names or account numbers — the engine already read those, and your answer cannot change them. The home currency is the one exception, and it is a fallback: it reaches only the figures the screen itself left undenominated.`;

/**
 * Builds the system and user turns for one annotation pass.
 *
 * The user turn is the whole screen's clustered lines, each prefixed with its
 * region number: the prefixes are what the per-region kind answers address,
 * and the ungrouped remainder is what the institution and home-currency
 * answers are read from — one pass over one list, because an institution is
 * inferred from everything on screen, including the parts no region absorbed.
 */
export function buildAnnotationPrompt(
  lines: readonly { text: string }[],
  regionOfLine: readonly (number | undefined)[],
  groups: readonly OcrAccountGroup[],
): { system: string; user: string } {
  const renderedLines = lines.map((line, index) => {
    const region = regionOfLine[index];
    return `${region === undefined ? "·" : region}| ${line.text}`;
  });

  const regionSummary = groups
    .map(
      (group, index) =>
        `Region ${index + 1}: ${group.name || "(no name)"}${
          group.lastFour !== undefined ? `, number tail ${group.lastFour}` : ""
        }`,
    )
    .join("\n");

  const user = [
    regionSummary,
    "",
    "SCREEN LINES (`N|` = region N, `·|` = no region):",
    ...renderedLines,
  ].join("\n");

  return { system: SYSTEM_PROMPT, user };
}
