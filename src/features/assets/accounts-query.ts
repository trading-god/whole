import { type QueryClient, queryOptions } from "@tanstack/react-query";

import {
  type AssetAccount,
  type AssetAccountGroup,
  readAccountsAndGroups,
  removeAssetAccount,
} from "@/features/assets/asset-repository";

// The accounts and groups the app is showing, as one cache entry.
//
// Unlike the exchange rates, this is NOT server state — it is local sqlite, and
// `asset-repository` remains its owner and its only writer. What the query cache
// buys here is narrower and specific: `cancelQueries` gives a first-class,
// documented way to say "a delete just landed, so any read still in flight is
// describing a world that no longer exists". That rule used to be three
// hand-written copies of capture-the-ref-before-the-await/compare-after, and
// getting it wrong resurrected a deleted account.
//
// Consequences of it being local, which the settings below encode:
//   - it is never persisted to disk (see `shouldDehydrateQuery` in
//     `query-client.ts`) — the repository's own versioned envelope is the disk
//     format, and a second copy would be a second source of truth;
//   - `staleTime: 0`, because re-reading is nearly free: the repository serves a
//     cached array, so an unchanged list comes back reference-identical and
//     nothing re-renders.

export type AccountsSnapshot = {
  accounts: readonly AssetAccount[];
  groups: readonly AssetAccountGroup[];
};

export const accountsQueryKey = ["accounts"] as const;

export function accountsQueryOptions() {
  return queryOptions({
    queryKey: accountsQueryKey,
    queryFn: readAccountsAndGroups,
    // Local reads never wait on a connection. Under the default `online` mode
    // these would sit in `fetchStatus: 'paused'` whenever netinfo reports
    // offline — over data that is already on the device.
    networkMode: "always",
    staleTime: 0,
    gcTime: Infinity,
  });
}

// Applies the result of a repository mutation to the cache.
//
// `removeAssetAccount` returns only the account list, because group membership
// is untouched by an account removal; the group list is carried over from
// whatever the cache already holds so the entry stays a complete snapshot.
function commitAccounts(
  client: QueryClient,
  accounts: readonly AssetAccount[],
): void {
  client.setQueryData(accountsQueryKey, (previous?: AccountsSnapshot) => ({
    accounts,
    groups: previous?.groups ?? [],
  }));
}

// Cancels any in-flight accounts read before a write lands.
//
// This is the whole reason accounts are in the query cache. Without it, a read
// that started before the delete resolves after it and writes the pre-delete
// list back into the cache — the deleted account reappears, and the next write
// persists it again. `cancelQueries` marks the query cancelled, and TanStack's
// retryer drops the late result rather than calling `setData`, whether or not
// the fetcher itself honours the abort signal.
//
// The `await` is load-bearing: without it the cancellation races the write it is
// supposed to precede.
async function cancelAccountsRead(client: QueryClient): Promise<void> {
  await client.cancelQueries({ queryKey: accountsQueryKey });
}

// Removes an account and commits the post-remove list.
//
// Serialization stays in `asset-repository`'s `mutate` lock rather than moving
// to a mutation scope: the add and edit screens call the repository directly,
// without going through any hook, so the lock has to sit at the storage layer to
// cover them. Rejects on failure so the caller can surface an error — the home
// screen shows an alert.
export async function removeAccount(
  client: QueryClient,
  id: string,
): Promise<readonly AssetAccount[]> {
  await cancelAccountsRead(client);
  const accounts = await removeAssetAccount(id);
  commitAccounts(client, accounts);
  return accounts;
}

// Flags the cached account list stale after a write that bypassed this module.
//
// The add and edit screens call the repository directly (they build the account
// themselves), so the cache has to be told separately. Exported rather than
// spelled out at each call site because this is the write protocol, and the day
// it needs more than an invalidate — a `cancelQueries` first, as `removeAccount`
// needs — there is one place to add it instead of one per screen.
export async function invalidateAccounts(client: QueryClient): Promise<void> {
  await client.invalidateQueries({ queryKey: accountsQueryKey });
}

// Reads the accounts the cache currently holds, or null before the first load.
export function cachedAccounts(
  client: QueryClient,
): readonly AssetAccount[] | null {
  return (
    client.getQueryData<AccountsSnapshot>(accountsQueryKey)?.accounts ?? null
  );
}

// Re-reads accounts from storage through the cache. `fetchQuery` dedupes
// concurrent callers, so two reads landing together share the one repository hit
// instead of racing it.
export function fetchAccounts(client: QueryClient): Promise<AccountsSnapshot> {
  return client.fetchQuery(accountsQueryOptions());
}
