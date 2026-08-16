import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useFocusEffect } from "expo-router";
import { useCallback, useMemo } from "react";

import {
  accountsQueryKey,
  accountsQueryOptions,
  removeAccount as removeAccountFromStore,
} from "@/features/assets/accounts-query";
import { type AssetAccountGroup } from "@/features/assets/asset-repository";
import { defaultDisplayCurrencyForLanguageTag } from "@/features/assets/currencies";
import {
  type ExchangeRates,
  ratesForBaseOnly,
} from "@/features/assets/currency-conversion";
import { baseCurrencyQueryOptions } from "@/features/assets/base-currency-store";
import {
  exchangeRatesQueryOptions,
  exchangeRatesQueryPrefix,
} from "@/features/assets/exchange-rates-query";
import { type NetWorthSnapshot } from "@/features/assets/net-worth-history";
import { netWorthSnapshotsQueryOptions } from "@/features/assets/net-worth-snapshots-query";
import { useAppLocale } from "@/i18n";

const NO_ACCOUNTS: readonly never[] = [];
const NO_GROUPS: readonly AssetAccountGroup[] = [];
const NO_SNAPSHOTS: readonly NetWorthSnapshot[] = [];

// The home screen's data, as a chain of four queries rather than a hand-staged
// async effect:
//
//   base currency ──▶ exchange rates ──┐
//                                      ├──▶ net-worth snapshots
//   accounts ──────────────────────────┘
//
// Each edge is a `queryKey` dependency, so the sequencing that used to be
// written out — capture a ref, await, compare it back, decide whether the result
// is still current — is now the cache's job. What that hand-written version
// protected against, and what replaces it:
//
//   - a stale read landing after a delete and resurrecting the account
//     → `cancelQueries` inside the removal (see accounts-query.ts);
//   - a snapshot recorded against a list that changed mid-flight
//     → the accounts' `dataUpdatedAt` is part of the snapshot query's key, so a
//       changed list is a different query, not a race;
//   - a late result overwriting fresher state after the screen blurred
//     → the cache is the single copy; there is no second one to overwrite.
//
// Accounts stay ahead of rates without any staging: they are separate queries,
// so the local read renders as soon as it lands and the network one follows.
export function useAssetAccounts() {
  const queryClient = useQueryClient();
  const { languageTag } = useAppLocale();
  // Not memoized: it returns a `Currency` string, compared by value wherever it
  // is used as a query key segment or a dep.
  const defaultDisplayCurrency =
    defaultDisplayCurrencyForLanguageTag(languageTag);

  const accountsQuery = useQuery(accountsQueryOptions());
  const baseQuery = useQuery(baseCurrencyQueryOptions(defaultDisplayCurrency));
  const base = baseQuery.data;

  const ratesQuery = useQuery({
    ...exchangeRatesQueryOptions(base ?? defaultDisplayCurrency),
    // Waits for the persisted base: fetching against the locale default and then
    // again against the stored base would show totals converted at the wrong
    // base for a frame.
    enabled: base !== undefined,
  });

  const accounts = accountsQuery.data?.accounts;
  const snapshotsQuery = useQuery(
    netWorthSnapshotsQueryOptions({
      accounts: accounts ?? [],
      rates: ratesQuery.data,
      accountsVersion: accountsQuery.dataUpdatedAt,
      ratesVersion: ratesQuery.dataUpdatedAt,
    }),
  );

  // Rates degrade rather than disappear: with none available, only base-currency
  // (and same-currency) balances convert, and everything else reads "—". Memoized
  // so the fallback keeps one identity — a fresh object each render would defeat
  // every downstream memo that takes rates as an input.
  const rates: ExchangeRates = useMemo(
    () => ratesQuery.data ?? ratesForBaseOnly(base ?? defaultDisplayCurrency),
    [ratesQuery.data, base, defaultDisplayCurrency],
  );

  // Re-read on focus so an edit made on another screen shows up. Accounts are
  // local and always re-read; rates only when the six-hour window has passed,
  // which is what `stale: true` expresses (this is the shape the TanStack React
  // Native docs give for screen focus — `focusManager` tracks app foreground
  // state, not which screen is on top).
  useFocusEffect(
    useCallback(() => {
      void queryClient.refetchQueries({ queryKey: accountsQueryKey });
      void queryClient.refetchQueries({
        queryKey: [exchangeRatesQueryPrefix],
        stale: true,
        type: "active",
      });
    }, [queryClient]),
  );

  // Removes an account. The post-remove list is committed to the cache, which
  // moves the accounts' `dataUpdatedAt` and so re-runs the snapshot query — the
  // chart and trend pill update immediately instead of waiting for the next
  // focus, with no second call site to keep in step.
  //
  // Rejects when storage fails so the caller can surface an error; the cache is
  // left untouched in that case, so the UI keeps matching storage.
  const removeAccount = useCallback(
    async (id: string): Promise<void> => {
      await removeAccountFromStore(queryClient, id);
    },
    [queryClient],
  );

  // Pull-to-refresh. Rates are the only figure on this screen sourced from off
  // the device, so refreshing means asking the rate service again — past the
  // staleness window, which is what `refetchQueries` does unconditionally.
  //
  // Accounts are re-read too. That is nearly free (an unchanged list comes back
  // reference-identical and nothing re-renders) and it is what makes this the
  // recovery gesture the error card implies: without it a failed initial load
  // leaves the screen on "couldn't load your accounts" with no way back except
  // leaving it.
  //
  // Never rejects: `refetchQueries` resolves even when the refetch fails, and the
  // failure surfaces through the queries' own state. The caller can drop the
  // spinner on settle without a failure branch.
  const refresh = useCallback(async (): Promise<void> => {
    await Promise.all([
      queryClient.refetchQueries({ queryKey: accountsQueryKey }),
      queryClient.refetchQueries({ queryKey: [exchangeRatesQueryPrefix] }),
    ]);
  }, [queryClient]);

  return {
    accounts: accounts ?? NO_ACCOUNTS,
    groups: accountsQuery.data?.groups ?? NO_GROUPS,
    snapshots: snapshotsQuery.data ?? NO_SNAPSHOTS,
    rates,
    // Gates the total and trend pill on real rates, so they show a placeholder
    // rather than a figure converted at "no data" while the fetch is in flight.
    ratesReady: ratesQuery.data !== undefined,
    // An error takes over the screen only when there is nothing to show. Bare
    // `isError` would replace a perfectly good list with an error card because a
    // background re-read failed.
    error: accountsQuery.isError && accountsQuery.data === undefined,
    isLoading: accountsQuery.isPending,
    removeAccount,
    refresh,
  };
}
