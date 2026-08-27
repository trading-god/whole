// Can the index-only contract express the right answer, on real screenshots?
//
// This is the one question the new recognition design cannot answer with unit
// tests, and it is the question the whole thing rests on. The model returns
// BLOCK INDICES and nothing else, so every value the app records must already
// be present in some block. If a verified gold names a balance that appears in
// no block, the model could not have produced it however well it read the
// screen — the contract itself would be the limit.
//
// So this replays all seventeen human-verified samples and checks the claim
// directly, against recorded OCR from real bank, broker and exchange apps.
//
// It asserts nothing about a model's judgement. A failure here means the
// CONTRACT is too narrow; a model picking the wrong block is a different
// problem, measured by the eval harness.
import { matchAmount, buildGrid, type OcrTextBlock } from "@whole/ocr";
import { describe, expect, it } from "vitest";

import { loadGoldAccounts, loadOcrBlocks } from "./paths";
import { VERIFIED_SAMPLES } from "./verified-samples";

// The digits of an account number, however the screen punctuated them.
const digitsOf = (text: string) => text.replace(/\D/g, "");

// Whether any block's own text parses to this amount, by the same parser the
// resolver uses. Not a string comparison: the resolver reads "6,672.59",
// "-1,745.52SGD" and "100,554.59" through `matchAmount`, so the question is
// whether that parser lands on the gold figure — which is exactly what the
// resolver would do with an index pointing here.
//
// The MAGNITUDE is compared, because a card's debt is frequently printed as
// what was spent ("您花了 4,766.92") with the minus living in the label. The
// contract carries that as the balance's `isDebt` flag, which negates the
// magnitude — so a positive block backing a negative gold is the contract
// working, not failing.
function someBlockParsesTo(blocks: OcrTextBlock[], amount: number): boolean {
  return blocks.some((block) => {
    const parsed = matchAmount(block.text);
    return (
      parsed.ok && Math.abs(Math.abs(parsed.amount) - Math.abs(amount)) < 0.005
    );
  });
}

// Anywhere in the block's digit run, not only at its end. The contract lets the
// model state the four digits when a trailing check digit makes the tail wrong
// ("012-394-2-033676-3" is 3676, not 6763) — and the resolver then checks they
// are IN the block, which is exactly the question asked here.
function someBlockContains(blocks: OcrTextBlock[], lastFour: string): boolean {
  return blocks.some((block) => digitsOf(block.text).includes(lastFour));
}

// A gold name may be spread over several blocks ("360" + "Account"), which the
// resolver joins — so the question is whether every WORD of it is on screen.
function everyWordAppears(blocks: OcrTextBlock[], name: string): boolean {
  const haystack = blocks
    .map((block) => block.text)
    .join(" ")
    .toLowerCase()
    .replace(/\s+/g, "");

  return name
    .toLowerCase()
    .split(/\s+/)
    .every((word) => haystack.includes(word.replace(/\s+/g, "")));
}

describe.each(VERIFIED_SAMPLES)("%s", (slug) => {
  const blocks = loadOcrBlocks(slug);
  const gold = loadGoldAccounts(slug) ?? [];

  it("has gold to check against", () => {
    expect(gold.length).toBeGreaterThan(0);
  });

  // The claim the whole design rests on, one sample at a time.
  it("carries every gold balance in some block", () => {
    const missing = gold.flatMap((account) =>
      (account.balances ?? [])
        .filter((balance) => !someBlockParsesTo(blocks, balance.balance))
        .map(
          (balance) =>
            `${account.accountName ?? "?"}: ${balance.balance} ${balance.currency}`,
        ),
    );

    expect(missing).toEqual([]);
  });

  it("carries every gold last four in some block", () => {
    const missing = gold
      .map((account) => account.accountLastFourDigits)
      .filter(
        (lastFour): lastFour is string =>
          lastFour !== undefined && !someBlockContains(blocks, lastFour),
      );

    expect(missing).toEqual([]);
  });

  it("carries every gold account name in some block", () => {
    const missing = gold
      .map((account) => account.accountName)
      .filter(
        (name): name is string =>
          name !== undefined && !everyWordAppears(blocks, name),
      );

    expect(missing).toEqual([]);
  });

  // The grid is what the model is shown. A screen that produced no rows would
  // be a screen the model cannot read at all, whatever it knows.
  it("lays out into rows the model can be shown", () => {
    const grid = buildGrid(blocks);

    expect(grid.rows.length).toBeGreaterThan(0);
    expect(grid.rows.flatMap((row) => row.cells)).toHaveLength(blocks.length);
  });
});
