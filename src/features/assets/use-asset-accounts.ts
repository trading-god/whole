import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";

import {
  type AssetAccount,
  type AssetAccountGroup,
  listAssetAccounts,
  listAssetAccountGroups,
  removeAssetAccount,
  removeAssetAccountGroup,
  sumBalancesInEveryCurrency,
} from "@/features/assets/asset-repository";
import { createAsyncSerializer } from "@/features/assets/async-serializer";
import { loadBaseCurrency } from "@/features/assets/base-currency-store";
import {
  type Currency,
  defaultDisplayCurrencyForLanguageTag,
} from "@/features/assets/currencies";
import {
  type ExchangeRates,
  loadExchangeRates,
  refreshExchangeRates,
} from "@/features/assets/currency-conversion";
import { reconcileNetWorthFlows } from "@/features/assets/net-worth-flows";
import {
  type NetWorthSnapshot,
  migrateSnapshots,
  recordNetWorthSnapshot,
} from "@/features/assets/net-worth-history";
import { useAppLocale } from "@/i18n";

// The exchange-rate base is deliberately absent: only the rate API depends on
// it, and snapshots carry every display currency, so nothing downstream has to
// convert through it. It lives in `baseCurrencyRef` alone, which is all
// `refresh` needs to refetch without re-reading storage.
type AssetAccountsState = {
  accounts: readonly AssetAccount[];
  groups: readonly AssetAccountGroup[];
  snapshots: readonly NetWorthSnapshot[];
  rates: ExchangeRates;
  // False until the focus effect adopts rates for the current cycle. Gates the
  // total/pill "—"/placeholder so they wait for rates (which may hit the
  // network) while accounts (local) show immediately. Never reset to false — a
  // cache-hot refocus preserves it via the stage-1 bail-out.
  ratesReady: boolean;
  error: boolean;
  isLoading: boolean;
};

const initialAssetAccountsState: AssetAccountsState = {
  accounts: [],
  groups: [],
  snapshots: [],
  rates: {} as ExchangeRates,
  ratesReady: false,
  error: false,
  isLoading: true,
};

// Records today's net-worth snapshot for `accounts`, upgrading any legacy
// single-base history first. Shared by the focus effect, removeAccount, and
// pull-to-refresh so the upgrade/book/record rule lives in one place.
//
// Every step needs rates that convert all four currencies, because the snapshot
// records one figure per currency: a partial set would freeze capital at a rate
// of "no data" and skew growth in the missing currencies permanently. Without
// them nothing is written and the existing history is returned unchanged, to be
// retried on the next focus.
//
// Best-effort: a storage failure during the upgrade or read must not fail the
// account load/removal that triggered it. Returns null for "no history to
// report" — the caller then leaves the chart on whatever it already had,
// rather than replacing it with an empty list.
async function recordSnapshotForAccounts(
  accounts: readonly AssetAccount[],
  rates: ExchangeRates,
): Promise<NetWorthSnapshot[] | null> {
  try {
    const upgraded = await migrateSnapshots(rates);
    if (upgraded === null) {
      // The store still holds a legacy record that can't be converted yet
      // (rates incomplete), or one nothing can read. Neither is a history this
      // path can return: `listNetWorthSnapshots` reports both as empty, and
      // committing that would blank a chart whose data is intact in storage.
      // Report "no update" and let the next focus retry.
      return null;
    }
    // Book the capital that moved in or out since the last sample, so an
    // account added since then lands in `totals` and `baselines` together and
    // leaves the growth curve flat instead of stepping up by its whole balance
    // (and a deleted one leaves without taking its growth with it). Each
    // movement is frozen at today's rate, which is what makes a later rate move
    // register as growth.
    //
    // This has to succeed before a sample is recorded: measuring against stale
    // capital would book a new account's opening balance as growth — precisely
    // the spike the ledger removes. On failure skip today's sample; the chart
    // keeps its existing history and the next focus retries.
    const flows = await reconcileNetWorthFlows(accounts, rates).catch(
      () => null,
    );
    if (flows === null) {
      return upgraded;
    }
    // Record today's sample, falling back to `upgraded` (the list the upgrade
    // just returned) so a snapshot write failure never blanks the chart.
    return await recordNetWorthSnapshot(
      sumBalancesInEveryCurrency(accounts, rates),
      flows.amounts,
    ).catch(() => upgraded);
  } catch {
    // Usually the upgrade rejecting on a failed storage write. Leave the chart
    // as it is rather than breaking the load that triggered this — and rather
    // than blanking a history that is still on disk.
    return null;
  }
}

