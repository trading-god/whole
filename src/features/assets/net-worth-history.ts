import { z } from "zod";

import { getItem, setItem, withTransaction } from "@/storage/kv-store";

import { createAsyncSerializer } from "./async-serializer";
import { type Currency } from "./currencies";
import { type ExchangeRates, convertCurrency } from "./currency-conversion";

// One total-assets sample per day, used to draw the home net-worth chart.
// Storing a snapshot when the accounts load means the chart reflects real
// data from day one and grows naturally without a separate transaction model.
const snapshotSchema = z.object({
  date: z.string(), // YYYY-MM-DD
  total: z.number(),
});

const storedSnapshotsSchema = z.object({
  version: z.literal(1),
  snapshots: z.array(snapshotSchema),
});

export type NetWorthSnapshot = z.infer<typeof snapshotSchema>;
type StoredSnapshots = z.infer<typeof storedSnapshotsSchema>;

const STORAGE_KEY = "whole.netWorthHistory";
const MIGRATION_MARKER_KEY = "whole.netWorthHistory.snapshotBase";
const MAX_SNAPSHOTS = 30;
// The fixed exchange-rate base used before this refactor; legacy snapshots are
// denominated in it. Kept as a literal here because the old defaultAssetCurrency
// constant was removed.
const LEGACY_BASE: Currency = "SGD";

function formatToday(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function parseStoredSnapshots(): Promise<NetWorthSnapshot[]> {
  const raw = await getItem(STORAGE_KEY);

  if (!raw) {
    return [];
  }

  try {
    const parsed = storedSnapshotsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data.snapshots : [];
  } catch {
    return [];
  }
}

// Cache of the last loaded/written history so repeated reads (e.g. every home
// focus) return a stable reference instead of a freshly parsed array, which
// would invalidate NetWorthChart's memo and its geometry useMemo each focus.
// Safe because this module is the sole writer of STORAGE_KEY.
let cachedSnapshots: NetWorthSnapshot[] | null = null;

export async function listNetWorthSnapshots(): Promise<NetWorthSnapshot[]> {
  if (cachedSnapshots) {
    return cachedSnapshots;
  }

  cachedSnapshots = await parseStoredSnapshots();
  return cachedSnapshots;
}

// Cache of the base currency whose snapshots have already been migrated (or
// marked). The marker is pinned after first migration and base is pinned after
// first launch, so once we've seen a matching base the result never changes —
// this skips the storage read on every subsequent home focus and returns the
// in-memory snapshot cache directly.
let cachedMigrationBase: Currency | null = null;

// Serializes snapshot writes AND migration (both write STORAGE_KEY) so
// concurrent callers (a home focus racing a removeAccount) can't interleave a
// migration with a snapshot write (lost write) or run two migrations that
// double-convert the same history — each run sees the previous one's result.
const record = createAsyncSerializer();

// Converts any legacy (LEGACY_BASE-denominated) snapshots to `base` in place,
// guarded by a marker so it runs at most once per base. Returns the snapshots
// in `base` (a no-op read when already migrated, or an empty list that just
// needs marking) or null when rates are not yet available — callers must skip
// recording a new snapshot in that case so legacy and base snapshots don't mix
// and corrupt the trend delta. The converted snapshots and the marker are
// written in a single transaction so a crash or rejected write between them
// can't leave converted data with no marker (which would re-migrate and double
// every total on the next launch). Serialized on `record` so concurrent callers
// can't race on the cache or storage. Base is pinned after first launch, so a
// non-matching marker should not occur; if it does, snapshots are treated as
// legacy and re-denominated.
export function migrateSnapshotsToBase(
  base: Currency,
  rates: ExchangeRates,
): Promise<NetWorthSnapshot[] | null> {
  return record(async () => {
    if (cachedMigrationBase === base) {
      return listNetWorthSnapshots();
    }

    // The marker only decides whether to migrate, not whether to read the
    // snapshots, so the two storage reads are independent — run them concurrently.
    const [marker, snapshots] = await Promise.all([
      getItem(MIGRATION_MARKER_KEY),
      listNetWorthSnapshots(),
    ]);

    if (marker === base) {
      cachedMigrationBase = base;
      return snapshots;
    }

    if (snapshots.length === 0 || base === LEGACY_BASE) {
      await setItem(MIGRATION_MARKER_KEY, base);
      cachedMigrationBase = base;
      return snapshots;
    }

    const factor = convertCurrency(1, LEGACY_BASE, base, rates);
    if (factor === null) {
      // Rates not loaded yet — defer migration. Callers skip recording so the
      // legacy snapshots aren't joined by a base-denominated snapshot.
      return null;
    }

    const migrated = snapshots.map((snapshot) => ({
      date: snapshot.date,
      total: snapshot.total * factor,
    }));
    const stored: StoredSnapshots = { version: 1, snapshots: migrated };
    // Write the converted snapshots and the marker in one transaction so a
    // crash or rejected write between them can't leave converted data with no
    // marker — that would re-migrate and double every total on the next launch.
    // The cache is updated only after the commit succeeds, so a rollback
    // leaves the legacy cache intact for the next attempt.
    await withTransaction(async () => {
      await setItem(STORAGE_KEY, JSON.stringify(stored));
      await setItem(MIGRATION_MARKER_KEY, base);
    });
    cachedSnapshots = migrated;
    cachedMigrationBase = base;
    return migrated;
  });
}

// Records today's total, replacing an existing entry for the same day so the
// latest balance wins. Keeps the most recent MAX_SNAPSHOTS points. Returns the
// updated history so callers can use it directly instead of reading the same
// key back.
export function recordNetWorthSnapshot(
  total: number,
): Promise<NetWorthSnapshot[]> {
  const run = async (): Promise<NetWorthSnapshot[]> => {
    const today = formatToday();
    const snapshots = await listNetWorthSnapshots();
    const last = snapshots[snapshots.length - 1];

    // Today's sample is already stored with the same total — return the cached
    // history unchanged so re-focusing the home screen neither churns
    // the key-value store nor invalidates the chart's memoized geometry.
    if (last && last.date === today && last.total === total) {
      return snapshots;
    }

    const withoutToday = snapshots.filter(
      (snapshot) => snapshot.date !== today,
    );
    const updated = [...withoutToday, { date: today, total }].slice(
      -MAX_SNAPSHOTS,
    );

    const stored: StoredSnapshots = { version: 1, snapshots: updated };
    await setItem(STORAGE_KEY, JSON.stringify(stored));

    cachedSnapshots = updated;
    return updated;
  };

  return record(run);
}

export type NetWorthTrend = {
  changePercent: number | null;
  delta: number | null;
};

// Compares the first and last snapshot. Returns nulls when there is not yet
// enough history to compute a meaningful change.
export function computeNetWorthTrend(
  snapshots: readonly NetWorthSnapshot[],
): NetWorthTrend {
  if (snapshots.length < 2) {
    return { changePercent: null, delta: null };
  }

  const first = snapshots[0].total;
  const last = snapshots[snapshots.length - 1].total;
  const delta = last - first;

  return {
    changePercent: first === 0 ? null : (delta / Math.abs(first)) * 100,
    delta,
  };
}
