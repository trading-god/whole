import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";

import {
  type AssetAccount,
  listAssetAccounts,
  saveAssetAccounts,
  sumBalancesByKindInCurrency,
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
} from "@/features/assets/currency-conversion";
import {
  type NetWorthSnapshot,
  listNetWorthSnapshots,
  migrateSnapshotsToBase,
  recordNetWorthSnapshot,
} from "@/features/assets/net-worth-history";
import { useAppLocale } from "@/i18n";

type AssetAccountsState = {
  accounts: readonly AssetAccount[];
  // null until the persistent base currency has loaded; the display paths
  // short-circuit while loading so it is never read for display.
  baseCurrency: Currency | null;
  snapshots: readonly NetWorthSnapshot[];
  // Whether `snapshots` are denominated in `baseCurrency`. False while a legacy-
  // currency migration is deferred (rates unavailable): the chart still shows
  // the relative trend line, but the delta amount can't be converted to the
  // display currency, so `displayDelta` is suppressed to avoid showing a
  // legacy-currency delta mislabeled as the base currency.
  snapshotsInBaseCurrency: boolean;
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
  baseCurrency: null,
  snapshots: [],
  snapshotsInBaseCurrency: true,
  rates: {} as ExchangeRates,
  ratesReady: false,
  error: false,
  isLoading: true,
};

// Records today's net-worth snapshot for `accounts` (migrated to the base
// currency first), or — when the base currency hasn't loaded yet or migration
// is still deferred (rates unavailable) — falls back to a plain read so legacy
// and base snapshots never mix and corrupt the trend delta. Shared by the focus
// effect and removeAccount so the migrate/record rule lives in one place.
//
// Best-effort: a storage failure during migration or read must not fail the
// account load/removal that triggered it — the chart degrades to the cached
// history (or empty) instead, and the next focus retries the migration.
async function recordSnapshotForAccounts(
  accounts: readonly AssetAccount[],
  baseCurrency: Currency | null,
  rates: ExchangeRates,
): Promise<{ snapshots: NetWorthSnapshot[]; inBaseCurrency: boolean }> {
  try {
    // Base currency not loaded yet — read the cached history so legacy and
    // base snapshots never mix and corrupt the trend delta. `inBaseCurrency`
    // is moot here (the display suppresses the delta while baseCurrency is
    // null).
    if (baseCurrency === null) {
      return { snapshots: await listNetWorthSnapshots(), inBaseCurrency: true };
    }
    const migrated = await migrateSnapshotsToBase(baseCurrency, rates);
    if (migrated === null) {
      // Migration deferred (rates unavailable): return the legacy snapshots so
      // the chart keeps its relative trend line, but flag that they are NOT in
      // baseCurrency — the delta amount can't be shown in the display currency.
      return {
        snapshots: await listNetWorthSnapshots(),
        inBaseCurrency: false,
      };
    }
    // Skip recording when the total is unknown (rates unavailable, no balance
    // convertible) so a fake 0 isn't persisted — matches the migration-deferred
    // skip above. `migrated` is the current snapshot list (migrateSnapshotsToBase
    // updates the cache and returns it), so return it directly instead of
    // re-reading the same cached reference.
    const total = sumBalancesByKindInCurrency(
      accounts,
      baseCurrency,
      rates,
    ).total;
    if (total === null) {
      return { snapshots: migrated, inBaseCurrency: true };
    }
    // Record today's sample, falling back to `migrated` (the list migrate just
    // returned) so a snapshot write failure never blanks the chart.
    const recorded = await recordNetWorthSnapshot(total).catch(() => migrated);
    return { snapshots: recorded, inBaseCurrency: true };
  } catch {
    // A throw here is usually migrateSnapshotsToBase rejecting (a storage
    // write failed mid-migration) — the snapshots are still legacy, not in
    // baseCurrency — so flag false to suppress the delta rather than show a
    // legacy-currency amount mislabeled as the base currency.
    const snapshots = await listNetWorthSnapshots().catch(() => []);
    return { snapshots, inBaseCurrency: false };
  }
}

