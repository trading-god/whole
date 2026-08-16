// Straight from the package, not through `asset-repository`'s re-export: these
// three originate in `@whole/ocr`'s pure-zod contract, and routing them through
// the storage module would pull `expo-crypto` into this file for nothing —
// which is what put these row rules out of reach of a plain TypeScript test.
import {
  type AccountBalance,
  balanceInputSchema,
  isPartialBalanceEntry,
} from "@whole/ocr";
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

export type BalanceRowClassification = {
  // The row holds a balance the save gate will use — carried along so callers
  // never re-parse to get at it.
  balance?: AccountBalance;
  // The row holds text that is not a balance. "S$100" or "1.2.3" is: the money
  // is there on screen and the save gate drops it, so without this the account
  // saved with that holding silently missing. A blank row is not one — it is
  // the row the user hasn't filled in yet.
  unreadable: boolean;
};

// One parse per row, answering both questions asked of it: does this row hold a
// balance, and if not, is it unreadable. Both the field markers
// (`BalanceRowsField`, on every keystroke) and the save gate
// (`draftToValidAccount`) go through here, so "what is a valid balance input"
// is one rule and one `balanceInputSchema` parse — derived separately they
// disagreed about a half-typed entry, and Save went grey with nothing on screen.
//
// `editing` is the ONLY thing that differs between them: while the user is
// typing in this very row, a half-typed entry is not yet wrong. Without it the
// message appeared under the field at every keystroke of "-4766.92": "-", "-4",
// … "-4766.". Once focus leaves, a row still reading "-4766." is what it looks
// like — an entry that cannot be saved — and says so.
export function classifyBalanceRow(
  row: BalanceRow,
  { editing = false }: { editing?: boolean } = {},
): BalanceRowClassification {
  if (row.balance.trim().length === 0) {
    return { unreadable: false };
  }
  const parsed = balanceInputSchema.safeParse(row.balance);
  if (parsed.success) {
    return {
      balance: { currency: row.currency, balance: parsed.data },
      unreadable: false,
    };
  }
  return { unreadable: !(editing && isPartialBalanceEntry(row.balance)) };
}

// The save gate's view of a whole form's rows, in one pass: the balances to
// store, and whether any row holds text that isn't one.
//
// An unreadable row blocks the save outright rather than being dropped and
// leaving the rest to pass: with two rows where one reads "S$100", the account
// saved with the OTHER currency only and that holding disappeared without a
// word. Blank rows are dropped (a freshly added row can be left blank).
export function classifyBalanceRows(rows: BalanceRow[]): {
  balances: AccountBalance[];
  hasUnreadable: boolean;
} {
  const classified = rows.map((row) => classifyBalanceRow(row));
  return {
    balances: classified.flatMap(({ balance }) => balance ?? []),
    hasUnreadable: classified.some(({ unreadable }) => unreadable),
  };
}

// True when `balances` contains the same currency twice. Callers
// (`draftToValidAccount`) pass the derived valid balances (not raw rows) so
// an empty/invalid duplicate row doesn't block a valid save — [SGD 100,
// SGD ""] is not a duplicate; [SGD 100, SGD 200] is.
export function hasDuplicateCurrencyIn(balances: AccountBalance[]): boolean {
  const currencies = balances.map((balance) => balance.currency);
  return new Set(currencies).size !== currencies.length;
}

export type MarkedBalanceRow = BalanceRowClassification & {
  // The row repeats a currency an earlier COUNTED row already used, so it is
  // the half of the pair the field marks.
  duplicateCurrency: boolean;
};

// The field's whole per-row derivation: classify each row, then mark the ones
// repeating a currency.
//
// Lives here rather than inside `BalanceRowsField` because the duplicate rule is
// the same rule `hasDuplicateCurrencyIn` gives the save gate, asked in a
// per-row form — and two implementations of it in two layers is how the error
// under the field and the grey Save button drift apart. It is also the half a
// runner can reach: this module is plain data-in/data-out, the component is not.
//
// Judged on the rows that actually COUNT, which is what keeps it in step with
// the gate: the gate compares derived balances, so `[SGD 100, SGD ""]` is not a
// duplicate and must not be marked as one. Marked on the LATER of the two — the
// first is the account's balance in that currency, the repeat is the mistake.
//
// One pass, not a per-pair check: this runs on every keystroke in any balance
// field, and a per-pair `safeParse` is O(n²) zod parses (each allocating a
// ZodError on a miss) for an answer one pass over the rows already has.
//
// `editingRowId` is the row the user is typing in, so a half-typed entry is
// left alone until focus leaves it — the one thing that differs between the
// field's view of a row and the gate's (see `classifyBalanceRow`). Matched by
// row id, not index: removing a row shifts every index below it.
export function markBalanceRows(
  rows: readonly BalanceRow[],
  editingRowId: number | null,
): MarkedBalanceRow[] {
  const firstCountedIndexByCurrency = new Map<
    AccountBalance["currency"],
    number
  >();
  const classified = rows.map((row) =>
    classifyBalanceRow(row, { editing: row.id === editingRowId }),
  );
  classified.forEach(({ balance }, index) => {
    if (balance && !firstCountedIndexByCurrency.has(balance.currency)) {
      firstCountedIndexByCurrency.set(balance.currency, index);
    }
  });
  return classified.map((row, index) => {
    const first = row.balance
      ? firstCountedIndexByCurrency.get(row.balance.currency)
      : undefined;
    return { ...row, duplicateCurrency: first !== undefined && first < index };
  });
}
