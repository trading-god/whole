import * as Crypto from "expo-crypto";
import { z } from "zod";

import { getItem, setItem } from "@/storage/kv-store";

import { createAsyncSerializer } from "./async-serializer";
import { accountBalanceSchema } from "./account-balance-schema";
import type { AccountBalance } from "./account-balance-schema";
import {
  type AssetKind,
  assetKindSchema,
  knownAssetKinds,
  lastFourDigitsSchema,
} from "@/features/assets/account-appearance";
import {
  type ExchangeRates,
  convertCurrency,
} from "@/features/assets/currency-conversion";
import {
  type Currency,
  type CurrencyAmounts,
  currencySchema,
  mapCurrencies,
} from "@/features/assets/currencies";

const ASSET_ACCOUNTS_STORAGE_KEY = "whole.assetAccounts";

// Form-input variant: the last four is optional (brokerage/stock accounts may
// not have a card number), so an empty string is also valid. Shared by every
// account form's save gate so "empty or exactly 4 digits" is defined once.
export const optionalLastFourDigitsSchema = lastFourDigitsSchema.or(
  z.literal(""),
);

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
// `accountBalanceSchema`/`AccountBalance` live in their own pure-zod module
// (`account-balance-schema.ts`) — they're shared with the OCR recognition
// contract and the Node eval harness, which must not pull in this storage
// module's React Native / Expo dependency chain.
export { accountBalanceSchema } from "./account-balance-schema";

// Shared identity fields across every account kind — the stable per-account
// attributes that don't depend on what the account holds. `lastFourDigits` is
// optional so accounts without a card-style number (brokerage, stock, some
// wallets) are first-class; the dedup key in `accountMatchKey` degrades from
// name|lastFour to name alone when it's absent.
const accountIdentitySchema = z.object({
  id: z.string(),
  name: z.string(),
  accountLastFourDigits: lastFourDigitsSchema.optional(),
});

// Stored account shape. Every kind currently carries the same `balances`
// array (balance-aggregation code reads `account.balances` without narrowing
// on `kind`), so the shape is flat rather than a per-kind discriminated
// union — add the union when a kind actually diverges (e.g. `holdings` on
// investment), at which point TypeScript narrowing earns its keep.
const assetAccountSchema = accountIdentitySchema.extend({
  kind: assetKindSchema,
  balances: z.array(accountBalanceSchema),
});

// Legacy v1 shape (one balance + currency per account). Kept only for the
// one-time v1 → v3 migration below; new code never writes this shape.
const v1AssetAccountSchema = accountIdentitySchema.extend({
  kind: assetKindSchema,
  balance: z.number(),
  currency: currencySchema,
});

// Stored accounts envelope. `version` accepts both v2 (required last four) and
// v3 (optional last four): making `accountLastFourDigits` optional was
// backward-compatible, so v2 data parses unchanged under the current schema. A
// v2 record is marked `migrated` so `listAssetAccounts` rewrites it as v3 on
// the next save; v3 is the only version ever written.
const storedAssetAccountsSchema = z.object({
  version: z.union([z.literal(2), z.literal(3)]),
  accounts: z.array(assetAccountSchema),
});

const storedV1AssetAccountsSchema = z.object({
  version: z.literal(1),
  accounts: z.array(v1AssetAccountSchema),
});

export type { AccountBalance } from "./account-balance-schema";
export type AssetAccount = z.infer<typeof assetAccountSchema>;
type V1AssetAccount = z.infer<typeof v1AssetAccountSchema>;
type StoredAssetAccounts = z.infer<typeof storedAssetAccountsSchema>;

export type NewAssetAccount = {
  name: string;
  accountLastFourDigits?: string;
  balances: AccountBalance[];
  kind?: AssetKind;
};

