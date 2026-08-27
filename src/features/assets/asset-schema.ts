import { z } from "zod";

import { accountBalanceSchema, type AccountBalance } from "@whole/ocr";
import {
  type AssetKind,
  assetKindSchema,
  lastFourDigitsSchema,
} from "@/features/assets/account-appearance";
import { currencySchema } from "@/features/assets/currencies";

// The stored-data contract for accounts and groups: schemas, the types derived
// from them, and the identity/merge rules every version of the data shares.
// Pure TypeScript — no storage, no Expo — so the recognition engine's rule
// layer and the Node test runner can import it without dragging in
// expo-crypto or kv-store (the repository, which owns persistence, sits on top
// of this module, never the reverse).

export const ASSET_ACCOUNTS_STORAGE_KEY = "whole.assetAccounts";

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
// `accountBalanceSchema`/`AccountBalance` live in `@whole/ocr`'s pure-zod
// `contract/balance.ts` — they're shared with the OCR recognition contract and
// the Node eval harness, which must not pull in this storage module's React
// Native / Expo dependency chain. Consumers import them from `@whole/ocr`
// directly; this module is a peer consumer, not a gateway.

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
// together (e.g. one institution's savings/current/term sub-accounts) render
// as a collapsible group on the home screen. Optional so v2/v3 accounts (which
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
// only read leaf accounts). `institutionId` is intentionally NOT stored here: it
// is an OCR-pipeline concept, and coupling stored data to it would mean a
// manually-created group named "Bank of China" could not be reused when the
// same institution is re-recognized. Reuse matches by normalized name instead
// (see `findGroupByName` in the repository).
const assetAccountGroupSchema = z.object({
  id: z.string(),
  name: z.string().trim().min(1),
});
export type AssetAccountGroup = z.infer<typeof assetAccountGroupSchema>;

// Legacy v1 shape (one balance + currency per account). Kept only for the
// one-time v1 → v3 migration in asset-migrations.ts; new code never writes
// this shape.
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

export { assetAccountSchema, assetAccountGroupSchema };

export type AssetAccount = z.infer<typeof assetAccountSchema>;
export type V1AssetAccount = z.infer<typeof v1AssetAccountSchema>;
export type StoredAssetAccounts = z.infer<typeof storedAssetAccountsSchema>;
export { storedAssetAccountsSchema, storedV1AssetAccountsSchema };

export type NewAssetAccount = {
  name: string;
  accountLastFourDigits?: string;
  balances: AccountBalance[];
  kind?: AssetKind;
  // When set, the new/merged account joins this group. Absent on re-uploads
  // that don't carry grouping intent, in which case an existing account keeps
  // its current group (see applyAccountUpsert in the repository).
  groupId?: string;
};

// Normalizes the account name for identity comparison: trims, collapses
// whitespace, lower-cases, and strips the `|` separator so it can never leak
// into the business key and create ambiguity. Two screenshots of the same
// account that differ only in casing or spacing then resolve to the same key.
export function normalizeAccountName(name: string): string {
  return name.trim().replace(/\|/g, " ").replace(/\s+/g, " ").toLowerCase();
}

// Business dedup key for an account: group id + normalized product name +
// last four digits when present, else group id + the name alone. Used by
// upsert/update to match "the same account" across re-uploads (same screenshot
// twice → one account with merged balances; same product with different
// last-four digits → distinct accounts). Accounts without a last four
// (brokerage, stock, some wallets) dedupe by name alone. Including `groupId`
// lets two accounts with the same name + last four coexist in DIFFERENT groups
// (e.g. two institutions' "Savings ****1234"), while accounts in the SAME group
// still merge on re-upload. The group prefix is the empty string when an account is
// ungrouped, so legacy v3 data (no groupId) keeps its prior key shape and
// re-uploads still merge. This is NOT the stored primary key —
// `AssetAccount.id` is a stable random id (see createAccountId in the
// repository) so editing the name in the detail page never moves the
// account's identity.
export function accountMatchKey(account: {
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

// Merges an incoming per-currency balance into a list: replaces an existing
// entry for the same currency, otherwise appends. Shared by the v1→v3 migration
// and upsert so the merge rule lives once. Deliberately not re-exported by the
// repository: the screenshot parser sums same-currency rows instead of
// replacing them (an institution overview can list one account's currency
// twice), so it owns its own merge.
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
