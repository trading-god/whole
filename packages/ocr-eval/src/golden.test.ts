// Hard-assert regression tests over the human-verified samples.
//
// The distinction that makes this file worth having: an `expected.json` gold
// starts out model-generated and unchecked, and asserting against one of those
// would pin the engine to whatever the model guessed. `pnpm eval:ocr` covers
// every sample through the baseline, which only reports movement rather than
// declaring a right answer.
//
// The samples listed here are different — a human read the screenshot and
// confirmed the gold. For those, "the parser must produce this" is a real
// statement, so they get a real test: `pnpm test:ocr:golden` fails if the
// engine stops recognizing them correctly.
//
// Every sample currently qualifies, so today this list and the sample set are
// the same 17 — which is why the baseline is empty. That is a property of where
// the corpus happens to be, not a rule: a newly imported sample belongs in
// `pnpm eval:ocr` only until someone has checked its gold against the
// screenshot by eye. That check is the sole entry criterion for this list.
import { describe, expect, it } from "vitest";

import { parseOcrBlocks } from "@whole/ocr";

import { compareGolds } from "./compare";
import { loadGoldAccounts, loadOcrBlocks } from "./paths";
import { VERIFIED_SAMPLES } from "./verified-samples";

// Reading and replaying a sample, in a form that cannot abort collection.
//
// A `describe` callback runs while vitest is COLLECTING tests, so a throw here
// — a missing gold, a fixture that fails its schema — took every other
// sample's assertions down with it. Every CLI in this package isolates a bad
// sample to itself; the suite that gates them should too.
function replay(slug: string) {
  try {
    const gold = loadGoldAccounts(slug);
    if (!gold) {
      throw new Error(`${slug} is listed as verified but has no expected.json`);
    }
    const accounts = parseOcrBlocks(loadOcrBlocks(slug));
    // One comparison per gold, computed together so each recognized account is
    // claimed by at most one gold.
    return {
      ok: true as const,
      gold,
      accounts,
      comparisons: compareGolds(gold, accounts),
    };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

describe.each(VERIFIED_SAMPLES)("%s", (slug) => {
  const replayed = replay(slug);
  if (!replayed.ok) {
    it("can be replayed", () => {
      throw replayed.error;
    });
    return;
  }
  const { gold, accounts, comparisons } = replayed;

  it("recognizes the expected number of accounts", () => {
    expect(accounts).toHaveLength(gold.length);
  });

  // One test per gold account, so a failure names the account that broke
  // instead of dumping the whole screenshot's diff.
  describe.each(gold.map((account, index) => [index, account] as const))(
    "account %i (%o)",
    (index) => {
      const comparison = comparisons[index];

      it("matches every field the gold requires", () => {
        // `issues` carries human-readable reasons, so an assertion failure
        // reads as "name: expected X, got Y" rather than "false !== true".
        expect(comparison.issues).toEqual([]);
        expect(comparison.pass).toBe(true);
      });
    },
  );
});
