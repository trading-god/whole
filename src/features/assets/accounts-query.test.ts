import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  accountsQueryKey,
  cachedAccounts,
  fetchAccounts,
  removeAccount,
} from "@/features/assets/accounts-query";
import {
  readAccountsAndGroups,
  removeAssetAccount,
} from "@/features/assets/asset-repository";

// The repository is mocked because it reaches sqlite and expo-crypto; what is
// under test is the cache-coherence rule around it, not storage itself.
vi.mock("@/features/assets/asset-repository", () => ({
  readAccountsAndGroups: vi.fn(),
  removeAssetAccount: vi.fn(),
}));

const readMock = vi.mocked(readAccountsAndGroups);
const removeAccountMock = vi.mocked(removeAssetAccount);

function account(id: string, name = id) {
  return {
    id,
    name,
    kind: "cash" as const,
    balances: [{ currency: "SGD" as const, balance: 100 }],
  };
}

// A promise whose resolution this test controls, so a read can be held open
// across a delete — the interleaving the guard exists for.
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function testClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("removeAccount vs. an in-flight read", () => {
  it("does not let a read that started before the delete resurrect the account", async () => {
    // THE case this whole migration is for. The home screen loads accounts on
    // focus; deleting a row while that load is still in flight used to let the
    // stale result land afterwards and put the deleted account back on screen —
    // and the next save then wrote it back to storage.
    const client = testClient();
    const slowRead = deferred<{ accounts: unknown[]; groups: unknown[] }>();
    readMock.mockReturnValue(
      slowRead.promise as ReturnType<typeof readAccountsAndGroups>,
    );

    const reading = fetchAccounts(client).catch(() => undefined);

    removeAccountMock.mockResolvedValue([account("b")]);
    await removeAccount(client, "a");

    // The read now answers with the world as it was BEFORE the delete.
    slowRead.resolve({ accounts: [account("a"), account("b")], groups: [] });
    await reading;

    expect(cachedAccounts(client)?.map((entry) => entry.id)).toEqual(["b"]);
  });

  it("keeps the group list across an account removal", async () => {
    // `removeAssetAccount` returns only accounts; the cache entry has to stay a
    // complete snapshot or the home screen loses its group headers.
    const client = testClient();
    const groups = [{ id: "g1", name: "Bank of China" }];
    client.setQueryData(accountsQueryKey, {
      accounts: [account("a"), account("b")],
      groups,
    });

    removeAccountMock.mockResolvedValue([account("b")]);
    await removeAccount(client, "a");

    expect(client.getQueryData(accountsQueryKey)).toEqual({
      accounts: [account("b")],
      groups,
    });
  });

  it("rejects when storage fails, and leaves the cache untouched", async () => {
    // The home screen shows an alert on rejection. Committing anything here
    // would make the UI disagree with storage — the account would vanish from
    // the screen and come back on the next focus.
    const client = testClient();
    client.setQueryData(accountsQueryKey, {
      accounts: [account("a")],
      groups: [],
    });
    removeAccountMock.mockRejectedValue(new Error("disk full"));

    await expect(removeAccount(client, "a")).rejects.toThrow("disk full");
    expect(cachedAccounts(client)?.map((entry) => entry.id)).toEqual(["a"]);
  });

  it("serializes concurrent removals through the repository", async () => {
    // Both removals must reach storage. The repository's `mutate` lock is what
    // orders them — it stays there rather than moving to a mutation scope,
    // because the add/edit screens write without going through this module.
    const client = testClient();
    removeAccountMock
      .mockResolvedValueOnce([account("b"), account("c")])
      .mockResolvedValueOnce([account("c")]);

    await Promise.all([removeAccount(client, "a"), removeAccount(client, "b")]);

    expect(removeAccountMock).toHaveBeenCalledTimes(2);
    expect(cachedAccounts(client)?.map((entry) => entry.id)).toEqual(["c"]);
  });
});

describe("fetchAccounts", () => {
  it("dedupes concurrent reads into one storage hit", async () => {
    // Pull-to-refresh landing during a focus load should share the read, not
    // race it.
    const client = testClient();
    readMock.mockResolvedValue({ accounts: [account("a")], groups: [] });

    await Promise.all([fetchAccounts(client), fetchAccounts(client)]);

    expect(readMock).toHaveBeenCalledTimes(1);
  });

  it("reports no accounts before the first load", () => {
    expect(cachedAccounts(testClient())).toBeNull();
  });
});
