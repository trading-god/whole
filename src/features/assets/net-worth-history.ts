import { z } from "zod";

import {
  getItem,
  removeItem,
  setItem,
  withTransaction,
} from "@/storage/kv-store";

import { createAsyncSerializer } from "./async-serializer";
import {
  type Currency,
  type CurrencyAmounts,
  amountsConvertible,
  currencyAmountsSchema,
  currencySchema,
  knownAssetCurrencies,
  mapCurrencies,
} from "./currencies";
import { type ExchangeRates, convertCurrency } from "./currency-conversion";

// One sample per day, used to draw the home net-worth chart. Storing a snapshot
// when the accounts load means the chart reflects real data from day one and
// grows naturally without a separate transaction model.
//
// `totals` is what the accounts were worth that day; `baselines` is the capital
// that had been put into them — the net of every inflow and outflow, frozen at
// the rate each one moved at (see net-worth-flows). Both are recorded once per
// display currency, because the answer differs per currency: holdings are
// revalued at the current rate while the capital behind them is not, so an
// exchange-rate move is a gain when read in one currency and nothing at all
// read in another. The chart plots the difference — growth — in whichever
// currency it is being read.
const snapshotSchema = z.object({
  date: z.string(), // YYYY-MM-DD
  totals: currencyAmountsSchema,
  baselines: currencyAmountsSchema,
});

// Legacy shapes, both denominated in a single base currency. v1 predates the
// growth model entirely (no baseline, so the whole total counted as capital);
// v2 separated growth from capital but still converted everything through one
// base, which hid exchange-rate gains. Both are upgraded by converting their
// figures into every display currency at the current rate — the original rates
// are gone, so the pre-upgrade history reads as if it happened today, and rate
// gains accumulate correctly from the upgrade onward.
const v1SnapshotSchema = z.object({
  date: z.string(),
  total: z.number(),
});

const v2SnapshotSchema = z.object({
  date: z.string(),
  total: z.number(),
  baseline: z.number(),
});

const storedSnapshotsSchema = z.object({
  version: z.literal(3),
  snapshots: z.array(snapshotSchema),
});

const storedV1SnapshotsSchema = z.object({
  version: z.literal(1),
  snapshots: z.array(v1SnapshotSchema),
});

const storedV2SnapshotsSchema = z.object({
  version: z.literal(2),
  snapshots: z.array(v2SnapshotSchema),
});

export type NetWorthSnapshot = z.infer<typeof snapshotSchema>;
type StoredSnapshots = z.infer<typeof storedSnapshotsSchema>;
type LegacySnapshot = z.infer<typeof v2SnapshotSchema>;

const STORAGE_KEY = "whole.netWorthHistory";
// Names the base currency the legacy (v1/v2) snapshots were denominated in.
// Read once during the upgrade to v3 and then retired — v3 records carry every
// currency, so there is no longer a single base to track.
const LEGACY_BASE_KEY = "whole.netWorthHistory.snapshotBase";
// Roughly two years of daily samples — enough to fill the longest selectable
// range ("past year") with headroom, while still bounding the stored history.
// Samples are written at most once a day, so the practical count is however
// often Whole is opened, not the cap.
const MAX_SNAPSHOTS = 800;
// The fixed exchange-rate base used before the base currency became a user
// setting; v1 snapshots with no marker are denominated in it.
const LEGACY_BASE: Currency = "SGD";

// The growth a snapshot represents, read in `currency`: what the accounts were
// worth minus the capital put into them. Positive means the holdings gained on
// their own — through a balance rising, an exchange rate moving, or both;
// negative means they lost.
export function netWorthGrowth(
  snapshot: NetWorthSnapshot,
  currency: Currency,
): number {
  return snapshot.totals[currency] - snapshot.baselines[currency];
}

export function formatSnapshotDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Parses a "YYYY-MM-DD" snapshot date to a timestamp. Read back in UTC even
// though `formatSnapshotDate` writes local calendar dates: the value is only
// ever used for the distance between two snapshots, and running every date
// through the same conversion makes those distances exact.
export function parseSnapshotDate(date: string): number {
  const [year, month, day] = date.split("-");
  return Date.UTC(Number(year), Number(month) - 1, Number(day));
}

