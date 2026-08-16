import { describe, expect, it } from "vitest";

import {
  type BalanceRow,
  hasDuplicateCurrencyIn,
  markBalanceRows,
} from "@/features/assets/balance-rows";

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
