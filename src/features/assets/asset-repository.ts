import * as Crypto from "expo-crypto";
import { z } from "zod";

import { getItem, setItem } from "@/storage/kv-store";

import { createAsyncSerializer } from "./async-serializer";
import {
  type AssetKind,
  assetKindSchema,
  knownAssetKinds,
} from "@/features/assets/account-appearance";
import {
  type ExchangeRates,
  convertCurrency,
} from "@/features/assets/currency-conversion";
import { type Currency, currencySchema } from "@/features/assets/currencies";

const ASSET_ACCOUNTS_STORAGE_KEY = "whole.assetAccounts";

const LAST_FOUR_DIGITS_PATTERN = /^\d{4}$/;

// Schema for a 4-digit last-four string. Owned here (alongside the pattern) so
// `accountBaseSchema` and `screenshot-recognition.ts` share one definition of
// "what is a valid last four" instead of each re-declaring the regex.
export const lastFourDigitsSchema = z.string().regex(LAST_FOUR_DIGITS_PATTERN);

// Schemas for the persisted account data, replacing the hand-written
// `isAccountBalance`/`isAccountBase`/`isAssetAccount`/`isAssetAccountV1` shape
// guards. zod v4's `z.number()` rejects NaN/Infinity by default (matching the
// old `Number.isFinite` guard); `currencySchema`/`assetKindSchema`/
// `lastFourDigitsSchema` (defined alongside the lists they enumerate) match the
// old `isKnownAssetCurrency`/`isAssetKind`/`isValidLastFourDigits` guards; and
// `safeParse` does the validating. Types are derived via `z.infer` so "what is
// a valid stored account" is defined once alongside the validation, not
// maintained as a parallel interface. Mirrors `storedRatesSchema` in
// currency-conversion.ts.
const accountBalanceSchema = z.object({
  currency: currencySchema,
  balance: z.number(),
});

// Shared base for the v2 and v1 account shapes — only the balance clause
// differs (v2: a `balances` array; v1: a single `balance` + `currency`), so
// `.extend()` shares the id/name/last-four/kind fields instead of the old
// `isAccountBase` helper.
const accountBaseSchema = z.object({
  id: z.string(),
  name: z.string(),
  accountLastFourDigits: lastFourDigitsSchema,
  kind: assetKindSchema,
});

const assetAccountSchema = accountBaseSchema.extend({
  balances: z.array(accountBalanceSchema),
});

// Legacy v1 shape (one balance + currency per account). Kept only for the
// one-time v1 → v2 migration below; new code never writes this shape.
const v1AssetAccountSchema = accountBaseSchema.extend({
  balance: z.number(),
  currency: currencySchema,
});

const storedAssetAccountsSchema = z.object({
  version: z.literal(2),
  accounts: z.array(assetAccountSchema),
});

const storedV1AssetAccountsSchema = z.object({
  version: z.literal(1),
  accounts: z.array(v1AssetAccountSchema),
});

export type AccountBalance = z.infer<typeof accountBalanceSchema>;
export type AssetAccount = z.infer<typeof assetAccountSchema>;
type V1AssetAccount = z.infer<typeof v1AssetAccountSchema>;
type StoredAssetAccounts = z.infer<typeof storedAssetAccountsSchema>;

export type NewAssetAccount = {
  name: string;
  accountLastFourDigits: string;
  balances: AccountBalance[];
  kind?: AssetKind;
};

// Schema for a form-entered balance string: strips grouping separators
// (commas/whitespace) and parses to a non-negative number. Used by the account
// forms' `validBalanceRows` so "what is a valid balance input" is defined once,
// alongside the other balance schemas, instead of a hand-written parse.
// Allows 0 (a real balance), unlike `screenshot-recognition.ts`'s
// `balanceEntrySchema` which drops 0 as model noise.
export const balanceInputSchema = z
  .string()
  .transform((value) => Number(value.replace(/[,\s]/g, "")))
  .pipe(z.number().nonnegative());

// Normalizes the account name for identity comparison: trims, collapses
// whitespace, lower-cases, and strips the `|` separator so it can never leak
// into the business key and create ambiguity. Two screenshots of the same
// account that differ only in casing or spacing then resolve to the same key.
function normalizeAccountName(name: string): string {
  return name.trim().replace(/\|/g, " ").replace(/\s+/g, " ").toLowerCase();
}

// Business dedup key for an account: normalized product name + last four
// digits. Used only by upsert to match "the same account" across re-uploads
// (same screenshot twice → one account with merged balances; same product with
// different last-four digits → distinct accounts). This is NOT the stored
// primary key — `AssetAccount.id` is a stable random id (see createAccountId)
// so editing the name in the detail page never moves the account's identity.
function buildAccountId(name: string, accountLastFourDigits: string): string {
  return `${normalizeAccountName(name)}|${accountLastFourDigits}`;
}

// Mints a stable random primary key for a newly created account. Decoupled
// from the business key (name + last four) so renaming an account never changes
// its id — the React key, nav param, and storage PK all stay put. Random so two
// new accounts can't share an id; same-account dedup still goes through the
// business key in upsert.
function createAccountId(): string {
  return Crypto.randomUUID();
}