function formatToday(): string {
  return formatSnapshotDate(new Date());
}

// Spreads one base-currency figure across every display currency at the current
// rate. Used only to upgrade legacy records, whose original rates are lost.
function spreadFromBase(
  amount: number,
  base: Currency,
  rates: ExchangeRates,
): CurrencyAmounts {
  return mapCurrencies(
    (currency) => convertCurrency(amount, base, currency, rates) ?? 0,
  );
}

type ParsedSnapshots =
  | { current: NetWorthSnapshot[] }
  | { legacy: LegacySnapshot[] }
  // The key holds something none of the three versions accept: a truncated or
  // corrupt write, or a record written by a build whose currency list has since
  // changed (`currencyAmountsSchema` is exhaustive both ways, so adding or
  // removing a currency invalidates every stored snapshot at once). Kept
  // distinct from an empty store so callers refuse to record over it — a
  // history that can't be read today may still be migratable tomorrow, and
  // overwriting it destroys the user's whole chart with nothing to recover.
  | { unreadable: true };

// Reads and version-dispatches the stored history. Deliberately does its own
// `getItem` + `JSON.parse` instead of `readJson`, which collapses "absent" and
// "corrupt" into one null — a distinction this module has to keep, since one
// means "start recording" and the other means "do not write".
async function parseStoredSnapshots(): Promise<ParsedSnapshots> {
  const raw = await getItem(STORAGE_KEY);
  if (raw === null) {
    return { current: [] };
  }

  let stored: unknown;
  try {
    stored = JSON.parse(raw);
  } catch {
    return { unreadable: true };
  }

  const parsed = storedSnapshotsSchema.safeParse(stored);
  if (parsed.success) {
    return { current: parsed.data.snapshots };
  }

  const v2 = storedV2SnapshotsSchema.safeParse(stored);
  if (v2.success) {
    return { legacy: v2.data.snapshots };
  }

  // v1 tracked no capital at all, so the safest reading is "all of it was
  // opening balance" — the pre-upgrade history flattens to zero growth.
  const v1 = storedV1SnapshotsSchema.safeParse(stored);
  if (v1.success) {
    return {
      legacy: v1.data.snapshots.map((snapshot) => ({
        date: snapshot.date,
        total: snapshot.total,
        baseline: snapshot.total,
      })),
    };
  }

  return { unreadable: true };
}

// Cache of the last loaded/written history so repeated reads (e.g. every home
// focus) return a stable reference instead of a freshly parsed array, which
// would invalidate NetWorthChart's memo and its geometry useMemo each focus.
// Safe because this module is the sole writer of STORAGE_KEY.
let cachedSnapshots: NetWorthSnapshot[] | null = null;

// Reads the history without upgrading legacy records — they need rates, which
// this path doesn't have. A store still holding v1/v2 therefore reads as empty
// here; `migrateSnapshots` is what converts and caches it. An unreadable store
// reads as empty too, and neither is cached, so a later call can still upgrade
// or recover it. Module-private: every caller outside this file goes through
// `migrateSnapshots`, which can tell those three cases apart.
async function listNetWorthSnapshots(): Promise<NetWorthSnapshot[]> {
  if (cachedSnapshots) {
    return cachedSnapshots;
  }

  const parsed = await parseStoredSnapshots();
  if (!("current" in parsed)) {
    return [];
  }

  cachedSnapshots = parsed.current;
  return cachedSnapshots;
}

// Serializes snapshot writes AND the upgrade (both write STORAGE_KEY) so
// concurrent callers (a home focus racing a removeAccount) can't interleave an
// upgrade with a snapshot write (lost write) or run two upgrades that convert
// the same history twice — each run sees the previous one's result.
const record = createAsyncSerializer();

