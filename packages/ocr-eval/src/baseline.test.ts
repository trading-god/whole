// The baseline gate's own arithmetic. These are the rules that decide whether a
// green run means "the parser improved" or "the gate got smaller", so getting
// them wrong is worse than a failing sample: it reports progress that did not
// happen.
import { describe, expect, it } from "vitest";

import { diffSample, type Baseline } from "./baseline";
import { compareGolds } from "./compare";

const baselineOf = (
  slug: string,
  keys: Record<string, "parser-bug">,
): Baseline => ({ knownFailures: { [slug]: keys } });

describe("diffSample", () => {
  it("reports a fixed count as resolved, not as shrunken coverage", () => {
    // A count key names what the parser EMITTED ("count:2"), so it is never in
    // `requiredKeys` — the gold only ever asks for its own account count.
    // Filing its disappearance under `droppedCoverage` told the reader the gold
    // had stopped asking, when the parser had actually stopped over-emitting.
    const diff = diffSample(
      "sample",
      [],
      baselineOf("sample", { count: "parser-bug", "count:2": "parser-bug" }),
      new Set(["0.accountName"]),
    );
    expect(diff.resolved.map((entry) => entry.key)).toEqual([
      "count",
      "count:2",
    ]);
    expect(diff.droppedCoverage).toEqual([]);
  });

  it("still reports a field the gold stopped asking for as shrunken coverage", () => {
    const diff = diffSample(
      "sample",
      [],
      baselineOf("sample", { "0.lastFour": "parser-bug" }),
      new Set(["0.accountName"]),
    );
    expect(diff.resolved).toEqual([]);
    expect(diff.droppedCoverage.map((entry) => entry.key)).toEqual([
      "0.lastFour",
    ]);
  });

  it("reports a field that still matters and now passes as resolved", () => {
    const diff = diffSample(
      "sample",
      [],
      baselineOf("sample", { "0.lastFour": "parser-bug" }),
      new Set(["0.lastFour"]),
    );
    expect(diff.resolved.map((entry) => entry.key)).toEqual(["0.lastFour"]);
    expect(diff.droppedCoverage).toEqual([]);
  });

  it("reports an unbaselined failure as a regression", () => {
    const diff = diffSample("sample", ["0.balances"], { knownFailures: {} });
    expect(diff.regressions.map((entry) => entry.key)).toEqual(["0.balances"]);
    expect(diff.knownGaps).toEqual([]);
  });
});

describe("compareGolds", () => {
  it("fails a field the gold does not ask for", () => {
    // A gold is the whole expected output. Four committed golds carry no
    // accountName, so an invented one used to pass both gates in silence.
    const [comparison] = compareGolds(
      [{ balances: [{ currency: "SGD", balance: 1 }] }],
      [
        {
          accountName: "Invented",
          balances: [{ currency: "SGD", balance: 1 }],
        },
      ],
    );
    expect(comparison.pass).toBe(false);
    expect(comparison.fields.name?.status).toBe("extra");
  });

  it("passes when neither side has the field", () => {
    const [comparison] = compareGolds(
      [{ balances: [{ currency: "SGD", balance: 1 }] }],
      [{ balances: [{ currency: "SGD", balance: 1 }] }],
    );
    expect(comparison.pass).toBe(true);
    expect(comparison.fields.name).toBeUndefined();
  });
});

describe("an extra verdict is not shrunken coverage", () => {
  it("reports a fixed extra as resolved", () => {
    // The gold asks for no name; the parser used to invent one and stopped.
    const diff = diffSample(
      "sample",
      [],
      { knownFailures: { sample: { "0.name:extra": "parser-bug" } } },
      new Set(["0.balances"]),
    );
    expect(diff.resolved.map((entry) => entry.key)).toEqual(["0.name:extra"]);
    expect(diff.droppedCoverage).toEqual([]);
  });
});
