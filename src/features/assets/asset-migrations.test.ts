import { describe, expect, it } from "vitest";

import {
  migrateV1Accounts,
  parseStoredAssetAccounts,
} from "@/features/assets/asset-migrations";
import { mergeBalance } from "@/features/assets/asset-schema";

describe("migrateV1Accounts", () => {
  it("converts single-balance accounts to the multi-balance shape", () => {
    const [migrated] = migrateV1Accounts([
      {
        id: "old-id",
        name: "OCBC 360",
        accountLastFourDigits: "1234",
        kind: "cash",
        balance: 1234.56,
        currency: "SGD",
      },
    ]);
    expect(migrated).toEqual({
      // The v1 id is replaced by the business key, not carried over.
      id: "|ocbc 360|1234",
      name: "OCBC 360",
      accountLastFourDigits: "1234",
      kind: "cash",
      balances: [{ currency: "SGD", balance: 1234.56 }],
    });
  });

  it("merges same-key v1 accounts into one, last balance winning per currency", () => {
    const migrated = migrateV1Accounts([
      { id: "a", name: "Savings", kind: "cash", balance: 1, currency: "SGD" },
      { id: "b", name: "Savings", kind: "cash", balance: 2, currency: "SGD" },
      { id: "c", name: "Savings", kind: "cash", balance: 3, currency: "USD" },
    ]);
    expect(migrated).toHaveLength(1);
    expect(migrated[0].balances).toEqual([
      { currency: "SGD", balance: 2 },
      { currency: "USD", balance: 3 },
    ]);
  });
});

describe("parseStoredAssetAccounts", () => {
  it("marks v2/v3 records as needing the v4 rewrite, v4 as current", () => {
    const v3 = JSON.stringify({
      version: 3,
      accounts: [{ id: "a", name: "A", kind: "cash", balances: [] }],
    });
    expect(parseStoredAssetAccounts(v3).migrated).toBe(true);

    const v4 = JSON.stringify({
      version: 4,
      groups: [{ id: "g", name: "Group" }],
      accounts: [
        { id: "a", name: "A", kind: "cash", balances: [], groupId: "g" },
      ],
    });
    const parsed = parseStoredAssetAccounts(v4);
    expect(parsed.migrated).toBe(false);
    expect(parsed.groups).toEqual([{ id: "g", name: "Group" }]);
  });

  it("defaults absent groups to empty for v2/v3 data", () => {
    const parsed = parseStoredAssetAccounts(
      JSON.stringify({
        version: 3,
        accounts: [{ id: "a", name: "A", kind: "cash", balances: [] }],
      }),
    );
    expect(parsed.groups).toEqual([]);
  });

  it("rejects an envelope that matches no known version", () => {
    expect(() =>
      parseStoredAssetAccounts(JSON.stringify({ version: 99, accounts: [] })),
    ).toThrow("Invalid local asset account data");
  });
});

describe("mergeBalance", () => {
  it("replaces the same currency and appends a new one", () => {
    const balances = [
      { currency: "SGD" as const, balance: 1 },
      { currency: "USD" as const, balance: 2 },
    ];
    expect(mergeBalance(balances, { currency: "SGD", balance: 10 })).toEqual([
      { currency: "SGD", balance: 10 },
      { currency: "USD", balance: 2 },
    ]);
    expect(mergeBalance(balances, { currency: "HKD", balance: 3 })).toEqual([
      { currency: "SGD", balance: 1 },
      { currency: "USD", balance: 2 },
      { currency: "HKD", balance: 3 },
    ]);
  });
});
