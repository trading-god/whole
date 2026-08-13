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
//
// `groupId` (v4) optionally ties an account to an `AssetAccountGroup` — a
// pure naming container (no `kind`, no `balances`) so accounts that belong
// together (e.g. one bank's savings/current/term sub-accounts) render as a
// collapsible group on the home screen. Optional so v2/v3 accounts (which
// predate groups) parse unchanged and stay ungrouped. Group membership is
// invisible to the net-worth/snapshot/flows chain, which reads only
// `account.id` + `account.balances`.
const assetAccountSchema = accountIdentitySchema.extend({
  kind: assetKindSchema,
  balances: z.array(accountBalanceSchema),
  groupId: z.string().optional(),
});

// A group container: a named bucket sub-accounts hang off. Deliberately
// carries no `kind` and no `balances` — it is not an account, so the
// per-kind distribution chart and the balance aggregation skip it (they
// only read leaf accounts). `bankId` is intentionally NOT stored here: it
// is an OCR-pipeline concept, and coupling stored data to it would mean a
// manually-created group named "Bank of China" could not be reused when the
// same bank is re-recognized. Reuse matches by normalized name instead (see
// `findGroupByName`).
const assetAccountGroupSchema = z.object({
  id: z.string(),
  name: z.string().trim().min(1),
});
export type AssetAccountGroup = z.infer<typeof assetAccountGroupSchema>;

// Legacy v1 shape (one balance + currency per account). Kept only for the
// one-time v1 → v3 migration below; new code never writes this shape.
const v1AssetAccountSchema = accountIdentitySchema.extend({
  kind: assetKindSchema,
  balance: z.number(),
  currency: currencySchema,
});

