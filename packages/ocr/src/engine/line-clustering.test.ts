import { describe, expect, it } from "vitest";

import type { OcrTextBlock } from "../contract/block";
import { clusterIntoLines } from "./line-clustering";
import { row, screen } from "../test-support/screen";

function texts(lines: OcrTextBlock[][]): string[][] {
  return lines.map((line) => line.map((block) => block.text));
}

// Clustering is the first step, so its failures are the most expensive: fuse
// two rows and every downstream rule sees a line that never existed on screen.
describe("clusterIntoLines", () => {
  it("groups words that share a visual row", () => {
    const lines = clusterIntoLines(
      screen(row("360", "Account"), row("SGD", "6,672.59")),
    );
    expect(texts(lines)).toEqual([
      ["360", "Account"],
      ["SGD", "6,672.59"],
    ]);
  });

  it("returns rows top to bottom regardless of input order", () => {
    const blocks = screen(row("first"), row("second"), row("third"));
    const shuffled = [blocks[2], blocks[0], blocks[1]];
    expect(texts(clusterIntoLines(shuffled))).toEqual([
      ["first"],
      ["second"],
      ["third"],
    ]);
  });

  it("orders words within a row left to right", () => {
    const blocks = screen(row("left", "middle", "right"));
    const shuffled = [blocks[1], blocks[2], blocks[0]];
    expect(texts(clusterIntoLines(shuffled))).toEqual([
      ["left", "middle", "right"],
    ]);
  });

  it("keeps rows separate even when their boxes touch", () => {
    // Visual rows sit flush against each other; a tolerance of two block
    // heights would fuse them. This is the case the tolerance is tuned for.
    const blocks: OcrTextBlock[] = [
      { text: "Balance", normalizedBox: { x: 0.05, y: 0.1, ...size() } },
      { text: "1,234.56", normalizedBox: { x: 0.05, y: 0.13, ...size() } },
    ];
    expect(clusterIntoLines(blocks)).toHaveLength(2);
  });

  it("does not fuse everything when all blocks sit on one row", () => {
    // A single-row screen makes the median-derived tolerance collapse toward
    // zero; the floor keeps that from degenerating.
    const lines = clusterIntoLines(screen(row("a", "b", "c")));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveLength(3);
  });

  it("returns nothing for no input", () => {
    expect(clusterIntoLines([])).toEqual([]);
  });

  it("survives a rescaled image", () => {
    // Boxes are normalized, and the tolerance derives from the median block
    // height, so halving every coordinate must not change the row structure.
    const blocks = screen(row("360", "Account"), row("SGD", "6,672.59"));
    const halved = blocks.map((b) => ({
      text: b.text,
      normalizedBox: {
        x: b.normalizedBox.x / 2,
        y: b.normalizedBox.y / 2,
        width: b.normalizedBox.width / 2,
        height: b.normalizedBox.height / 2,
      },
    }));
    expect(texts(clusterIntoLines(halved))).toEqual(
      texts(clusterIntoLines(blocks)),
    );
  });
});

function size() {
  return { width: 0.2, height: 0.03 };
}
