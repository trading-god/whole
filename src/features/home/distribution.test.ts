import { describe, expect, it } from "vitest";

import {
  buildDistribution,
  roundPercentages,
} from "@/features/home/distribution";

describe("roundPercentages", () => {
  it("always sums to exactly 100 where naive rounding would not", () => {
    expect(roundPercentages([1, 1, 1])).toEqual([34, 33, 33]);
  });

  it("excludes negative kinds instead of pushing others past 100%", () => {
    // A card debt of −1,000 against 5,000 of investments: the liability is
    // not a slice of the composition, and leaving it in the denominator
    // would render investments at 125%.
    expect(roundPercentages([-1000, 5000])).toEqual([0, 100]);
  });

  it("returns all zeros when there is no positive total to share", () => {
    expect(roundPercentages([0, 0, 0])).toEqual([0, 0, 0]);
    expect(roundPercentages([-500, 0])).toEqual([0, 0]);
  });
});

describe("buildDistribution", () => {
  it("keeps a held kind that rounds to zero percent off the bar", () => {
    const slices = buildDistribution({ cash: 996, investment: 0, crypto: 4 });
    const crypto = slices.find((slice) => slice.kind === "crypto");
    expect(crypto?.percent).toBe(0);
    expect(crypto?.held).toBe(true);
    // Still positive, so it IS part of the composition — the bar's filter on
    // percent is what leaves it without a segment.
    expect(crypto?.inComposition).toBe(true);
  });

  it("marks a negative kind as held but not part of the composition", () => {
    const slices = buildDistribution({
      cash: -1000,
      investment: 5000,
      crypto: 0,
    });
    const cash = slices.find((slice) => slice.kind === "cash");
    expect(cash?.held).toBe(true);
    expect(cash?.inComposition).toBe(false);
  });
});
