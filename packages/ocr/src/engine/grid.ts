// Two-dimensional layout: flat OCR blocks in, rows-with-column-bands out.
//
// This is deterministic geometry, and it is deliberately the LAST thing done
// before the model sees the screen. Rebuilding rows and columns out of sixty
// floating-point coordinates is the task a language model is worst at and this
// code is best at — so it is done here, for free, and the model's attention is
// left for the part that actually needs world knowledge: whether a row is an
// account name or a sub-label, and which rows belong to the same account.
//
// It knows nothing about institutions, balances, or currencies, which is why it
// survived the move away from per-institution rules unchanged in spirit.
import type { OcrTextBlock } from "../contract/block";

import { clusterIntoLines } from "./line-clustering";

/** One OCR block, placed. */
export type GridCell = {
  /**
   * Index into the FLAT block list handed to `buildGrid`.
   *
   * This is the identity the model answers with — it returns indices, never
   * text — so a value it reports can always be resolved back to a block that
   * really exists. A cell that could not be pointed back at a block would be a
   * value nothing could verify.
   */
  blockIndex: number;
  text: string;
  /** Left edge, rounded to three places. */
  x: number;
  /** Band this cell sits in, or `null` when the screen has no columns. */
  column: number | null;
};

export type GridRow = {
  /** Vertical centre of the row, rounded to three places. */
  y: number;
  cells: GridCell[];
};

export type Grid = {
  rows: GridRow[];
  /** Number of detected bands; `0` when the layout degraded to plain rows. */
  columnCount: number;
};

// Three places is finer than any layout decision the model has to make, and
// every digit beyond that is tokens spent on noise. A screenshot's meaningful
// geometry is at the percent level.
const COORDINATE_PLACES = 3;

// How far apart two cells' centres can sit and still count as the same band.
// Real OCR never lines up to the pixel — a rescaled or downsampled screenshot
// drifts — so an exact match would find no columns on any real screen.
const BAND_TOLERANCE = 0.03;

// A band needs corroboration from a second row. One cell alone is a position,
// not a column: without this every left-aligned label becomes its own band and
// the "grid" is the row list with extra steps.
const MIN_ROWS_PER_BAND = 2;

// One band is a left margin, not a table. Two is the least that can express
// "this value belongs under that header", which is the only thing columns are
// here to say.
const MIN_BANDS_FOR_A_GRID = 2;

function round(value: number): number {
  return Number(value.toFixed(COORDINATE_PLACES));
}

function centerX(block: OcrTextBlock): number {
  return block.normalizedBox.x + block.normalizedBox.width / 2;
}

function centerY(block: OcrTextBlock): number {
  return block.normalizedBox.y + block.normalizedBox.height / 2;
}

type Placed = { block: OcrTextBlock; blockIndex: number };

// Groups centres into bands, keeping only those several rows agree on.
//
// Single-link clustering over the sorted centres: a centre joins the open band
// while it is within tolerance of that band's LAST member, so a band can drift
// across the screen as long as each step is small. That matches how a column of
// right-aligned amounts actually behaves — the digits shift as the numbers get
// longer — and it is why the comparison is against the previous member rather
// than the band's first.
function detectBands(rows: Placed[][]): number[] {
  const centres = rows.flatMap((cells, rowIndex) =>
    cells.map((cell) => ({ centre: centerX(cell.block), rowIndex })),
  );
  centres.sort((a, b) => a.centre - b.centre);

  const bands: { centres: number[]; rows: Set<number> }[] = [];
  let open: { centres: number[]; rows: Set<number> } | null = null;

  for (const entry of centres) {
    const previous = open?.centres[open.centres.length - 1];
    if (
      open &&
      previous !== undefined &&
      entry.centre - previous <= BAND_TOLERANCE
    ) {
      open.centres.push(entry.centre);
      open.rows.add(entry.rowIndex);
      continue;
    }
    open = { centres: [entry.centre], rows: new Set([entry.rowIndex]) };
    bands.push(open);
  }

  return bands
    .filter((band) => band.rows.size >= MIN_ROWS_PER_BAND)
    .map(
      (band) =>
        band.centres.reduce((total, value) => total + value, 0) /
        band.centres.length,
    );
}

/**
 * Places flat OCR blocks into rows, and into column bands when the screen has
 * any.
 *
 * The degradation is as important as the detection: a card layout — name
 * top-left, balance bottom-right — has no columns, and reporting some anyway
 * would invent alignment that is not on the screen. Every downstream rule would
 * then be reasoning about a table nobody printed.
 */
export function buildGrid(blocks: OcrTextBlock[]): Grid {
  if (blocks.length === 0) {
    return { rows: [], columnCount: 0 };
  }

  const indexOf = new Map<OcrTextBlock, number>(
    blocks.map((block, index) => [block, index]),
  );

  const rows: Placed[][] = clusterIntoLines(blocks).map((line) =>
    line.map((block) => ({
      block,
      // Every block came out of the array that built the map, so the lookup
      // cannot miss; `?? -1` would be an unreachable branch pretending to be a
      // safety net.
      blockIndex: indexOf.get(block) as number,
    })),
  );

  const bands = detectBands(rows);
  const hasGrid = bands.length >= MIN_BANDS_FOR_A_GRID;

  return {
    columnCount: hasGrid ? bands.length : 0,
    rows: rows.map((cells) => ({
      y: round(
        cells.reduce((total, cell) => total + centerY(cell.block), 0) /
          cells.length,
      ),
      cells: cells.map((cell) => ({
        blockIndex: cell.blockIndex,
        text: cell.block.text,
        x: round(cell.block.normalizedBox.x),
        column: hasGrid ? bandOf(centerX(cell.block), bands) : null,
      })),
    })),
  };
}

// The nearest band within tolerance, or null. A cell outside every band is a
// cell that is genuinely not in a column — a caption spanning the table, a
// lone value off to one side — and saying so is more useful than snapping it
// into whichever band happens to be closest.
function bandOf(centre: number, bands: number[]): number | null {
  let best: number | null = null;
  let bestDistance = BAND_TOLERANCE;

  bands.forEach((band, index) => {
    const distance = Math.abs(centre - band);
    if (distance <= bestDistance) {
      best = index;
      bestDistance = distance;
    }
  });

  return best;
}