// Schema for a form-entered balance string: strips grouping separators
// (commas/whitespace) and parses to a non-negative number. Used by the account
// forms' `deriveValidBalances` so "what is a valid balance input" is defined
// once, alongside the other balance schemas, instead of a hand-written parse.
// Allows 0 (a real balance).
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
// digits when present, else the name alone. Used by upsert/update to match
// "the same account" across re-uploads (same screenshot twice → one account
// with merged balances; same product with different last-four digits →
// distinct accounts). Accounts without a last four (brokerage, stock, some
// wallets) dedupe by name alone. This is NOT the stored primary key —
// `AssetAccount.id` is a stable random id (see createAccountId) so editing
// the name in the detail page never moves the account's identity.
function accountMatchKey(account: {
  name: string;
  accountLastFourDigits?: string;
}): string {
  const lastFour = account.accountLastFourDigits?.trim();
  return lastFour
    ? `${normalizeAccountName(account.name)}|${lastFour}`
    : normalizeAccountName(account.name);
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
// entry for the same currency, otherwise appends. Shared by the v1→v3 migration
// and upsert so the merge rule lives once. Deliberately module-private: the
// screenshot parser sums same-currency rows instead of replacing them (a bank
// overview can list one account's currency twice), so it owns its own merge.
function mergeBalance(
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

// Converts v1 single-balance accounts to v3 multi-balance accounts,
// regenerating stable ids and deduping by id (same product + last four → one
// account with merged balances). Same-currency collisions resolve to the last
// value, mirroring upsert semantics.
function migrateV1Accounts(v1Accounts: V1AssetAccount[]): AssetAccount[] {
  const byId = new Map<string, AssetAccount>();

  for (const v1 of v1Accounts) {
    const id = accountMatchKey(v1);
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
  // True when the stored data was an older version (v1 or v2) and has been
  // upgraded in memory; the caller persists the v3 form so the migration never
  // runs twice.
  migrated: boolean;
};

function parseStoredAssetAccounts(
  serializedAccounts: string,
): ParsedStoredAccounts {
  const stored: unknown = JSON.parse(serializedAccounts);

  const parsed = storedAssetAccountsSchema.safeParse(stored);
  if (parsed.success) {
    // v2 records are rewritten as v3 on the next save (migrated: true); v3 is
    // already current. Making lastFour optional was backward-compatible, so v2
    // data parses unchanged under the current union.
    return {
      accounts: parsed.data.accounts,
      migrated: parsed.data.version === 2,
    };
  }

  const v1 = storedV1AssetAccountsSchema.safeParse(stored);
  if (v1.success) {
    return { accounts: migrateV1Accounts(v1.data.accounts), migrated: true };
  }

  throw new Error("Invalid local asset account data");
}

export async function saveAssetAccounts(accounts: readonly AssetAccount[]) {
  // Validate at the write boundary so a malformed account can never reach disk.
  // A single bad record (e.g. a 2-digit lastFour) would make the whole list
  // unparseable on read — parseStoredAssetAccounts rejects the entire array and
  // throws, so every account would become inaccessible. Constructing callers
  // (upsert/update/migrate) build from validated inputs, but this is the last
  // line of defense if a caller ever bypasses the form-level canSave gate.
  // Parsed for the throw only — zod deep-clones what it returns, and caching
  // that clone would hand every account a new identity on every write,
  // breaking the reference stability the cache below exists to provide.
  z.array(assetAccountSchema).parse(accounts);

  const next = [...accounts];
  const storedAccounts: StoredAssetAccounts = { version: 3, accounts: next };

  await setItem(ASSET_ACCOUNTS_STORAGE_KEY, JSON.stringify(storedAccounts));
  // Update the cache only after persistence succeeds, so a failed write (disk
  // full, SQLite error) leaves the cache matching storage instead of holding
  // a value that was never persisted. Mirrors net-worth-history's
  // cachedSnapshots update order.
  cachedAccounts = next;
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

  // Persist the upgraded v3 form so the migration is one-shot and idempotent.
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

// The accounts' worth in every known currency, for the per-currency net-worth
// snapshot. A currency with nothing convertible yields 0 rather than null: with
// complete rates (which the snapshot path requires) the only way to convert
// nothing is to hold nothing, and holding nothing is genuinely zero — not
// "unknown", which is what null means to the display paths.
export function sumBalancesInEveryCurrency(
  accounts: readonly AssetAccount[],
  rates: ExchangeRates,
): CurrencyAmounts {
  return mapCurrencies(
    (currency) =>
      sumBalancesByKindInCurrency(accounts, currency, rates).total ?? 0,
  );
}

// Serializes account mutations so two concurrent calls (e.g. a double-tapped
// save) can't both read the same account list and clobber each other's write —
// each run sees the previous run's result. Shared by upsert and update, which
// both read-then-write the same accounts array and storage key.
const mutate = createAsyncSerializer();

// Applies one upsert to `next` in place: merges into the account whose
// business key matches `input`, else appends a newly created account. The
// business key is name + last four digits when present, else the name alone
// (see `accountMatchKey`): same product + last four resolves to an existing
// account whose per-currency balances are merged via `mergeBalance` (same
// currency → incoming balance wins; new currency → appended; currencies
// absent from input are retained), so re-uploading a screenshot updates
// balances instead of spawning a duplicate. Different last-four digits
// resolve to a new account, keeping multiple same-product accounts distinct;
// accounts without a last four (brokerage, stock) dedupe by name alone. The
// match is by business key, NOT by id — ids are opaque random PKs
// (createAccountId), so id-equality would miss an existing account after its
// name was edited. The existing account's id is preserved on merge so editing
// never moves the PK. `kind` defaults to "cash" for new accounts and
// otherwise follows the input, falling back to the existing kind defensively.
// `next` is a fresh copy the caller owns; this mutates it, not the cached
// account list.
function applyAccountUpsert(next: AssetAccount[], input: NewAssetAccount) {
  const businessKey = accountMatchKey(input);
  const index = next.findIndex(
    (account) => accountMatchKey(account) === businessKey,
  );

  if (index >= 0) {
    const existing = next[index];
    next[index] = {
      id: existing.id,
      name: input.name,
      // A merge matches on the business key, so input and existing share the
      // same last-four state; fall back to existing defensively so an
      // undefined input lastFour can never erase a present one.
      accountLastFourDigits:
        input.accountLastFourDigits ?? existing.accountLastFourDigits,
      balances: input.balances.reduce(mergeBalance, existing.balances),
      kind: input.kind ?? existing.kind,
    };
    return;
  }

  next.push({
    id: createAccountId(),
    name: input.name,
    accountLastFourDigits: input.accountLastFourDigits,
    balances: input.balances,
    kind: input.kind ?? "cash",
  });
}

// True when two or more of `inputs` share a business key (accountMatchKey).
// The wizard uses this to block a batch save that would otherwise silently
// merge same-key drafts: applyAccountUpsert searches the whole `next` array
// (including accounts added earlier in the same batch), so a second draft with
// the same name + last-four would merge into the first — and for a shared
// currency mergeBalance overwrites (last-wins), permanently losing a balance.
// The user must differentiate (rename or enter a different last four) so each
// draft saves as a distinct account.
export function hasDuplicateAccountKeys(
  inputs: readonly NewAssetAccount[],
): boolean {
  const keys = inputs.map(accountMatchKey);
  return new Set(keys).size !== keys.length;
}

// Creates or merges many accounts in one read-modify-write pass — the
// multi-account wizard's "save all". Each input matches an existing account by
// business key (accountMatchKey): a match merges per-currency balances (same
// currency → incoming wins; new currency → appended; absent currencies
// retained), a miss mints a new account. Serialized through `mutate` so a
// concurrent `updateAssetAccount` (or another batch) can't read the same
// cached list and clobber this write —
// the whole batch is one read-modify-write under the shared lock. The batch is
// a single `saveAssetAccounts` write, so it is inherently all-or-nothing; no
// `withTransaction` is needed (one would only wrap a write that's already
// atomic, and would mask the cache/storage divergence a failed commit would
// cause). Inputs that share a business key with each other (e.g. two recognized
// accounts with the same name and last four) merge into the same target,
// last-wins per currency.
export async function upsertAssetAccounts(
  inputs: readonly NewAssetAccount[],
): Promise<void> {
  await mutate(async () => {
    const next = [...(await listAssetAccounts())];
    for (const input of inputs) {
      applyAccountUpsert(next, input);
    }
    await saveAssetAccounts(next);
  });
}

export type AssetAccountPatch = {
  name: string;
  balances: AccountBalance[];
  kind: AssetKind;
  // Optional last four. Fill-once: it only takes effect when the account has
  // no last four yet (accounts created without one — brokerage, stock, etc.);
  // updateAssetAccount always keeps an existing value, so a patch can never
  // rewrite this identity field.
  accountLastFourDigits?: string;
};

export type UpdateAssetAccountError =
  { kind: "notFound" } | { kind: "conflict"; conflictingAccountName: string };

export type UpdateAssetAccountResult =
  | { ok: true; account: AssetAccount }
  | { ok: false; error: UpdateAssetAccountError };

// Updates an account by its stable id — the detail page's save path. name,
// balances, and kind are replaced wholesale (balances are NOT merged — that is
// upsert's job — so a currency row the user deleted actually disappears). The
// last four is fill-once: an existing value always wins (it is the account's
// immutable identity — no caller can rewrite or hijack it), and the patch
// value lands only when the account had none. The edit screen's field lock
// mirrors this rule as UX. The id is preserved, so renaming the
// account doesn't move its PK/React key/nav param. Returns a result union (not a
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
      // Fill-once: an existing last four is immutable identity and always
      // wins; the patch only fills a previously-empty one.
      accountLastFourDigits:
        existing.accountLastFourDigits ?? patch.accountLastFourDigits,
      balances: patch.balances,
      kind: patch.kind,
    };

    // Reject if another account (different id) already owns this business key
    // — otherwise a later upsert would non-deterministically merge the two.
    const newBusinessKey = accountMatchKey(updated);
    const conflictIndex = accounts.findIndex(
      (account) =>
        account.id !== id && accountMatchKey(account) === newBusinessKey,
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

// Removes an account by id under the shared `mutate` lock so a concurrent
// upsert/update (or another remove) can't read the same list and clobber this
// write — the home screen's remove and the add/edit screens' saves all write
// ASSET_ACCOUNTS_STORAGE_KEY, so they share one serializer. Returns the
// post-remove list so the caller updates its in-memory cache and UI from
// storage, rather than filtering a ref that may not yet reflect a concurrent
// save (which would drop the just-saved account from the written list).
export async function removeAssetAccount(id: string): Promise<AssetAccount[]> {
  return mutate(async () => {
    const next = (await listAssetAccounts()).filter(
      (account) => account.id !== id,
    );
    await saveAssetAccounts(next);
    return next;
  });
}
