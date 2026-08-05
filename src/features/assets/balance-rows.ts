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
// edit-account load, both forms' screenshot recognition, and the multi-account
// wizard's draft seeding (recognizedToDraft) so the id-minting + stringification
// lives once.
export function toBalanceRows(
  balances: readonly AccountBalance[],
): BalanceRow[] {
  return balances.map((balance) =>
    createBalanceRow(balance.currency, String(balance.balance)),
  );
}

// Appends a row in the first currency that doesn't have one yet, or returns
// the rows unchanged once every tracked currency is taken (BalanceRowsField
// hides the add action then, so this is the belt to that suspenders).
export function addBalanceRow(rows: BalanceRow[]): BalanceRow[] {
  const usedCurrencies = new Set(rows.map((row) => row.currency));
  const nextCurrency = knownAssetCurrencies.find(
    (currency) => !usedCurrencies.has(currency),
  );
  return nextCurrency ? [...rows, createBalanceRow(nextCurrency)] : rows;
}

export function updateBalanceRow(
  rows: BalanceRow[],
  index: number,
  patch: Partial<BalanceRow>,
): BalanceRow[] {
  return rows.map((row, i) => (i === index ? { ...row, ...patch } : row));
}

// Removes a row but never the last one — the forms always show at least one
// balance row (BalanceRowsField hides the delete action at a single row).
export function removeBalanceRow(
  rows: BalanceRow[],
  index: number,
): BalanceRow[] {
  return rows.length <= 1 ? rows : rows.filter((_, i) => i !== index);
}

// Derives the saveable AccountBalance[] from editable balance rows: drops
// empty/invalid rows (a freshly added row can be left blank) and parses each
// via `balanceInputSchema` so "what is a valid balance input" is defined once
// — `draftToValidAccount` runs every form's rows through this at save time.
export function deriveValidBalances(rows: BalanceRow[]): AccountBalance[] {
  return rows.flatMap((row) => {
    if (row.balance.trim().length === 0) {
      return [];
    }
    const result = balanceInputSchema.safeParse(row.balance);
    return result.success
      ? [{ currency: row.currency, balance: result.data }]
      : [];
  });
}

// True when `balances` contains the same currency twice. Callers
// (`draftToValidAccount`) pass the derived valid balances (not raw rows) so
// an empty/invalid duplicate row doesn't block a valid save — [SGD 100,
// SGD ""] is not a duplicate; [SGD 100, SGD 200] is.
export function hasDuplicateCurrencyIn(balances: AccountBalance[]): boolean {
  const currencies = balances.map((balance) => balance.currency);
  return new Set(currencies).size !== currencies.length;
}