export function useAssetAccounts() {
  const { languageTag, isHydrated } = useAppLocale();
  const defaultDisplayCurrency = useMemo(
    () => defaultDisplayCurrencyForLanguageTag(languageTag),
    [languageTag],
  );
  const [state, setState] = useState(initialAssetAccountsState);
  // Mirrors of state.accounts, state.rates and state.baseCurrency so
  // removeAccount can recompute the post-delete total synchronously without
  // reading stale state from a useCallback closure.
  const accountsRef = useRef<readonly AssetAccount[]>(state.accounts);
  const ratesRef = useRef<ExchangeRates>(state.rates);
  const baseCurrencyRef = useRef<Currency | null>(state.baseCurrency);
  // Serializes removes so concurrent calls don't race on storage and each sees
  // the prior removal in memory. Created once per hook instance via useState's
  // lazy initializer (the serializer is never reassigned, so the setter is
  // dropped) — useRef(createAsyncSerializer()) would reallocate the serializer
  // and its promise chain on every render and discard all but the first.
  const [removeSerializer] = useState(() => createAsyncSerializer());

  useFocusEffect(
    useCallback(() => {
      // On web the locale isn't resolved until hydration; loading the base
      // currency now would pin the pre-hydration fallback (SGD) permanently.
      // Native is always hydrated, so this is a no-op there.
      if (!isHydrated) {
        return;
      }

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
          const [base, accounts] = await Promise.all([
            loadBaseCurrency(defaultDisplayCurrency),
            listAssetAccounts(),
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
            // Bail out on a cache-hot refocus: accounts/base already current
            // and not loading. Don't touch ratesReady — stage 2 owns it, and
            // leaving it untouched preserves a prior true on refocus.
            if (
              currentState.accounts === accountsRef.current &&
              currentState.baseCurrency === base &&
              !currentState.error &&
              !currentState.isLoading
            ) {
              return currentState;
            }
            return {
              ...currentState,
              accounts: accountsRef.current,
              baseCurrency: base,
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
          // Capture accountsRef at call time so the snapshot reflects the
          // current list (post-remove if a remove raced); the stillCurrent
          // check below detects a remove that lands during this await.
          const accountsAtStage3Start = accountsRef.current;
          const snapshotResult = await recordSnapshotForAccounts(
            accountsAtStage3Start,
            base,
            rates,
          );
          if (!isActive) {
            return;
          }
          setState((currentState) => {
            const stillCurrent = accountsRef.current === accountsAtStage3Start;
            const snapshots = stillCurrent
              ? snapshotResult.snapshots
              : currentState.snapshots;
            const snapshotsInBaseCurrency = stillCurrent
              ? snapshotResult.inBaseCurrency
              : currentState.snapshotsInBaseCurrency;
            if (
              currentState.snapshots === snapshots &&
              currentState.snapshotsInBaseCurrency === snapshotsInBaseCurrency
            ) {
              return currentState;
            }
            return {
              ...currentState,
              snapshots,
              snapshotsInBaseCurrency,
            };
          });
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
    }, [defaultDisplayCurrency, isHydrated]),
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
        const nextAccounts = accountsRef.current.filter(
          (account) => account.id !== id,
        );
        await saveAssetAccounts(nextAccounts);
        accountsRef.current = nextAccounts;
        setState((currentState) => ({
          ...currentState,
          accounts: nextAccounts,
        }));

        const baseCurrency = baseCurrencyRef.current;
        const rates = ratesRef.current;
        // Record today's snapshot (migrating legacy snapshots first), matching
        // the focus effect's migrate/record rule so legacy and base snapshots
        // never mix and corrupt the trend delta.
        const snapshotResult = await recordSnapshotForAccounts(
          nextAccounts,
          baseCurrency,
          rates,
        );

        setState((currentState) => ({
          ...currentState,
          snapshots: snapshotResult.snapshots,
          snapshotsInBaseCurrency: snapshotResult.inBaseCurrency,
        }));
      };

      return removeSerializer(run);
    },
    [removeSerializer],
  );

  return { ...state, removeAccount };
}
