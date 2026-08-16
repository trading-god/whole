import { keepPreviousData, queryOptions } from "@tanstack/react-query";

import {
  type AssetAccount,
  sumBalancesInEveryCurrency,
} from "@/features/assets/asset-repository";
import { type ExchangeRates } from "@/features/assets/currency-conversion";
import { reconcileNetWorthFlows } from "@/features/assets/net-worth-flows";
import {
  type NetWorthSnapshot,
  migrateSnapshots,
  recordNetWorthSnapshot,
} from "@/features/assets/net-worth-history";

// Today's net-worth sample, modelled as a query even though it WRITES.
//
// That looks wrong at first and is worth stating plainly: a query may be
// retried, refetched on mount, and refetched on focus, so a query function with
// side effects is normally a bug. It is safe here because all three writes below
// are idempotent by construction, not by luck:
//
//   - `reconcileNetWorthFlows` reconciles rather than appends — it diffs the
//     stored `live` balances against the current accounts and returns without
//     writing when nothing moved;
//   - `recordNetWorthSnapshot` replaces today's sample, and returns the existing
//     history untouched when today's figures already match;
//   - `migrateSnapshots` is guarded by its own version marker.
//
// Running it twice therefore produces exactly what running it once does. That
// idempotence is a load-bearing property of this query — check it before
// changing any of those three.

export const netWorthSnapshotsQueryKey = "netWorthSnapshots";

// Produces today's snapshot list for `accounts` at `rates`, upgrading any legacy
// single-base history first.
//
// Every step needs rates that convert all four currencies, because the snapshot
// records one figure per currency: a partial set would freeze capital at a rate
// of "no data" and skew growth in the missing currencies permanently.
//
// Throws when it cannot produce a result. That is what makes the chart hold its
// previous shape instead of blanking: `placeholderData` keeps the last list on
// screen, and the next focus retries. Returning an empty list here would erase a
// history that is still intact on disk.
async function recordSnapshot(
  accounts: readonly AssetAccount[],
  rates: ExchangeRates,
): Promise<NetWorthSnapshot[]> {
  const upgraded = await migrateSnapshots(rates);
  if (upgraded === null) {
    // The store still holds a legacy record that can't be converted yet (rates
    // incomplete), or one nothing can read. Neither is a history this path can
    // return — `listNetWorthSnapshots` reports both as empty, and committing
    // that would blank a chart whose data is intact in storage.
    throw new Error("Net-worth history is not readable yet");
  }

  // Book the capital that moved in or out since the last sample, so an account
  // added since then lands in `totals` and `baselines` together and leaves the
  // growth curve flat instead of stepping up by its whole balance (and a deleted
  // one leaves without taking its growth with it). Each movement is frozen at
  // today's rate, which is what makes a later rate move register as growth.
  //
  // This has to succeed before a sample is recorded: measuring against stale
  // capital would book a new account's opening balance as growth — precisely the
  // spike the ledger exists to remove. On failure keep the upgraded history and
  // skip today's sample.
  const flows = await reconcileNetWorthFlows(accounts, rates).catch(() => null);
  if (flows === null) {
    return upgraded;
  }

  // Fall back to `upgraded` (the list the upgrade just returned) so a snapshot
  // write failure never blanks the chart.
  return await recordNetWorthSnapshot(
    sumBalancesInEveryCurrency(accounts, rates),
    flows.amounts,
  ).catch(() => upgraded);
}

// `accountsVersion` and `ratesVersion` are the two queries' `dataUpdatedAt`
// stamps. Putting them in the key is what makes this recompute when either
// input changes, without a hand-written effect deciding when to re-record —
// which is what the three scattered `commitSnapshots` calls used to be, each
// carrying its own copy of a staleness guard.
export function netWorthSnapshotsQueryOptions(params: {
  accounts: readonly AssetAccount[];
  rates: ExchangeRates | undefined;
  accountsVersion: number;
  ratesVersion: number;
}) {
  const { accounts, rates, accountsVersion, ratesVersion } = params;
  // eslint-disable-next-line @tanstack/query/exhaustive-deps -- accounts/rates are represented in the key by their version stamps; see below
  return queryOptions({
    // The two version stamps stand in for `accounts` and `rates` themselves.
    // Putting the arrays in the key instead would mean hashing every account on
    // every render (measurably slower once a few dozen accounts exist, since the
    // key is hashed in the render path) and would store a multi-kilobyte string
    // as a cache key.
    //
    // `dataUpdatedAt` is a last-successful-FETCH stamp, not a last-CHANGED
    // stamp: it advances on every refetch, including one whose result is
    // identical (structural sharing keeps `data` reference-stable, the timestamp
    // moves anyway). Since the home screen refetches accounts on every focus,
    // each focus mints a new key here — so this query overestimates rather than
    // underestimates, and `gcTime` below is what keeps that bounded.
    queryKey: [netWorthSnapshotsQueryKey, accountsVersion, ratesVersion],
    queryFn: () => recordSnapshot(accounts, rates as ExchangeRates),
    // Only runs once both inputs are in. Recording against rates that haven't
    // loaded would freeze every foreign holding at "no data".
    enabled: rates !== undefined,
    // The inputs are already the key, so a result can never go stale on its own.
    staleTime: Infinity,
    // Overrides the client-wide `gcTime: Infinity`, which exists for the
    // persisted rate table and is wrong here. This query's key space is
    // unbounded (see the stamp note above), so an immortal entry per home-screen
    // focus accumulates for the life of the process — each one retaining its
    // `queryFn` closure over that generation's accounts and rates. Five minutes
    // is long enough to cover a round trip to the add/edit screen and back,
    // which is the only case where re-serving a previous key matters.
    gcTime: 5 * 60 * 1000,
    // Local sqlite — no connection to wait for.
    networkMode: "always",
    // A failure here means "no update to report", not "try harder": the inputs
    // haven't changed, so an immediate retry would fail the same way. The next
    // account edit or rate refresh moves the key and retries naturally.
    retry: 0,
    // Holds the previous chart while a new key resolves, and — because a failure
    // leaves `data` undefined on the new key — keeps it on screen when this
    // cannot produce a result at all.
    placeholderData: keepPreviousData,
  });
}
