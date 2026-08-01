import { useCallback, useMemo, useState } from "react";

import {
  type AccountBalance,
  balanceInputSchema,
} from "@/features/assets/asset-repository";
import {
  type Currency,
  knownAssetCurrencies,
} from "@/features/assets/currencies";

export type BalanceRow = {
  id: number;
  currency: Currency;
  balance: string;
};

// Monotonic id for balance rows so list keys stay stable across add/remove.
// `currency` isn't unique (the form allows duplicate currencies, blocked only
// at save time) and `index`-based keys remount rows on removal, losing the
// input focus/cursor of a row the user was typing in. Shared across the
// add-account and edit-account forms — cross-form uniqueness is irrelevant
// since rows never mix.
let balanceRowIdSeq = 0;
const nextBalanceRowId = (): number => balanceRowIdSeq++;

// Mints a single balance row. Used for the add-account form's initial row.
export function createBalanceRow(currency: Currency, balance = ""): BalanceRow {
  return { id: nextBalanceRowId(), currency, balance };
}

// Maps an account's persisted balances to editable form rows. Shared by the
// edit-account load (from the stored account) and both forms' screenshot
// recognition (from the model output) so the id-minting + stringification
// lives once.
function toBalanceRows(balances: readonly AccountBalance[]): BalanceRow[] {
  return balances.map((balance) =>
    createBalanceRow(balance.currency, String(balance.balance)),
  );
}

// Owns the per-currency balance-row form state shared by the add-account and
// edit-account screens: add/update/remove a row, the derived valid rows (for
// save), the duplicate-currency flag (for save), and replacing the rows from
// a recognized or loaded account. Extracted so the balance-row UX has one
// owner instead of being copy-pasted across both screens.
export function useBalanceRows(initial: BalanceRow[]) {
  const [balanceRows, setBalanceRows] = useState<BalanceRow[]>(initial);

  const addBalanceRow = useCallback(() => {
    setBalanceRows((rows) => {
      const usedCurrencies = new Set(rows.map((row) => row.currency));
      const nextCurrency = knownAssetCurrencies.find(
        (currency) => !usedCurrencies.has(currency),
      );
      if (!nextCurrency) {
        return rows;
      }
      return [...rows, createBalanceRow(nextCurrency)];
    });
  }, []);

  const updateBalanceRow = useCallback(
    (index: number, patch: Partial<BalanceRow>) => {
      setBalanceRows((rows) =>
        rows.map((row, i) => (i === index ? { ...row, ...patch } : row)),
      );
    },
    [],
  );

  const removeBalanceRow = useCallback((index: number) => {
    setBalanceRows((rows) =>
      rows.length <= 1 ? rows : rows.filter((_, i) => i !== index),
    );
  }, []);

  // Replaces the rows from an account's balances — used by the edit-account
  // load and by screenshot recognition in both forms.
  const setBalanceRowsFromAccount = useCallback(
    (balances: readonly AccountBalance[]) => {
      setBalanceRows(toBalanceRows(balances));
    },
    [],
  );

  // Rows with a parseable, non-negative balance. Empty or invalid rows are
  // ignored at save time so a freshly added row can be left blank. Validation
  // goes through `balanceInputSchema` (strip separators + non-negative parse)
  // so "what is a valid balance input" is defined once alongside the other
  // balance schemas.
  const validBalanceRows = useMemo<AccountBalance[]>(
    () =>
      balanceRows.flatMap((row) => {
        if (row.balance.trim().length === 0) {
          return [];
        }
        const result = balanceInputSchema.safeParse(row.balance);
        return result.success
          ? [{ currency: row.currency, balance: result.data }]
          : [];
      }),
    [balanceRows],
  );

  // Duplicates are checked against the rows that will actually be saved
  // (`validBalanceRows`) so an empty or invalid duplicate row doesn't block a
  // valid save — it would be dropped at save time anyway. [SGD 100, SGD ""]
  // is not a duplicate; [SGD 100, SGD 200] is.
  const hasDuplicateCurrency = useMemo(() => {
    const currencies = validBalanceRows.map((row) => row.currency);
    return new Set(currencies).size !== currencies.length;
  }, [validBalanceRows]);

  return {
    balanceRows,
    addBalanceRow,
    updateBalanceRow,
    removeBalanceRow,
    setBalanceRowsFromAccount,
    validBalanceRows,
    hasDuplicateCurrency,
  };
}
