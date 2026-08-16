// Test helpers for building OCR input by hand.
//
// The parser consumes flat blocks with 0..1 normalized boxes, which is the
// right shape for a machine and a terrible one for a test: a hand-written
// `{ x: 0.05, y: 0.13, width: 0.2, height: 0.03 }` per word buries the point of
// the test under coordinates. These builders let a test say what the *screen*
// looks like — rows of words, top to bottom — and derive plausible geometry
// from that, so a test reads like the screenshot it stands for:
//
//   screen(
//     row("360", "Account"),
//     row("SGD", "6,672.59"),
//   )
//
// Geometry matters to the pipeline (line clustering groups by vertical center,
// the multi-currency table pairs columns by center-x), so these are not dummy
// boxes: rows are spaced far enough apart to cluster separately, and `column`
// exists for tests that need two rows to line up horizontally.
import type { OcrTextBlock } from "../contract/block";

const ROW_HEIGHT = 0.03;
// Rows sit a full row-height apart, which is what `clusterIntoLines` needs to
// keep them distinct (its tolerance is the median block height).
const ROW_PITCH = 0.06;
const ROW_TOP = 0.05;
const LEFT = 0.05;
// Wide enough that consecutive words in a row don't overlap, narrow enough that
// a realistic number of columns fits inside 0..1.
const CHAR_WIDTH = 0.02;
const WORD_GAP = 0.02;

export type Row = { texts: string[]; xs?: number[] };

// One visual row of words, laid out left to right.
export function row(...texts: string[]): Row {
  return { texts };
}

// A row whose words are pinned to explicit center-x positions (0..1). Use when
// a test depends on horizontal alignment — a multi-currency header row over its
// value row, where the parser pairs "HKD" with the amount in the same column.
export function columns(entries: [text: string, centerX: number][]): Row {
  return {
    texts: entries.map(([text]) => text),
    xs: entries.map(([, centerX]) => centerX),
  };
}

// Builds the flat, normalized blocks for a whole screen of rows.
export function screen(...rows: Row[]): OcrTextBlock[] {
  const blocks: OcrTextBlock[] = [];
  rows.forEach((r, rowIndex) => {
    const y = ROW_TOP + rowIndex * ROW_PITCH;
    let cursor = LEFT;
    r.texts.forEach((text, colIndex) => {
      const width = Math.max(CHAR_WIDTH, text.length * CHAR_WIDTH);
      const pinnedCenter = r.xs?.[colIndex];
      const x = pinnedCenter === undefined ? cursor : pinnedCenter - width / 2;
      blocks.push({
        text,
        normalizedBox: { x, y, width, height: ROW_HEIGHT },
      });
      cursor = x + width + WORD_GAP;
    });
  });
  return blocks;
}