export function useAssetAccounts() {
  const { languageTag } = useAppLocale();
  const defaultDisplayCurrency = useMemo(
    () => defaultDisplayCurrencyForLanguageTag(languageTag),
    [languageTag],
  );
  const [state, setState] = useState(initialAssetAccountsState);
  // Mirrors of state.accounts and state.rates. The focus effect captures
  // `accountsRef` before its awaits and compares after, so a removeAccount
  // landing during a focus load is detected instead of clobbering the ref back
  // to the stale pre-remove list (which would resurrect the deleted account);
  // `commitSnapshots` reads it to detect a remove that lands during its await.
  // The base currency has no state twin — nothing renders it — so the ref is
  // the only copy, held so pull-to-refresh can refetch without re-reading
  // storage.
  const accountsRef = useRef<readonly AssetAccount[]>(state.accounts);
  const ratesRef = useRef<ExchangeRates>(state.rates);
  const baseCurrencyRef = useRef<Currency | null>(null);
  // Serializes removes so concurrent calls don't race on storage and each sees
  // the prior removal in memory. Created once per hook instance via useState's
  // lazy initializer (the serializer is never reassigned, so the setter is
  // dropped) — useRef(createAsyncSerializer()) would reallocate the serializer
  // and its promise chain on every render and discard all but the first.
  const [removeSerializer] = useState(() => createAsyncSerializer());

  // Records today's snapshot for `accounts` and commits it, unless a remove
  // landed during the await. Every path that re-records — focus stage 3,
  // removeAccount, pull-to-refresh — goes through this, so the capture-before-
  // await / compare-after rule that stops a removed account from being
  // resurrected has one owner instead of three copies to keep in step.
  //
  // `isStillMounted` lets the focus effect drop a result that arrived after
  // the screen blurred; the imperative paths (remove, refresh) always commit,
  // matching what they did inline. A null result means "nothing to report"
  // (unconvertible or unreadable store) — the chart keeps what it already has
  // instead of blanking over a history that is still on disk.
  const commitSnapshots = useCallback(
    async (
      accounts: readonly AssetAccount[],
      rates: ExchangeRates,
      isStillMounted: () => boolean = () => true,
    ): Promise<void> => {
      const snapshots = await recordSnapshotForAccounts(accounts, rates);
      if (snapshots === null || !isStillMounted()) {
        return;
      }
      setState((currentState) => {
        const next =
          accountsRef.current === accounts ? snapshots : currentState.snapshots;
        return currentState.snapshots === next
          ? currentState
          : { ...currentState, snapshots: next };
      });
    },
    [],
  );

  useFocusEffect(
    useCallback(() => {
      let isActive = true;

      void (async () => {
        try {
          // Capture the ref before any await so a removeAccount that runs
          // during stage 1 is detected — it would update accountsRef to the
          // post-remove list, and clobbering it back to the (stale, pre-remove)
          // loaded accounts would resurrect the removed account in the UI and
          // let a later remove re-add it to storage.
          const prevAccountsRef = accountsRef.current;

          // Stage 1: local base + accounts (fast). Rates are split out (stage 2)
          // because loadExchangeRates may hit the network (1-3s when the 6h
          // cache is stale) — accounts shouldn't wait on it. Cross-rate math is
          // base-invariant (rates[from] / rates[to], base cancels), so adopting
          // base here and rates in stage 2 yields correct conversions throughout.
          const [base, accounts, groups] = await Promise.all([
            loadBaseCurrency(defaultDisplayCurrency),
            listAssetAccounts(),
            listAssetAccountGroups(),
          ]);
          if (!isActive) {
            return;
          }
          // Only adopt the loaded accounts when no remove changed the ref
          // during the await; otherwise keep the post-remove list the ref holds.
          if (accountsRef.current === prevAccountsRef) {
            accountsRef.current = accounts;
          }
          // base is always adopted — removeAccount never writes baseCurrencyRef.
          baseCurrencyRef.current = base;
          setState((currentState) => {
            // Bail out on a cache-hot refocus: accounts already current and
            // not loading. Don't touch ratesReady — stage 2 owns it, and
            // leaving it untouched preserves a prior true on refocus. Groups
            // share the accounts' envelope, so a cache-hot accounts read means
            // the groups are current too.
            if (
              currentState.accounts === accountsRef.current &&
              !currentState.error &&
              !currentState.isLoading
            ) {
              return currentState;
            }
            return {
              ...currentState,
              accounts: accountsRef.current,
              groups,
              error: false,
              isLoading: false,
            };
          });

          // Stage 2: rates (network or cache; never throws). Use the captured
          // base, not baseCurrencyRef.current, so a re-focus that changed the
          // ref can't fetch rates for the wrong base — that re-focus already
          // set isActive=false on this run, neutering the stages below.
          const rates = await loadExchangeRates(base);
          if (!isActive) {
            return;
          }
          ratesRef.current = rates;
          setState((currentState) =>
            currentState.rates === rates && currentState.ratesReady
              ? currentState
              : {
                  ...currentState,
                  rates,
                  ratesReady: true,
                },
          );

          // Stage 3: record today's snapshot (needs rates for the total).
          // Read accountsRef at call time so the snapshot reflects the current
          // list (post-remove if a remove raced); commitSnapshots detects a
          // remove that lands during the await.
          await commitSnapshots(accountsRef.current, rates, () => isActive);
        } catch {
          // Only stage 1 can throw (local SQLite); loadExchangeRates and
          // recordSnapshotForAccounts never throw. ratesReady is left untouched
          // (spread preserves a prior true; stays false on a first-load failure).
          if (isActive) {
            setState((currentState) => ({
              ...currentState,
              error: true,
              isLoading: false,
            }));
          }
        }
      })();

      return () => {
        isActive = false;
      };
    }, [commitSnapshots, defaultDisplayCurrency]),
  );

  // Removes an account from storage and the in-memory list, then re-records
  // today's net-worth snapshot with the new total so the chart and trend pill
  // update immediately instead of waiting for the next screen focus.
  //
  // Removes are serialized, and each persists before updating memory: a save
  // failure leaves the UI matching storage (the account stays) instead of
  // vanishing then reappearing on the next focus, and concurrent removes can't
  // race on a stale storage re-read. Rejects when storage fails so the caller
  // can surface an error.
  const removeAccount = useCallback(
    (id: string): Promise<void> => {
      const run = async () => {
        // Removed through the repository's shared `mutate` lock so a concurrent
        // upsert/update (an add/edit screen save) can't read the same list and
        // clobber this write — both write ASSET_ACCOUNTS_STORAGE_KEY. The
        // returned list reflects storage (so a concurrent save's new account
        // survives the remove) rather than the ref, which may predate it.
        const nextAccounts = await removeAssetAccount(id);
        accountsRef.current = nextAccounts;
        setState((currentState) => ({
          ...currentState,
          accounts: nextAccounts,
        }));

        // Re-record today's snapshot so the removed account's balance leaves
        // the total and its capital leaves the ledger together — the chart and
        // trend update immediately instead of waiting for the next focus.
        await commitSnapshots(nextAccounts, ratesRef.current);
      };

      return removeSerializer(run);
    },
    [commitSnapshots, removeSerializer],
  );

  // Removes a group: its child accounts are kept but become ungrouped. Group
  // membership never moves a balance, so — unlike removeAccount — there is no
  // net-worth snapshot to re-record; the total, chart, and trend are
  // unchanged. Serialized through the same `removeSerializer` as account
  // removal so a concurrent remove can't race on storage.
  const removeGroup = useCallback(
    (id: string): Promise<void> => {
      const run = async () => {
        const { accounts, groups } = await removeAssetAccountGroup(id);
        accountsRef.current = accounts;
        setState((currentState) => ({
          ...currentState,
          accounts,
          groups,
        }));
      };
      return removeSerializer(run);
    },
    [removeSerializer],
  );

  // Pull-to-refresh. Exchange rates are the only figure on the home screen that
  // comes from off-device, so refreshing means refetching them past their cache
  // TTL and then re-recording today's snapshot at the new rates — the total,
  // the composition, and the chart all move together as a result.
  //
  // The accounts are re-read first. That is nearly free (the repository serves
  // a cached array, so an unchanged list comes back reference-identical and
  // nothing re-renders), and it is what makes this the recovery gesture the
  // error card implies: without it a failed initial load leaves the screen on
  // "couldn't load your accounts" with no way back except leaving the screen.
  // It is also load-bearing, not just a convenience — booking flows against a
  // list that was never loaded would read every stored holding as gone and
  // retire it from the capital ledger, permanently erasing accumulated growth.
  //
  // Never rejects: `refreshExchangeRates` and `recordSnapshotForAccounts`
  // absorb their own failures, and a read failure leaves the screen exactly as
  // it was. The caller can therefore drop the spinner on settle without a
  // failure branch.
  const refresh = useCallback(async (): Promise<void> => {
    // Resolved with an `if` rather than `??`: React Compiler cannot lower a
    // value block (a conditional, `??`, or optional chain) inside a try/catch
    // and would bail out of this entire hook, leaving every screen that reads
    // it with no memoization at all. Same constraint the account screens'
    // saves are written around.
    let base = baseCurrencyRef.current;
    try {
      if (base === null) {
        base = await loadBaseCurrency(defaultDisplayCurrency);
      }
      // Captured before the await for the same reason stage 1 does it: a
      // removeAccount landing during the read must not be clobbered back.
      const prevAccountsRef = accountsRef.current;
      const accounts = await listAssetAccounts();
      if (accountsRef.current === prevAccountsRef) {
        accountsRef.current = accounts;
      }

      const rates = await refreshExchangeRates(base);
      baseCurrencyRef.current = base;
      ratesRef.current = rates;
      setState((currentState) =>
        currentState.accounts === accountsRef.current &&
        currentState.rates === rates &&
        currentState.ratesReady &&
        !currentState.error &&
        !currentState.isLoading
          ? currentState
          : {
              ...currentState,
              accounts: accountsRef.current,
              rates,
              ratesReady: true,
              error: false,
              isLoading: false,
            },
      );

      await commitSnapshots(accountsRef.current, rates);
    } catch {
      // Only the local reads can throw (SQLite). Leave the screen on its
      // current data — including a prior error state, which is still true —
      // rather than surfacing a second error for a pull the user can repeat.
    }
  }, [commitSnapshots, defaultDisplayCurrency]);

  return { ...state, removeAccount, removeGroup, refresh };
}
