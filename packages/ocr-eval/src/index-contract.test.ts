// Can the recognition contract express the right answer, on real screenshots?
//
// This is the one question the hybrid design cannot answer with unit tests,
// and it is the question the whole thing rests on. The ENGINE reads every
// figure and every last four out of the blocks' own text, so every value the
// app records must already be present in some block. If a verified gold names
// a balance that appears in no block, the engine could not have produced it
// however well it read the screen — the contract itself would be the limit.
//
// So this replays all seventeen human-verified samples and checks the claim
// directly, against recorded OCR from real bank, broker and exchange apps.
//
// It asserts nothing about the model's judgement. A failure here means the
// CONTRACT is too narrow; the engine reading the wrong block is a different
// problem, measured by the eval harness.
import {
  knownAssetCurrencies,
  parseOcrBlocks,
  type OcrTextBlock,
} from "@whole/ocr";
// Engine-internal on purpose, both of them. `matchAmount` is the ruler the
// engine reads a figure with, and the question below is whether the ENGINE
// could have produced a gold figure — asked with anything else it is a
// different question. `runPipeline`'s stages are likewise the subject of the
// second invariant, and `parseOcrBlocks` has thrown the region structure away
// by the time it returns. Neither belongs on the package's public surface for
// the sake of one test.
import { matchAmount } from "../../ocr/src/engine/amount";
import { groupScreen, readScreen } from "../../ocr/src/engine/parser";
import { describe, expect, it } from "vitest";

import { loadGoldAccounts, loadOcrBlocks } from "./paths";
import { VERIFIED_SAMPLES } from "./verified-samples";

// The digits of an account number, however the screen punctuated them.
const digitsOf = (text: string) => text.replace(/\D/g, "");

// Whether any block's own text parses to this amount, by the same parser the
// engine uses. Not a string comparison: the engine reads "6,672.59",
// "-1,745.52SGD" and "100,554.59" through `matchAmount`, so the question is
// whether that parser lands on the gold figure — which is exactly what the
// engine would do with this block.
//
// The MAGNITUDE is compared, because a card's debt is frequently printed as
// what was spent ("您花了 4,766.92") with the minus living in the label. The
// engine's debt markers read the label and negate the figure — so a positive
// block backing a negative gold is the engine working, not failing.
function someBlockParsesTo(blocks: OcrTextBlock[], amount: number): boolean {
  return blocks.some((block) => {
    const parsed = matchAmount(block.text);
    return (
      parsed.ok && Math.abs(Math.abs(parsed.amount) - Math.abs(amount)) < 0.005
    );
  });
}

// Anywhere in the block's digit run, not only at its end. A trailing check
// digit can make the mechanical tail wrong ("012-394-2-033676-3" is 3676, not
// 6763) — the engine's institution rules name the identifying digits wherever
// they sit, and this asks whether they are IN some block, which is exactly
// the question the contract requires.
function someBlockContains(blocks: OcrTextBlock[], lastFour: string): boolean {
  return blocks.some((block) => digitsOf(block.text).includes(lastFour));
}

// A gold name may be spread over several blocks ("360" + "Account"), which the
// engine's grouping joins — so the question is whether every WORD of it is on
// screen.
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

  // The engine is what reads the screen in the hybrid. A gold the engine
  // cannot even match — by name or by number — would mean the structure pass
  // is the limit, not the model.
  //
  // A gold carrying NEITHER a name nor a number has no identity to match on;
  // the eval harness matches those positionally, which this assertion cannot.
  it("is matched by the engine's parse, by name or by number", () => {
    const parsed = parseOcrBlocks(blocks);

    const unmatched = gold
      .filter(
        (account) =>
          account.accountName !== undefined ||
          account.accountLastFourDigits !== undefined,
      )
      .filter(
        (account) =>
          !parsed.some(
            (candidate) =>
              (account.accountName !== undefined &&
                candidate.accountName === account.accountName) ||
              (account.accountLastFourDigits !== undefined &&
                candidate.accountLastFourDigits ===
                  account.accountLastFourDigits),
          ),
      );

    expect(unmatched).toEqual([]);
  });
});

// Region structure must not depend on the home currency — the invariant the
// annotation turn's re-parse rests on.
//
// `recognizeWithModel` prompts the model against the FIRST pass's regions, and
// then, when the model infers a home currency the institution config lacks,
// GROUPS the same read screen again with it and applies the annotations to the
// second grouping. That is only sound while a currency cannot move a region
// boundary.
//
// It cannot, by construction: `groupIntoAccounts` decides whether to emit a
// region (`groupHasContent`) and whether it counts as identified (name, last
// four) before `finish` runs, and `finish` is the only reader of
// `defaultCurrency`. This asserts the construction still holds, over real
// screenshots rather than synthetic ones — so the day grouping starts
// consulting the currency, this fails instead of an annotation silently
// landing on the wrong account.
describe("region structure is independent of the home currency", () => {
  it.each(VERIFIED_SAMPLES)("holds for %s", (slug) => {
    const blocks = loadOcrBlocks(slug);

    // Ablated first, so the argument is actually consulted: on an institution
    // that declares its own currency the `??` in `groupScreen` would ignore it
    // and the assertion would pass without testing anything. Then un-ablated,
    // which is the shape `redenominate` actually calls.
    for (const ablate of ["currency", undefined] as const) {
      const structure = readScreen(blocks, ablate);
      const regions = (currency?: (typeof knownAssetCurrencies)[number]) =>
        groupScreen(structure, currency).groups.map(
          (group) => group.lineNumbers,
        );

      for (const currency of knownAssetCurrencies) {
        expect(regions(currency)).toEqual(regions());
      }
    }
  });
});
