import { z } from "zod";

import { createCachedPreferenceStore } from "@/storage/cached-preference-store";

import { type NetWorthSnapshot, formatSnapshotDate } from "./net-worth-history";

// Selectable windows for the home chart, ordered shortest to longest — the
// order the picker renders them in.
export const NET_WORTH_RANGES = ["1m", "3m", "6m", "1y", "all"] as const;

export type NetWorthRange = (typeof NET_WORTH_RANGES)[number];

const netWorthRangeSchema = z.enum(NET_WORTH_RANGES);

// Matches the window the footer claimed before the range became selectable, so
// the chart an existing user knows doesn't change under them on upgrade.
export const DEFAULT_NET_WORTH_RANGE: NetWorthRange = "6m";

// How far back each range reaches, in calendar months. `null` is "no cutoff".
const RANGE_MONTHS: Record<NetWorthRange, number | null> = {
  "1m": 1,
  "3m": 3,
  "6m": 6,
  "1y": 12,
  all: null,
};

// The snapshots at or after the range's cutoff. Snapshot dates are ISO
// "YYYY-MM-DD", so a plain string comparison is already a date comparison.
//
// Subtracting calendar months can land in a shorter month (Mar 31 − 1 month →
// Mar 3, because Feb 31 doesn't exist), moving the cutoff by a couple of days.
// That is immaterial for windows this wide, and it never drops a snapshot the
// user would consider inside the window by more than that.
export function selectSnapshotsInRange(
  snapshots: readonly NetWorthSnapshot[],
  range: NetWorthRange,
  now: Date = new Date(),
): NetWorthSnapshot[] {
  const months = RANGE_MONTHS[range];

  if (months === null) {
    return [...snapshots];
  }

  const cutoff = formatSnapshotDate(
    new Date(now.getFullYear(), now.getMonth() - months, now.getDate()),
  );
  return snapshots.filter((snapshot) => snapshot.date >= cutoff);
}

const STORAGE_KEY = "whole.netWorthRange";

// Persisted so the chart reopens on the window the user last picked. An absent
// or unrecognized stored value falls back to the default instead of failing —
// the range is a view preference, never data. Not pinned on first use: the
// default is a plain constant, so there is nothing for a stored copy to protect
// it from (unlike the base currency, which must outlive a locale change).
const netWorthRangeStore = createCachedPreferenceStore(
  STORAGE_KEY,
  netWorthRangeSchema,
);

export const loadNetWorthRange = (): Promise<NetWorthRange> =>
  netWorthRangeStore.load(DEFAULT_NET_WORTH_RANGE);

export const saveNetWorthRange = netWorthRangeStore.save;
