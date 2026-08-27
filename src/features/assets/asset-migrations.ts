import { type AccountBalance } from "@whole/ocr";

import {
  accountMatchKey,
  type AssetAccount,
  type AssetAccountGroup,
  mergeBalance,
  storedAssetAccountsSchema,
  storedV1AssetAccountsSchema,
  type V1AssetAccount,
} from "@/features/assets/asset-schema";

// One-time upgrades of the stored envelope: the v1 → v3 multi-balance
// conversion and the parse-and-mark step every load runs through. Pure — it
// takes the serialized blob and returns the in-memory shape plus a
// "needs rewriting" flag; the repository owns the actual re-persist.

export type ParsedStoredAccounts = {
  accounts: AssetAccount[];
  groups: AssetAccountGroup[];
  // True when the stored data was an older version (v1/v2/v3) and has been
  // upgraded in memory; the caller persists the v4 form so the migration never
  // runs twice.
  migrated: boolean;
};

// Converts v1 single-balance accounts to v3 multi-balance accounts,
// regenerating stable ids and deduping by id (same product + last four → one
// account with merged balances). Same-currency collisions resolve to the last
// value, mirroring upsert semantics.
export function migrateV1Accounts(
  v1Accounts: V1AssetAccount[],
): AssetAccount[] {
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

export function parseStoredAssetAccounts(
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