// Merges an incoming per-currency balance into a list: replaces an existing
// entry for the same currency, otherwise appends. Shared by the v1→v2
// migration, upsert, and the screenshot parser so the merge rule lives once.
export function mergeBalance(
  balances: AccountBalance[],
  incoming: AccountBalance,
): AccountBalance[] {
  const index = balances.findIndex((b) => b.currency === incoming.currency);
  if (index >= 0) {
    const next = [...balances];
    next[index] = incoming;
    return next;
  }
  return [...balances, incoming];
}

// Converts v1 single-balance accounts to v2 multi-balance accounts,
// regenerating stable ids and deduping by id (same product + last four → one
// account with merged balances). Same-currency collisions resolve to the last
// value, mirroring upsert semantics.
function migrateV1Accounts(v1Accounts: V1AssetAccount[]): AssetAccount[] {
  const byId = new Map<string, AssetAccount>();

  for (const v1 of v1Accounts) {
    const id = buildAccountId(v1.name, v1.accountLastFourDigits);
    const incoming: AccountBalance = {
      currency: v1.currency,
      balance: v1.balance,
    };
    const existing = byId.get(id);
    const balances = existing
      ? mergeBalance(existing.balances, incoming)
      : [incoming];

    byId.set(id, {
      id,
      name: v1.name,
      accountLastFourDigits: v1.accountLastFourDigits,
      balances,
      kind: v1.kind,
    });
  }

  return [...byId.values()];
}

type ParsedStoredAccounts = {
  accounts: AssetAccount[];
  // True when the stored data was v1 and has been upgraded in memory; the
  // caller persists the v2 form so the migration never runs twice.
  migrated: boolean;
};

function parseStoredAssetAccounts(
  serializedAccounts: string,
): ParsedStoredAccounts {
  const stored: unknown = JSON.parse(serializedAccounts);

  const v2 = storedAssetAccountsSchema.safeParse(stored);
  if (v2.success) {
    return { accounts: v2.data.accounts, migrated: false };
  }

  const v1 = storedV1AssetAccountsSchema.safeParse(stored);
  if (v1.success) {
    return { accounts: migrateV1Accounts(v1.data.accounts), migrated: true };
  }

  throw new Error("Invalid local asset account data");
}

export async function saveAssetAccounts(accounts: readonly AssetAccount[]) {
  const storedAccounts: StoredAssetAccounts = {
    version: 2,
    accounts: [...accounts],
  };

  await setItem(ASSET_ACCOUNTS_STORAGE_KEY, JSON.stringify(storedAccounts));
  // Update the cache only after persistence succeeds, so a failed write (disk
  // full, SQLite error) leaves the cache matching storage instead of holding
  // a value that was never persisted. Mirrors net-worth-history's
  // cachedSnapshots update order.
  cachedAccounts = [...accounts];
}

// Cache of the last loaded/written accounts so repeated reads (e.g. every home
// focus) return a stable reference instead of a freshly parsed array — which
// would invalidate the home composition memo and break AccountRow's memo (each
// account would be a new reference) so every row re-renders on refocus. Safe
// because this module is the sole writer of ASSET_ACCOUNTS_STORAGE_KEY, and
// saveAssetAccounts keeps the cache in lockstep with storage.
let cachedAccounts: AssetAccount[] | null = null;

export async function listAssetAccounts(): Promise<AssetAccount[]> {
  if (cachedAccounts) {
    return cachedAccounts;
  }

  const serializedAccounts = await getItem(ASSET_ACCOUNTS_STORAGE_KEY);

  if (!serializedAccounts) {
    cachedAccounts = [];
    return cachedAccounts;
  }

  const { accounts, migrated } = parseStoredAssetAccounts(serializedAccounts);

  // Persist the upgraded v2 form so the migration is one-shot and idempotent.
  if (migrated) {
    await saveAssetAccounts(accounts);
  }

  cachedAccounts = accounts;
  return cachedAccounts;
}

// Aggregates converted balances by asset kind for the home composition chart.
// Returns both the per-kind totals and the grand total from a single pass, so
// the distribution percentages and the "no data" decision share one consistent
// denominator. Callers wanting only the grand total read `.total`.
//
// Each balance is converted independently, so a missing rate for one currency
// skips just that currency (not the whole account) — an account holding SGD
// and HKD still contributes its SGD balance when only HKD lacks a rate.
export function sumBalancesByKindInCurrency(
  accounts: readonly AssetAccount[],
  targetCurrency: Currency,
  rates: ExchangeRates,
): { totals: Record<AssetKind, number>; total: number | null } {
  const totals = {} as Record<AssetKind, number>;
  for (const kind of knownAssetKinds) {
    totals[kind] = 0;
  }
  let total = 0;
  let contributed = false;
  for (const account of accounts) {
    for (const balance of account.balances) {
      const converted = convertCurrency(
        balance.balance,
        balance.currency,
        targetCurrency,
        rates,
      );
      if (converted !== null) {
        totals[account.kind] += converted;
        total += converted;
        contributed = true;
      }
    }
  }
  return { totals, total: contributed ? total : null };
}

