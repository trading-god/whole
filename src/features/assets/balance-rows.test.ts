import { describe, expect, it } from "vitest";

import {
  type BalanceRow,
  addBalanceRow,
  createBalanceRow,
  hasDuplicateCurrencyIn,
  markBalanceRows,
  removeBalanceRow,
  toBalanceRows,
  updateBalanceRow,
} from "@/features/assets/balance-rows";
import { knownAssetCurrencies } from "@/features/assets/currencies";

// The field's per-row markers and the save gate's duplicate check are two views
// of one rule, and they used to be two implementations of it — the second living
// inside `BalanceRowsField`, where no runner could reach it. These assert the
// property that keeps them honest: a row is marked exactly when the gate would
// have counted its currency twice.

function rows(...entries: [string, BalanceRow["currency"]][]): BalanceRow[] {
  return entries.map(([balance, currency], id) => ({ id, balance, currency }));
}

describe("markBalanceRows", () => {
  it("marks the later of two rows holding the same currency", () => {
    const marked = markBalanceRows(rows(["100", "SGD"], ["200", "SGD"]), null);
    expect(marked.map((row) => row.duplicateCurrency)).toEqual([false, true]);
  });

  it("does not mark a repeat whose balance the gate would not count", () => {
    // [SGD 100, SGD ""] is not a duplicate — the blank row contributes nothing,
    // so Save is not blocked and nothing should be flagged.
    const entries = rows(["100", "SGD"], ["", "SGD"]);
    const marked = markBalanceRows(entries, null);
    expect(marked.map((row) => row.duplicateCurrency)).toEqual([false, false]);
    expect(
      hasDuplicateCurrencyIn(marked.flatMap(({ balance }) => balance ?? [])),
    ).toBe(false);
  });

  it("agrees with the save gate that two counted rows are a duplicate", () => {
    const marked = markBalanceRows(rows(["100", "SGD"], ["200", "SGD"]), null);
    expect(
      hasDuplicateCurrencyIn(marked.flatMap(({ balance }) => balance ?? [])),
    ).toBe(true);
  });

  it("leaves distinct currencies unmarked", () => {
    const marked = markBalanceRows(rows(["100", "SGD"], ["200", "USD"]), null);
    expect(marked.every((row) => !row.duplicateCurrency)).toBe(true);
  });

  it("does not call a half-typed entry unreadable while its row is focused", () => {
    // "-" on the way to "-4766.92". Typing it is not yet an error; leaving it is.
    const entries = rows(["-", "SGD"]);
    expect(markBalanceRows(entries, entries[0].id)[0].unreadable).toBe(false);
    expect(markBalanceRows(entries, null)[0].unreadable).toBe(true);
  });

  it("marks the second repeat when three rows share a currency", () => {
    const marked = markBalanceRows(
      rows(["1", "HKD"], ["2", "HKD"], ["3", "HKD"]),
      null,
    );
    expect(marked.map((row) => row.duplicateCurrency)).toEqual([
      false,
      true,
      true,
    ]);
  });
});

describe("createBalanceRow", () => {
  it("defaults to an empty balance", () => {
    expect(createBalanceRow("SGD")).toMatchObject({
      currency: "SGD",
      balance: "",
    });
  });

  // Ids have to be unique so React keeps a row's focus and cursor across an
  // add or a remove; `currency` is not unique (duplicates are blocked only at
  // save time) and an index key would remount the row being typed in.
  it("mints a distinct id each time", () => {
    expect(createBalanceRow("SGD").id).not.toBe(createBalanceRow("SGD").id);
  });
});

describe("toBalanceRows", () => {
  it("stringifies each persisted balance", () => {
    expect(
      toBalanceRows([
        { currency: "SGD", balance: 6672.59 },
        { currency: "USD", balance: -4766.92 },
      ]),
    ).toMatchObject([
      { currency: "SGD", balance: "6672.59" },
      { currency: "USD", balance: "-4766.92" },
    ]);
  });

  it("returns nothing for an account with no balances", () => {
    expect(toBalanceRows([])).toEqual([]);
  });
});

describe("addBalanceRow", () => {
  it("appends the first currency that has no row yet", () => {
    const rows = [createBalanceRow("SGD")];

    expect(addBalanceRow(rows).map((row) => row.currency)).toEqual([
      "SGD",
      "USD",
    ]);
  });

  // The belt to BalanceRowsField's suspenders: it hides the add action once
  // every currency is taken, and this makes the call a no-op regardless.
  it("returns the rows unchanged once every currency is taken", () => {
    const rows = knownAssetCurrencies.map((currency) =>
      createBalanceRow(currency),
    );

    expect(addBalanceRow(rows)).toBe(rows);
  });
});

describe("updateBalanceRow", () => {
  it("patches only the row at the index", () => {
    const rows = [createBalanceRow("SGD"), createBalanceRow("USD")];

    const updated = updateBalanceRow(rows, 1, { balance: "12.50" });

    expect(updated[0]).toBe(rows[0]);
    expect(updated[1]).toMatchObject({ currency: "USD", balance: "12.50" });
  });

  it("leaves the rows alone for an index nobody holds", () => {
    const rows = [createBalanceRow("SGD")];

    expect(updateBalanceRow(rows, 5, { balance: "1" })).toMatchObject([
      { currency: "SGD", balance: "" },
    ]);
  });
});

describe("removeBalanceRow", () => {
  it("removes the row at the index", () => {
    const rows = [createBalanceRow("SGD"), createBalanceRow("USD")];

    expect(removeBalanceRow(rows, 0).map((row) => row.currency)).toEqual([
      "USD",
    ]);
  });

  // The forms always show at least one balance row, so the last one is not
  // removable — BalanceRowsField hides the action, and this enforces it.
  it("never removes the last row", () => {
    const rows = [createBalanceRow("SGD")];

    expect(removeBalanceRow(rows, 0)).toBe(rows);
  });
});