// Stored accounts envelope. `version` accepts v2 (required last four), v3
// (optional last four), and v4 (adds the `groups` array + per-account
// `groupId`): both upgrades were backward-compatible, so v2/v3 data parse
// unchanged under the current schema (v2/v3 records carry no `groups`, which
// is `.optional()`). A record whose version is below 4 is marked `migrated`
// so `listAssetAccounts` rewrites it as v4 on the next save; v4 is the only
// version ever written.
const storedAssetAccountsSchema = z.object({
  version: z.union([z.literal(2), z.literal(3), z.literal(4)]),
  groups: z.array(assetAccountGroupSchema).optional(),
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
  // When set, the new/merged account joins this group. Absent on re-uploads
  // that don't carry grouping intent, in which case an existing account keeps
  // its current group (see applyAccountUpsert).
  groupId?: string;
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

// Business dedup key for an account: group id + normalized product name +
// last four digits when present, else group id + the name alone. Used by
// upsert/update to match "the same account" across re-uploads (same screenshot
// twice → one account with merged balances; same product with different
// last-four digits → distinct accounts). Accounts without a last four
// (brokerage, stock, some wallets) dedupe by name alone. Including `groupId`
// lets two accounts with the same name + last four coexist in DIFFERENT groups
// (e.g. two banks' "Savings ****1234"), while accounts in the SAME group still
// merge on re-upload. The group prefix is the empty string when an account is
// ungrouped, so legacy v3 data (no groupId) keeps its prior key shape and
// re-uploads still merge. This is NOT the stored primary key —
// `AssetAccount.id` is a stable random id (see createAccountId) so editing
// the name in the detail page never moves the account's identity.
function accountMatchKey(account: {
  name: string;
  accountLastFourDigits?: string;
  groupId?: string;
}): string {
  const group = account.groupId ?? "";
  const lastFour = account.accountLastFourDigits?.trim();
  return lastFour
    ? `${group}|${normalizeAccountName(account.name)}|${lastFour}`
    : `${group}|${normalizeAccountName(account.name)}`;
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
  groups: AssetAccountGroup[];
  // True when the stored data was an older version (v1/v2/v3) and has been
  // upgraded in memory; the caller persists the v4 form so the migration never
  // runs twice.
  migrated: boolean;
};

function parseStoredAssetAccounts(
  serializedAccounts: string,
): ParsedStoredAccounts {
  const stored: unknown = JSON.parse(serializedAccounts);

  const parsed = storedAssetAccountsSchema.safeParse(stored);
  if (parsed.success) {
    // v2/v3 records are rewritten as v4 on the next save (migrated: true);
    // v4 is already current. `groups` is `.optional()` so v2/v3 data (which
    // predates groups) parses with it absent — default to empty.
    return {
      accounts: parsed.data.accounts,
      groups: parsed.data.groups ?? [],
      migrated: parsed.data.version < 4,
    };
  }

  const v1 = storedV1AssetAccountsSchema.safeParse(stored);
  if (v1.success) {
    return {
      accounts: migrateV1Accounts(v1.data.accounts),
      groups: [],
      migrated: true,
    };
  }

  throw new Error("Invalid local asset account data");
}

export async function saveAssetAccounts(
  accounts: readonly AssetAccount[],
  groups: readonly AssetAccountGroup[] = [],
) {
  // Validate at the write boundary so a malformed record can never reach disk.
  // A single bad account (e.g. a 2-digit lastFour) or group (e.g. an empty
  // name) would make the whole envelope unparseable on read —
  // parseStoredAssetAccounts rejects the entire blob and throws, so every
  // account would become inaccessible. Constructing callers (upsert/update/
  // migrate/group CRUD) build from validated inputs, but this is the last line
  // of defense if a caller ever bypasses the form-level canSave gate.
  // Parsed for the throw only — zod deep-clones what it returns, and caching
  // that clone would hand every account a new identity on every write,
  // breaking the reference stability the cache below exists to provide.
  z.array(assetAccountSchema).parse(accounts);
  z.array(assetAccountGroupSchema).parse(groups);

  const nextAccounts = [...accounts];
  const nextGroups = [...groups];
  const storedAccounts: StoredAssetAccounts = {
    version: 4,
    accounts: nextAccounts,
    groups: nextGroups,
  };

  await setItem(ASSET_ACCOUNTS_STORAGE_KEY, JSON.stringify(storedAccounts));
  // Update the caches only after persistence succeeds, so a failed write (disk
  // full, SQLite error) leaves the caches matching storage instead of holding
  // a value that was never persisted. Mirrors net-worth-history's
  // cachedSnapshots update order. Both caches share one envelope write, so they
  // stay in lockstep.
  cachedAccounts = nextAccounts;
  cachedGroups = nextGroups;
}

// Caches of the last loaded/written accounts and groups so repeated reads
// (e.g. every home focus) return a stable reference instead of a freshly
// parsed array — which would invalidate the home composition memo and break
// AccountRow's memo (each account would be a new reference) so every row
// re-renders on refocus. Safe because this module is the sole writer of
// ASSET_ACCOUNTS_STORAGE_KEY, and saveAssetAccounts keeps both caches in
// lockstep with storage. Accounts and groups share one envelope (one JSON
// blob, one storage key), so the two caches are always written together and
// never drift apart.
let cachedAccounts: AssetAccount[] | null = null;
let cachedGroups: AssetAccountGroup[] | null = null;
// An in-flight cold load shared by concurrent callers. Without this, the two
// branches of `Promise.all([listAssetAccounts(), listAssetAccountGroups()])`
// would each pass the cache guard on a cold start and read + fully decode the
// envelope twice. Cleared once the load settles so the next cold read is fresh.
let loadPromise: Promise<{
  accounts: AssetAccount[];
  groups: AssetAccountGroup[];
}> | null = null;

// Loads accounts + groups from storage, caching both. Shared by
// `listAssetAccounts` and `listAssetAccountGroups` so the single envelope read
// populates both caches. Persists the upgraded v4 form when the stored record
// was an older version, so the migration is one-shot and idempotent.
function loadFromStorage(): Promise<{
  accounts: AssetAccount[];
  groups: AssetAccountGroup[];
}> {
  if (cachedAccounts !== null && cachedGroups !== null) {
    return Promise.resolve({ accounts: cachedAccounts, groups: cachedGroups });
  }
  if (!loadPromise) {
    loadPromise = (async () => {
      const serializedAccounts = await getItem(ASSET_ACCOUNTS_STORAGE_KEY);

      if (!serializedAccounts) {
        cachedAccounts = [];
        cachedGroups = [];
        return { accounts: cachedAccounts, groups: cachedGroups };
      }

      const { accounts, groups, migrated } =
        parseStoredAssetAccounts(serializedAccounts);

      // Persist the upgraded v4 form so the migration is one-shot and
      // idempotent.
      if (migrated) {
        await saveAssetAccounts(accounts, groups);
      }

      cachedAccounts = accounts;
      cachedGroups = groups;
      return { accounts, groups };
    })().finally(() => {
      loadPromise = null;
    });
  }
  return loadPromise;
}

export async function listAssetAccounts(): Promise<AssetAccount[]> {
  const { accounts } = await loadFromStorage();
  return accounts;
}

// The groups currently in storage. Groups are pure naming containers (no
// balances), so the home screen reads this list to partition accounts into
// collapsible group headers. Empty groups (no child accounts) are kept in
// storage so the user can populate them later, but the home screen hides them.
export async function listAssetAccountGroups(): Promise<AssetAccountGroup[]> {
  const { groups } = await loadFromStorage();
  return groups;
}

// Reads both accounts and groups in one shared envelope load. The
// read-modify-write mutators (`upsertAssetAccounts`, `updateAssetAccount`,
// `removeAssetAccount`, group CRUD) always carry both lists through the save,
// so they share one read instead of repeating the paired lookup five times.
async function readAccountsAndGroups(): Promise<{
  accounts: AssetAccount[];
  groups: AssetAccountGroup[];
}> {
  const [accounts, groups] = await Promise.all([
    listAssetAccounts(),
    listAssetAccountGroups(),
  ]);
  return { accounts, groups };
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
      // Preserve the existing group on a merge when the input doesn't carry
      // grouping intent — a re-upload that omits groupId must not strip an
      // account out of its group. When the input does carry groupId it wins,
      // matching the wizard's explicit grouping decision.
      groupId: input.groupId ?? existing.groupId,
    };
    return;
  }

  next.push({
    id: createAccountId(),
    name: input.name,
    accountLastFourDigits: input.accountLastFourDigits,
    balances: input.balances,
    kind: input.kind ?? "cash",
    groupId: input.groupId,
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
    // Read accounts and groups together (one envelope). Groups are not
    // modified by an upsert — if the wizard created a new group for this
    // batch it did so via `upsertAssetAccountGroup` before calling here, so
    // the cached groups already include it; we just carry it through the save
    // so it isn't dropped. `accounts` is copied before `applyAccountUpsert`
    // mutates it: the read returns the live cached array, and mutating that in
    // place would leak unpersisted changes into the cache on a failed write.
    const { accounts, groups } = await readAccountsAndGroups();
    const next = [...accounts];
    for (const input of inputs) {
      applyAccountUpsert(next, input);
    }
    await saveAssetAccounts(next, groups);
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
  // Group membership, three-state: `undefined` leaves it unchanged, a string
  // moves the account into that group, `null` removes it from its group
  // (turning it back into an ungrouped account). Distinct from `accountLast
  // FourDigits` because group membership IS editable after creation.
  groupId?: string | null;
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
    const { accounts, groups } = await readAccountsAndGroups();
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
      // Three-state group membership (see AssetAccountPatch). `undefined` is
      // "leave unchanged", `null` is "remove from group", a string is "move
      // into this group".
      groupId:
        patch.groupId === undefined
          ? existing.groupId
          : patch.groupId === null
            ? undefined
            : patch.groupId,
    };

    // Reject if another account (different id) already owns this business key
    // — otherwise a later upsert would non-deterministically merge the two.
    // The key now includes groupId, so moving an account into a group that
    // already holds the same name + last four is flagged as a conflict.
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
    await saveAssetAccounts(nextAccounts, groups);
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
    const { accounts, groups } = await readAccountsAndGroups();
    const next = accounts.filter((account) => account.id !== id);
    await saveAssetAccounts(next, groups);
    return next;
  });
}