type UpsertAssetAccountResult = {
  account: AssetAccount;
  created: boolean;
};

// Serializes account mutations so two concurrent calls (e.g. a double-tapped
// save) can't both read the same account list and clobber each other's write —
// each run sees the previous run's result. Shared by upsert and update, which
// both read-then-write the same accounts array and storage key.
const mutate = createAsyncSerializer();

// Creates or merges an account by its business key (name + last four digits).
// Same product + last four digits resolves to an existing account whose
// per-currency balances are merged (same currency → incoming balance wins; new
// currency → appended; currencies absent from input are retained), so
// re-uploading a screenshot updates balances instead of spawning a duplicate.
// Different last-four digits resolve to a new account, keeping multiple
// same-product accounts distinct. The match is by business key, NOT by id —
// ids are opaque random PKs (createAccountId), so id-equality would miss an
// existing account after its name was edited. The existing account's id is
// preserved on merge so editing never moves the PK. `kind` defaults to "cash"
// for new accounts and otherwise follows the input, falling back to the
// existing kind defensively.
export function upsertAssetAccount(
  input: NewAssetAccount,
): Promise<UpsertAssetAccountResult> {
  const run = async (): Promise<UpsertAssetAccountResult> => {
    const businessKey = buildAccountId(input.name, input.accountLastFourDigits);
    const accounts = await listAssetAccounts();
    const index = accounts.findIndex(
      (account) =>
        buildAccountId(account.name, account.accountLastFourDigits) ===
        businessKey,
    );

    if (index >= 0) {
      const existing = accounts[index];
      const balances = input.balances.reduce(mergeBalance, existing.balances);
      const updated: AssetAccount = {
        id: existing.id,
        name: input.name,
        accountLastFourDigits: input.accountLastFourDigits,
        balances,
        kind: input.kind ?? existing.kind,
      };
      const nextAccounts = [...accounts];
      nextAccounts[index] = updated;
      await saveAssetAccounts(nextAccounts);
      return { account: updated, created: false };
    }

    const newAccount: AssetAccount = {
      id: createAccountId(),
      name: input.name,
      accountLastFourDigits: input.accountLastFourDigits,
      balances: input.balances,
      kind: input.kind ?? "cash",
    };
    await saveAssetAccounts([...accounts, newAccount]);
    return { account: newAccount, created: true };
  };

  return mutate(run);
}

export type AssetAccountPatch = {
  name: string;
  balances: AccountBalance[];
  kind: AssetKind;
};

export type UpdateAssetAccountError =
  { kind: "notFound" } | { kind: "conflict"; conflictingAccountName: string };

export type UpdateAssetAccountResult =
  | { ok: true; account: AssetAccount }
  | { ok: false; error: UpdateAssetAccountError };

// Updates an account by its stable id — the detail page's save path. name,
// balances, and kind are replaced wholesale (balances are NOT merged — that is
// upsert's job — so a currency row the user deleted actually disappears). The
// last four digits are immutable: they're never in the patch, so the account
// keeps its existing lastFour. The id is preserved, so renaming the account
// doesn't move its PK/React key/nav param. Returns a result union (not a
// throw) so the caller can branch: `notFound` when the account was deleted
// elsewhere (bail to overview), `conflict` when the new name + the account's
// existing lastFour collides with a DIFFERENT account's business key (prompt
// the user to pick another name — reachable when two accounts share lastFour
// and one is renamed to match the other's product).
export function updateAssetAccount(
  id: string,
  patch: AssetAccountPatch,
): Promise<UpdateAssetAccountResult> {
  const run = async (): Promise<UpdateAssetAccountResult> => {
    const accounts = await listAssetAccounts();
    const index = accounts.findIndex((account) => account.id === id);

    if (index < 0) {
      return { ok: false, error: { kind: "notFound" } };
    }

    const existing = accounts[index];
    const updated: AssetAccount = {
      id: existing.id,
      name: patch.name,
      accountLastFourDigits: existing.accountLastFourDigits,
      balances: patch.balances,
      kind: patch.kind,
    };

    // Reject if another account (different id) already owns this business key
    // — otherwise a later upsert would non-deterministically merge the two.
    const newBusinessKey = buildAccountId(
      updated.name,
      updated.accountLastFourDigits,
    );
    const conflictIndex = accounts.findIndex(
      (account) =>
        account.id !== id &&
        buildAccountId(account.name, account.accountLastFourDigits) ===
          newBusinessKey,
    );
    if (conflictIndex >= 0) {
      return {
        ok: false,
        error: {
          kind: "conflict",
          conflictingAccountName: accounts[conflictIndex].name,
        },
      };
    }

    const nextAccounts = [...accounts];
    nextAccounts[index] = updated;
    await saveAssetAccounts(nextAccounts);
    return { ok: true, account: updated };
  };

  return mutate(run);
}
