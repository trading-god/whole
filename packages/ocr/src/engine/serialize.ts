// Renders a grid as the compact text the model reads.
//
// The format exists to be cheap and unambiguous rather than pretty: a real
// screenshot lands around 1500 tokens, which is what keeps a locally hosted
// model viable as an endpoint, and every cell carries the index the model must
// answer with.
//
//   COLUMNS 2
//   y=0.065  #0 c0 "SGD"  #1 c1 "HKD"
//   y=0.125  #2 c0 "100.00"  #3 c1 "200.00"
//
// The `#n` prefix is the contract, not decoration. The model returns indices
// and never text, so a hallucinated balance is not merely unlikely — it is
// unrepresentable, because the number the app records is looked up from the
// block list by index rather than read out of the model's answer.
import type { Grid } from "./grid";

// Escaped so a cell can never end early. A quote inside recognized text would
// otherwise close its cell and shift every index after it — the one class of
// corruption that would leave the model's answer pointing at the wrong block,
// while still passing every check that only asks whether an index exists.
function quote(text: string): string {
  const escaped = text
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
  return `"${escaped}"`;
}

export function serializeGrid(grid: Grid): string {
  const header =
    grid.columnCount > 0 ? `COLUMNS ${grid.columnCount}` : "COLUMNS none";

  const lines = grid.rows.map((row) => {
    const cells = row.cells.map((cell) => {
      const band = cell.column === null ? "" : ` c${cell.column}`;
      return `#${cell.blockIndex}${band} ${quote(cell.text)}`;
    });
    return `y=${row.y.toFixed(3)}  ${cells.join("  ")}`;
  });

  return [header, ...lines].join("\n");
}