// Finds a group whose name matches `name` after normalization (trim, collapse
// whitespace, lower-case — the same rule `accountMatchKey` uses). Used by the
// OCR auto-grouping path to REUSE an existing group when the same bank is
// re-recognized, instead of creating a duplicate: a manually-created
// "Bank of China" group is reused by an OCR-suggested "Bank of China", because
// they match by name, not by an OCR-only `bankId` that a manual group would
// lack. Returns `undefined` when no group matches.
export async function findGroupByName(
  name: string,
): Promise<AssetAccountGroup | undefined> {
  const groups = await listAssetAccountGroups();
  const target = normalizeAccountName(name);
  return groups.find((group) => normalizeAccountName(group.name) === target);
}

// Finds a group by normalized name, creating it if absent, and returns it.
// Centralizes the "resolve a display name to a group" idiom both account
// screens use — the add screen's suggested-group step and the detail screen's
// create-institution picker — so the create-then-relookup dance and the
// name-match rule live in one place instead of drifting (one site used to match
// by normalized name, the other by exact string). The existence pre-check is a
// fast path (it avoids a write when the group already exists); the create goes
// through `upsertAssetAccountGroup`, which dedupes by normalized name under the
// `mutate` lock, so a concurrent same-name create can't mint two groups.
export async function findOrCreateGroupByName(
  name: string,
): Promise<AssetAccountGroup> {
  const existing = await findGroupByName(name);
  if (existing) {
    return existing;
  }
  const { groups } = await upsertAssetAccountGroup({ name });
  // The group (created or reused on a race) is guaranteed in `groups` —
  // `upsertAssetAccountGroup` always returns it by normalized name.
  return groups.find(
    (group) => normalizeAccountName(group.name) === normalizeAccountName(name),
  )!;
}

