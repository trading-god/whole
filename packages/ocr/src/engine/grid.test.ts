import { describe, expect, it } from "vitest";

import { columns, row, screen } from "../test-support/screen";
import { buildGrid } from "./grid";

// Text of each row, in reading order — what the model will be shown.
const textRows = (blocks: Parameters<typeof buildGrid>[0]) =>
  buildGrid(blocks).rows.map((gridRow) =>
    gridRow.cells.map((cell) => cell.text),
  );

describe("buildGrid rows", () => {
  it("groups blocks into the visual rows they were printed on", () => {
    const grid = textRows(
      screen(row("360", "Account"), row("可用余额", "6,672.59", "SGD")),
    );

    expect(grid).toEqual([
      ["360", "Account"],
      ["可用余额", "6,672.59", "SGD"],
    ]);
  });

  it("returns nothing for a screen with no text", () => {
    expect(buildGrid([])).toEqual({ rows: [], columnCount: 0 });
  });

  // Every cell carries its index into the FLAT block list, because that index
  // is the identity the model answers with. A cell that could not be pointed
  // back at a block would be a value nothing can verify.
  it("gives every cell the index of the block it came from", () => {
    const blocks = screen(row("360", "Account"), row("SGD", "6,672.59"));
    const grid = buildGrid(blocks);

    for (const gridRow of grid.rows) {
      for (const cell of gridRow.cells) {
        expect(blocks[cell.blockIndex]?.text).toBe(cell.text);
      }
    }
  });

  it("indexes every block exactly once", () => {
    const blocks = screen(row("a", "b"), row("c"), row("d", "e", "f"));
    const grid = buildGrid(blocks);

    const indices = grid.rows.flatMap((gridRow) =>
      gridRow.cells.map((cell) => cell.blockIndex),
    );
    expect([...indices].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  // Rounded because the model is shown these numbers and every extra digit is
  // tokens spent on noise. Three places is finer than any layout decision the
  // model has to make.
  it("rounds coordinates to three places", () => {
    const grid = buildGrid(screen(row("360")));
    const cell = grid.rows[0]?.cells[0];

    expect(cell?.x).toBe(Number(cell?.x.toFixed(3)));
    expect(grid.rows[0]?.y).toBe(Number(grid.rows[0]?.y.toFixed(3)));
  });
});

describe("buildGrid columns", () => {
  // The multi-currency table: a header row over its value rows, where an amount
  // belongs to the currency sitting above it. Two independent one-dimensional
  // groupings could not express that — "row 3" and "column 2" do not compose
  // into "the header of column 2 is HKD" without crossing them again downstream.
  it("bands cells that line up under one another", () => {
    const grid = buildGrid(
      screen(
        columns([
          ["SGD", 0.2],
          ["HKD", 0.5],
          ["USD", 0.8],
        ]),
        columns([
          ["100.00", 0.2],
          ["200.00", 0.5],
          ["300.00", 0.8],
        ]),
      ),
    );

    expect(grid.columnCount).toBe(3);
    expect(grid.rows.map((r) => r.cells.map((c) => c.column))).toEqual([
      [0, 1, 2],
      [0, 1, 2],
    ]);
  });

  it("numbers the bands left to right", () => {
    const grid = buildGrid(
      screen(
        columns([
          ["right", 0.8],
          ["left", 0.2],
        ]),
        columns([
          ["right", 0.8],
          ["left", 0.2],
        ]),
      ),
    );

    const leftCell = grid.rows[0]?.cells.find((c) => c.text === "left");
    const rightCell = grid.rows[0]?.cells.find((c) => c.text === "right");
    expect(leftCell?.column).toBe(0);
    expect(rightCell?.column).toBe(1);
  });

  // A card layout — name top-left, balance bottom-right — has no columns. The
  // degradation is the point: forcing a grid onto it would invent alignment
  // that is not on the screen, and every downstream rule would then reason
  // about a table nobody printed.
  it("reports no columns when nothing lines up", () => {
    const grid = buildGrid(
      screen(row("Global Savings Account"), row("等值新币", "2,009.85", "SGD")),
    );

    expect(grid.columnCount).toBe(0);
    expect(
      grid.rows.every((r) => r.cells.every((c) => c.column === null)),
    ).toBe(true);
  });

  // A band needs corroboration from a second row. One cell alone is a position,
  // not a column — otherwise every left-aligned label on the screen would
  // become its own band and the "grid" would be the row list with extra steps.
  it("does not raise a lone cell into a band", () => {
    const grid = buildGrid(
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

    expect(grid.columnCount).toBe(2);
    const lonely = grid.rows[2]?.cells[0];
    expect(lonely?.column).toBeNull();
  });

  // Real OCR never lines up to the pixel; a band has to tolerate the drift a
  // rescaled screenshot introduces.
  it("bands cells that line up approximately", () => {
    const grid = buildGrid(
      screen(
        columns([
          ["SGD", 0.2],
          ["HKD", 0.5],
        ]),
        columns([
          ["100.00", 0.205],
          ["200.00", 0.495],
        ]),
      ),
    );

    expect(grid.columnCount).toBe(2);
    expect(grid.rows[1]?.cells.map((c) => c.column)).toEqual([0, 1]);
  });

  // One band is a left margin, not a table. Two is the least that can express
  // "this value belongs under that header".
  it("needs at least two bands to call it a grid", () => {
    const grid = buildGrid(
      screen(columns([["A", 0.2]]), columns([["B", 0.2]])),
    );

    expect(grid.columnCount).toBe(0);
  });
});
