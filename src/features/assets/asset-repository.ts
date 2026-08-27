import * as Crypto from "expo-crypto";
import { z } from "zod";

import { getItem, setItem } from "@/storage/kv-store";

import { createAsyncSerializer } from "./async-serializer";
import type { AccountBalance } from "@whole/ocr";
import {
  ASSET_ACCOUNTS_STORAGE_KEY,
  accountMatchKey,
  type AssetAccount,
  type AssetAccountGroup,
  assetAccountGroupSchema,
  assetAccountSchema,
  mergeBalance,
  type NewAssetAccount,
  normalizeAccountName,
  type StoredAssetAccounts,
} from "@/features/assets/asset-schema";
import { parseStoredAssetAccounts } from "@/features/assets/asset-migrations";
import {
  type AssetKind,
  knownAssetKinds,
} from "@/features/assets/account-appearance";
import {
  type ExchangeRates,
  convertCurrency,
} from "@/features/assets/currency-conversion";
import {
  type Currency,
  type CurrencyAmounts,
  mapCurrencies,
} from "@/features/assets/currencies";

// The persistence layer for accounts and groups: validated reads/writes over
// kv-store, the in-memory caches, the mutation lock, and the read-modify-write
// CRUD. The data contract itself lives in asset-schema.ts and the one-time
// version upgrades in asset-migrations.ts — both pure, so the Node test runner
// can import them without this module's expo-crypto / kv-store chain.

// Re-exported for the app's existing import paths: types and the identity
// rules moved to asset-schema.ts, and consumers should not have to know that.
export type {
  AssetAccount,
  AssetAccountGroup,
  NewAssetAccount,
} from "@/features/assets/asset-schema";
export {
  accountMatchKey,
  normalizeAccountName,
} from "@/features/assets/asset-schema";

// Mints a stable random primary key for a newly created account. Decoupled
// from the business key (name + last four) so renaming an account never changes
// its id — the React key, nav param, and storage PK all stay put. Random so two
// new accounts can't share an id; same-account dedup still goes through the
// business key in upsert.
function createAccountId(): string {
  return Crypto.randomUUID();
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
//
// Exported for `accounts-query.ts` to use as its `queryFn`: the two lists share
// one envelope, so fetching them as one query keeps them consistent with each
// other. Reading them as two queries could interleave a write between them and
// pair a fresh account list with a stale group list.
export async function readAccountsAndGroups(): Promise<{
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
// OCR auto-grouping path to REUSE an existing group when the same institution
// is re-recognized, instead of creating a duplicate: a manually-created
// "Bank of China" group is reused by an OCR-suggested "Bank of China", because
// they match by name, not by an OCR-only `institutionId` that a manual group
// would lack. Returns `undefined` when no group matches.
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
// by normalized name, the other by exact string). The existence pre-check is
// a fast path (it avoids a write when the group already exists); the create goes
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
