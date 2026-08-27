import { describe, expect, it } from "vitest";

import { columns, row, screen } from "../test-support/screen";
import { buildGrid } from "./grid";
import { serializeGrid } from "./serialize";

const serialize = (blocks: Parameters<typeof buildGrid>[0]) =>
  serializeGrid(buildGrid(blocks));

describe("serializeGrid", () => {
  // The whole screen in one glance, and cheap: a real screenshot lands around
  // 1500 tokens this way, which is what keeps a locally hosted model viable.
  it("writes one line per row, cells in reading order", () => {
    // A card layout, deliberately: a title over a label/amount/currency row,
    // with nothing lining up between them. Two rows of two same-width words
    // WOULD band, and that is correct — it just is not what this case is about.
    expect(
      serialize(screen(row("360 Account"), row("可用余额", "6,672.59", "SGD"))),
    ).toBe(
      [
        "COLUMNS none",
        'y=0.065  #0 "360 Account"',
        'y=0.125  #1 "可用余额"  #2 "6,672.59"  #3 "SGD"',
      ].join("\n"),
    );
  });

  // The index prefix is the contract. The model answers with these numbers and
  // nothing else, so every cell has to carry one where the model can see it.
  it("prefixes every cell with the index the model must answer with", () => {
    const text = serialize(screen(row("a", "b"), row("c")));

    expect(text).toContain('#0 "a"');
    expect(text).toContain('#1 "b"');
    expect(text).toContain('#2 "c"');
  });

  it("announces the column count when the screen has a table", () => {
    const text = serialize(
      screen(
        columns([
          ["SGD", 0.2],
          ["HKD", 0.5],
        ]),
        columns([
          ["100.00", 0.2],
          ["200.00", 0.5],
        ]),
      ),
    );

    expect(text.split("\n")[0]).toBe("COLUMNS 2");
  });

  // A value under a header only means something if the model can see they share
  // a column, so the band rides on the cell rather than being left implicit in
  // the x coordinate.
  it("marks which band each cell sits in", () => {
    const text = serialize(
      screen(
        columns([
          ["SGD", 0.2],
          ["HKD", 0.5],
        ]),
        columns([
          ["100.00", 0.2],
          ["200.00", 0.5],
        ]),
      ),
    );

    expect(text).toContain('#0 c0 "SGD"');
    expect(text).toContain('#3 c1 "200.00"');
  });

  // A cell outside every band on a screen that does have bands: saying so is
  // more useful than snapping it into whichever band is nearest.
  it("leaves an unbanded cell without a marker", () => {
    const text = serialize(
      screen(
        columns([
          ["A", 0.2],
          ["B", 0.5],
        ]),
        columns([
          ["C", 0.2],
          ["D", 0.5],
        ]),
        columns([["lonely", 0.9]]),
      ),
    );

    expect(text).toContain('#4 "lonely"');
  });

  // A quote inside recognized text would otherwise close the cell early and
  // shift every index after it — the one class of corruption that would make
  // the model's answer point at the wrong block.
  it("escapes quotes and backslashes in the text", () => {
    const text = serialize(screen(row('a "b" c', "d\\e")));

    expect(text).toContain('#0 "a \\"b\\" c"');
    expect(text).toContain('#1 "d\\\\e"');
  });

  // Newlines inside a block would break the one-row-per-line contract.
  it("keeps a cell on one line", () => {
    const text = serialize(screen(row("a\nb")));

    expect(text.split("\n")).toHaveLength(2);
    expect(text).toContain('#0 "a\\nb"');
  });

  it("writes just the header for a screen with no text", () => {
    expect(serialize([])).toBe("COLUMNS none");
  });
});