// Upgrades any legacy (single-base) history to the per-currency form, once.
// Returns the current history, or null when `rates` can't convert every
// currency — callers must skip recording in that case so a partially converted
// record is never written. The converted snapshots and the retirement of the
// legacy base marker share one transaction so the store never ends up holding
// a marker that names a base no longer describing the data it labels (reads
// dispatch on `version`, so such a leftover would be inert, but the next
// migration would still have to reason about it).
export function migrateSnapshots(
  rates: ExchangeRates,
): Promise<NetWorthSnapshot[] | null> {
  return record(async () => {
    if (cachedSnapshots) {
      return cachedSnapshots;
    }

    const parsed = await parseStoredSnapshots();
    if ("current" in parsed) {
      cachedSnapshots = parsed.current;
      return cachedSnapshots;
    }

    // Unreadable: hand back nothing so the caller skips recording. Returning
    // an empty history here would let `recordNetWorthSnapshot` write today's
    // sample straight over a record a later build might still migrate — the
    // user's entire chart, gone with no error and no undo.
    if ("unreadable" in parsed) {
      return null;
    }

    if (!amountsConvertible(rates)) {
      return null;
    }

    // The marker names the base the legacy records were written in; its absence
    // means they predate the setting and use the old fixed base.
    const parsedMarker = currencySchema.safeParse(
      await getItem(LEGACY_BASE_KEY),
    );
    const base: Currency = parsedMarker.success
      ? parsedMarker.data
      : LEGACY_BASE;

    const upgraded = parsed.legacy.map((snapshot) => ({
      date: snapshot.date,
      totals: spreadFromBase(snapshot.total, base, rates),
      baselines: spreadFromBase(snapshot.baseline, base, rates),
    }));

    const stored: StoredSnapshots = { version: 3, snapshots: upgraded };
    await withTransaction(async () => {
      await setItem(STORAGE_KEY, JSON.stringify(stored));
      await removeItem(LEGACY_BASE_KEY);
    });
    // Cached only after the commit, so a rollback leaves the legacy record to
    // be retried on the next run.
    cachedSnapshots = upgraded;
    return upgraded;
  });
}

// Records today's totals and baselines, replacing an existing entry for the
// same day so the latest reading wins. Keeps the most recent MAX_SNAPSHOTS
// points. Returns the updated history so callers can use it directly instead of
// reading the same key back.
export function recordNetWorthSnapshot(
  totals: CurrencyAmounts,
  baselines: CurrencyAmounts,
): Promise<NetWorthSnapshot[]> {
  const run = async (): Promise<NetWorthSnapshot[]> => {
    const today = formatToday();
    const snapshots = await listNetWorthSnapshots();
    const last = snapshots[snapshots.length - 1];

    // Today's sample is already stored unchanged — return the cached history
    // as-is so re-focusing the home screen neither churns the key-value store
    // nor invalidates the chart's memoized geometry. Rates drift constantly, so
    // this compares every currency rather than a single base figure.
    if (
      last &&
      last.date === today &&
      knownAssetCurrencies.every(
        (currency) =>
          last.totals[currency] === totals[currency] &&
          last.baselines[currency] === baselines[currency],
      )
    ) {
      return snapshots;
    }

    const withoutToday = snapshots.filter(
      (snapshot) => snapshot.date !== today,
    );
    const updated = [...withoutToday, { date: today, totals, baselines }].slice(
      -MAX_SNAPSHOTS,
    );

    const stored: StoredSnapshots = { version: 3, snapshots: updated };
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

// Change in growth between the first and last snapshot of the window, read in
// `currency` — how much the holdings moved on their own, with accounts added or
// removed during the window netted out and exchange-rate moves counted in.
// Returns nulls when there is not yet enough history to compute a meaningful
// change.
export function computeNetWorthTrend(
  snapshots: readonly NetWorthSnapshot[],
  currency: Currency,
): NetWorthTrend {
  if (snapshots.length < 2) {
    return { changePercent: null, delta: null };
  }

  const first = snapshots[0];
  const last = snapshots[snapshots.length - 1];
  const delta =
    netWorthGrowth(last, currency) - netWorthGrowth(first, currency);

  // Capital at work over the window: what was already there at the start, plus
  // whatever was added (or minus what was removed) since. Dividing by the plain
  // opening total instead would inflate the percentage the moment an account is
  // added mid-window — the very distortion the ledger exists to remove.
  const invested =
    first.totals[currency] +
    (last.baselines[currency] - first.baselines[currency]);

  return {
    changePercent: invested <= 0 ? null : (delta / invested) * 100,
    delta,
  };
}