// Result of a group mutation — the caller (use-asset-accounts) adopts both
// lists into its state so the home screen re-renders the grouped layout from a
// single consistent snapshot.
export type GroupMutationResult = {
  accounts: AssetAccount[];
  groups: AssetAccountGroup[];
};

// Creates a new group, or renames an existing one when `input.id` is provided.
// Creating without an id reuses a same-named group (matched by normalized name)
// instead of minting a duplicate. Mints a stable random id for new groups (same
// scheme as `createAccountId`), so renaming a group never moves its identity.
// Serialized through `mutate` so a concurrent account save can't read a
// half-updated groups list; `groups` is copied before mutation so a failed
// write can't leak unpersisted changes into the cache. Empty groups (no child
// accounts) are kept in storage so the user can populate them later; the home
// screen hides them.
export async function upsertAssetAccountGroup(input: {
  id?: string;
  name: string;
}): Promise<GroupMutationResult> {
  return mutate(async () => {
    const { accounts, groups } = await readAccountsAndGroups();
    const nextGroups = [...groups];
    const trimmedName = input.name.trim();
    if (input.id) {
      const index = nextGroups.findIndex((group) => group.id === input.id);
      if (index < 0) {
        // A rename targeting a vanished group degrades to a create, so a
        // concurrent delete elsewhere can't strand the caller.
        nextGroups.push({ id: createAccountId(), name: trimmedName });
      } else {
        nextGroups[index] = { ...nextGroups[index], name: trimmedName };
      }
    } else {
      // Dedupe by normalized name (case/spacing-insensitive): creating a group
      // whose name already exists reuses it instead of adding a duplicate row.
      // This is the serialized backstop for `findOrCreateGroupByName`'s
      // existence pre-check — a concurrent same-name create can't mint two
      // identical group headers.
      const target = normalizeAccountName(trimmedName);
      const existingIndex = nextGroups.findIndex(
        (group) => normalizeAccountName(group.name) === target,
      );
      if (existingIndex >= 0) {
        nextGroups[existingIndex] = {
          ...nextGroups[existingIndex],
          name: trimmedName,
        };
      } else {
        nextGroups.push({ id: createAccountId(), name: trimmedName });
      }
    }
    await saveAssetAccounts(accounts, nextGroups);
    return { accounts, groups: nextGroups };
  });
}

// Removes a group and clears `groupId` on every account that belonged to it —
// the accounts themselves are kept (they become ungrouped). One
// `saveAssetAccounts` write holds both the group removal and the child
// `groupId` clears, so the operation is atomic: a failed write leaves the
// group and its children intact, matching storage. Net worth is unaffected
// (account ids and balances are untouched).
export async function removeAssetAccountGroup(
  id: string,
): Promise<GroupMutationResult> {
  return mutate(async () => {
    const { accounts, groups } = await readAccountsAndGroups();
    const nextGroups = groups.filter((group) => group.id !== id);
    const nextAccounts = accounts.map((account) =>
      account.groupId === id ? { ...account, groupId: undefined } : account,
    );
    await saveAssetAccounts(nextAccounts, nextGroups);
    return { accounts: nextAccounts, groups: nextGroups };
  });
}
