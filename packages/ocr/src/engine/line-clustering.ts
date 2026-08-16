// Line clustering: reconstructs "visual lines" (screen rows) from flat script
// blocks by grouping them on vertical position. OCR returns per-word or
// per-fragment blocks whose normalized `y` overlaps when they share a visual
// row; the tolerance is derived from the median block height so it survives
// image rescaling. Each cluster is then sorted top→bottom, and blocks within a
// cluster left→right, so downstream classification sees stable, ordered rows.
import type { OcrTextBlock } from "../contract/block";

// Minimum row separation in normalized (0..1) space. The median-derived
// tolerance would collapse to ~0 when all blocks sit on one row (their boxes
// touch), which would fuse *every* row into a single cluster; the floor keeps
// rows distinct even for near-zero-height tiles.
const MIN_ROW_TOLERANCE = 0.02;

// Groups blocks into visual lines. `blocks` should already be normalized to
// 0..1. Returns an array of lines, each a top-to-bottom, left-to-right ordered
// list of blocks whose vertical centers are close.
export function clusterIntoLines(blocks: OcrTextBlock[]): OcrTextBlock[][] {
  if (blocks.length === 0) {
    return [];
  }

  const byCenter = [...blocks].sort((a, b) => centerY(a) - centerY(b));
  const medianHeight = median(byCenter.map((b) => b.normalizedBox.height));
  // Tolerance = one block height (not two): visual rows sit flush against each
  // other, so two blocks whose vertical centers are farther apart than a block
  // height belong to different rows even though their boxes may touch.
  const tolerance = Math.max(MIN_ROW_TOLERANCE, medianHeight);

  const lines: OcrTextBlock[][] = [];
  let current: OcrTextBlock[] = [];

  for (const block of byCenter) {
    if (
      current.length > 0 &&
      Math.abs(centerY(block) - centerY(current[0])) > tolerance
    ) {
      lines.push(sortLine(current));
      current = [];
    }
    current.push(block);
  }
  if (current.length > 0) {
    lines.push(sortLine(current));
  }
  return lines;
}

function centerY(block: OcrTextBlock): number {
  return block.normalizedBox.y + block.normalizedBox.height / 2;
}

function sortLine(line: OcrTextBlock[]): OcrTextBlock[] {
  // `line` is a fresh array built one block at a time in the loop above and
  // never aliased, so sort in place instead of copying.
  return line.sort(
    (a, b) => a.normalizedBox.x - b.normalizedBox.x || centerY(a) - centerY(b),
  );
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  // The caller hands us its own freshly-mapped array, so sort in place.
  values.sort((a, b) => a - b);
  const mid = Math.floor(values.length / 2);
  return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
}
