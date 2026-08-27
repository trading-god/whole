import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ExchangeRates } from "@/features/assets/currency-conversion";
import type { NetWorthSnapshot } from "@/features/assets/net-worth-history";

// `vi.hoisted` so the same mocks survive `vi.resetModules()`, which every case
// needs because the history is cached at module level.
const { getItemMock, setItemMock, removeItemMock, withTransactionMock } =
  vi.hoisted(() => ({
    getItemMock: vi.fn<(key: string) => Promise<string | null>>(),
    setItemMock: vi.fn<(key: string, value: string) => Promise<void>>(),
    removeItemMock: vi.fn<(key: string) => Promise<void>>(),
    withTransactionMock: vi.fn<(work: () => Promise<void>) => Promise<void>>(),
  }));

vi.mock("@/storage/kv-store", () => ({
  getItem: getItemMock,
  setItem: setItemMock,
  removeItem: removeItemMock,
  withTransaction: withTransactionMock,
}));

const STORAGE_KEY = "whole.netWorthHistory";
const LEGACY_BASE_KEY = "whole.netWorthHistory.snapshotBase";

// "base per foreign", base SGD. One USD is 2 SGD.
const RATES: ExchangeRates = { SGD: 1, USD: 2, HKD: 0.5, CNY: 0.2 };

const importHistory = () => import("@/features/assets/net-worth-history");

const amounts = (sgd: number) => ({
  SGD: sgd,
  USD: sgd / 2,
  HKD: sgd * 2,
  CNY: sgd * 5,
});

const snapshot = (date: string, total: number, baseline: number) => ({
  date,
  totals: amounts(total),
  baselines: amounts(baseline),
});

// Only the history key is stored unless a case says otherwise; the legacy base
// marker is absent, which means "these records predate the setting".
const storeHolds = (value: unknown) => {
  getItemMock.mockImplementation(async (key) =>
    key === STORAGE_KEY ? JSON.stringify(value) : null,
  );
};

const writtenSnapshots = () => {
  const call = setItemMock.mock.calls.findLast(([key]) => key === STORAGE_KEY);
  if (!call) {
    throw new Error("expected a write to the history key");
  }
  return JSON.parse(call[1]) as { version: number; snapshots: unknown[] };
};

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  getItemMock.mockResolvedValue(null);
  setItemMock.mockResolvedValue(undefined);
  removeItemMock.mockResolvedValue(undefined);
  // The real one runs the batch inside a sqlite transaction; here it just runs
  // it, so a case can still observe both writes.
  withTransactionMock.mockImplementation(async (work) => work());
});

describe("formatSnapshotDate", () => {
  it("writes a zero-padded local calendar date", async () => {
    const { formatSnapshotDate } = await importHistory();

    expect(formatSnapshotDate(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(formatSnapshotDate(new Date(2026, 11, 31))).toBe("2026-12-31");
  });
});

describe("parseSnapshotDate", () => {
  // Read back in UTC even though the dates are written as local calendar days:
  // the value is only ever used for the distance between two snapshots, and one
  // consistent conversion makes those distances exact.
  it("reads a snapshot date as a UTC timestamp", async () => {
    const { parseSnapshotDate } = await importHistory();

    expect(parseSnapshotDate("2026-01-05")).toBe(Date.UTC(2026, 0, 5));
  });

  it("keeps the distance between two dates exact", async () => {
    const { parseSnapshotDate } = await importHistory();
    const day = 24 * 60 * 60 * 1000;

    expect(
      parseSnapshotDate("2026-03-02") - parseSnapshotDate("2026-03-01"),
    ).toBe(day);
  });
});

describe("netWorthGrowth", () => {
  // Growth is what the holdings did on their own: value now minus the capital
  // put in. It has a different answer per currency, which is the whole reason
  // both sides are stored per currency.
  it("is the total minus the capital behind it", async () => {
    const { netWorthGrowth } = await importHistory();

    expect(netWorthGrowth(snapshot("2026-08-01", 150, 100), "SGD")).toBe(50);
    expect(netWorthGrowth(snapshot("2026-08-01", 150, 100), "USD")).toBe(25);
  });

  it("is negative when the holdings lost", async () => {
    const { netWorthGrowth } = await importHistory();

    expect(netWorthGrowth(snapshot("2026-08-01", 80, 100), "SGD")).toBe(-20);
  });
});

describe("migrateSnapshots", () => {
  it("returns the current history untouched when it is already v3", async () => {
    storeHolds({ version: 3, snapshots: [snapshot("2026-08-01", 150, 100)] });
    const { migrateSnapshots } = await importHistory();

    const result = await migrateSnapshots(RATES);

    expect(result).toHaveLength(1);
    expect(setItemMock).not.toHaveBeenCalled();
  });

  it("reads an absent store as an empty history", async () => {
    const { migrateSnapshots } = await importHistory();

    expect(await migrateSnapshots(RATES)).toEqual([]);
  });

  // The distinction this module refuses to collapse. Returning an empty
  // history for an unreadable store would let `recordNetWorthSnapshot` write
  // today's sample straight over a record a later build might still migrate —
  // the user's whole chart gone, with no error and no undo.
  it.each([
    ["malformed JSON", "{not json"],
    ["a shape no version accepts", JSON.stringify({ version: 9 })],
  ])("returns null for %s rather than an empty history", async (_l, raw) => {
    getItemMock.mockImplementation(async (key) =>
      key === STORAGE_KEY ? raw : null,
    );
    const { migrateSnapshots } = await importHistory();

    expect(await migrateSnapshots(RATES)).toBeNull();
    expect(setItemMock).not.toHaveBeenCalled();
  });

  // A partially converted record would freeze part of the history at a rate of
  // "no data", so the upgrade waits for a complete rate table.
  it("returns null when the rates cannot convert every currency", async () => {
    storeHolds({
      version: 2,
      snapshots: [{ date: "2026-08-01", total: 150, baseline: 100 }],
    });
    const { migrateSnapshots } = await importHistory();

    expect(await migrateSnapshots({ ...RATES, HKD: 0 })).toBeNull();
    expect(setItemMock).not.toHaveBeenCalled();
  });

  it("spreads a v2 record across every currency at today's rate", async () => {
    storeHolds({
      version: 2,
      snapshots: [{ date: "2026-08-01", total: 150, baseline: 100 }],
    });
    const { migrateSnapshots } = await importHistory();

    const result = await migrateSnapshots(RATES);

    expect(result?.[0]?.totals.SGD).toBeCloseTo(150, 10);
    expect(result?.[0]?.totals.USD).toBeCloseTo(75, 10);
    expect(result?.[0]?.baselines.SGD).toBeCloseTo(100, 10);
    expect(writtenSnapshots().version).toBe(3);
  });

  // v1 tracked no capital at all, so the safest reading is "all of it was
  // opening balance" — the pre-upgrade history flattens to zero growth rather
  // than inventing a gain nobody made.
  it("reads a v1 record as all capital and no growth", async () => {
    storeHolds({
      version: 1,
      snapshots: [{ date: "2026-08-01", total: 150 }],
    });
    const { migrateSnapshots, netWorthGrowth } = await importHistory();

    const result = await migrateSnapshots(RATES);

    expect(result?.[0]?.totals.SGD).toBeCloseTo(150, 10);
    expect(netWorthGrowth(result![0]!, "SGD")).toBeCloseTo(0, 10);
  });

  // The marker names the base the legacy records were written in; its absence
  // means they predate the setting and use the old fixed SGD base.
  it("converts from the base the legacy marker names", async () => {
    getItemMock.mockImplementation(async (key) => {
      if (key === STORAGE_KEY) {
        return JSON.stringify({
          version: 2,
          snapshots: [{ date: "2026-08-01", total: 100, baseline: 100 }],
        });
      }
      return key === LEGACY_BASE_KEY ? "USD" : null;
    });
    const { migrateSnapshots } = await importHistory();

    const result = await migrateSnapshots(RATES);

    // 100 USD is 200 SGD, where an absent marker would have read it as 100 SGD.
    expect(result?.[0]?.totals.SGD).toBeCloseTo(200, 10);
  });

  it("ignores a legacy marker naming a currency the app no longer ships", async () => {
    getItemMock.mockImplementation(async (key) => {
      if (key === STORAGE_KEY) {
        return JSON.stringify({
          version: 2,
          snapshots: [{ date: "2026-08-01", total: 100, baseline: 100 }],
        });
      }
      return key === LEGACY_BASE_KEY ? "XAU" : null;
    });
    const { migrateSnapshots } = await importHistory();

    const result = await migrateSnapshots(RATES);

    expect(result?.[0]?.totals.SGD).toBeCloseTo(100, 10);
  });

  // The upgraded records and the retirement of the marker land together, so
  // the store never holds a marker naming a base that no longer describes the
  // data it labels.
  it("retires the legacy marker in the same transaction", async () => {
    storeHolds({
      version: 2,
      snapshots: [{ date: "2026-08-01", total: 150, baseline: 100 }],
    });
    const { migrateSnapshots } = await importHistory();

    await migrateSnapshots(RATES);

    expect(withTransactionMock).toHaveBeenCalledTimes(1);
    expect(removeItemMock).toHaveBeenCalledWith(LEGACY_BASE_KEY);
  });

  // Cached only after the commit, so a rollback leaves the legacy record to be
  // retried on the next run rather than being masked by a cache hit.
  it("retries the upgrade after a failed commit", async () => {
    storeHolds({
      version: 2,
      snapshots: [{ date: "2026-08-01", total: 150, baseline: 100 }],
    });
    withTransactionMock.mockRejectedValueOnce(new Error("rolled back"));
    const { migrateSnapshots } = await importHistory();

    await expect(migrateSnapshots(RATES)).rejects.toThrow("rolled back");

    const result = await migrateSnapshots(RATES);

    expect(result).toHaveLength(1);
  });

  it("serves the cache on the second call", async () => {
    storeHolds({ version: 3, snapshots: [snapshot("2026-08-01", 150, 100)] });
    const { migrateSnapshots } = await importHistory();

    const first = await migrateSnapshots(RATES);
    const second = await migrateSnapshots(RATES);

    // Same reference, so the chart's memoized geometry survives a re-focus.
    expect(second).toBe(first);
    expect(getItemMock).toHaveBeenCalledTimes(1);
  });
});

describe("recordNetWorthSnapshot", () => {
  const TODAY = new Date(2026, 7, 25);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(TODAY);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("appends today's sample to an empty history", async () => {
    const { recordNetWorthSnapshot } = await importHistory();

    const result = await recordNetWorthSnapshot(amounts(150), amounts(100));

    expect(result).toHaveLength(1);
    expect(result[0]?.date).toBe("2026-08-25");
    expect(writtenSnapshots().version).toBe(3);
  });

  // Replaces rather than appends, which is what makes the write idempotent —
  // and the snapshot query depends on that, because a query may be retried,
  // refetched on mount, and refetched on focus.
  it("replaces today's sample rather than appending a second one", async () => {
    storeHolds({
      version: 3,
      snapshots: [snapshot("2026-08-25", 150, 100)],
    });
    const { recordNetWorthSnapshot } = await importHistory();

    const result = await recordNetWorthSnapshot(amounts(175), amounts(100));

    expect(result).toHaveLength(1);
    expect(result[0]?.totals.SGD).toBe(175);
  });

  it("keeps earlier days while replacing today", async () => {
    storeHolds({
      version: 3,
      snapshots: [
        snapshot("2026-08-24", 100, 100),
        snapshot("2026-08-25", 150, 100),
      ],
    });
    const { recordNetWorthSnapshot } = await importHistory();

    const result = await recordNetWorthSnapshot(amounts(175), amounts(100));

    expect(result.map((s) => s.date)).toEqual(["2026-08-24", "2026-08-25"]);
  });

  // Re-focusing the home screen must neither churn storage nor invalidate the
  // chart's memoized geometry. Rates drift constantly, so the comparison covers
  // every currency rather than a single base figure.
  it("writes nothing when today's sample is unchanged", async () => {
    storeHolds({
      version: 3,
      snapshots: [snapshot("2026-08-25", 150, 100)],
    });
    const { recordNetWorthSnapshot } = await importHistory();

    await recordNetWorthSnapshot(amounts(150), amounts(100));

    expect(setItemMock).not.toHaveBeenCalled();
  });

  it("writes when only one currency of today's sample moved", async () => {
    storeHolds({
      version: 3,
      snapshots: [snapshot("2026-08-25", 150, 100)],
    });
    const { recordNetWorthSnapshot } = await importHistory();

    await recordNetWorthSnapshot({ ...amounts(150), HKD: 999 }, amounts(100));

    expect(setItemMock).toHaveBeenCalled();
  });

  it("writes when only a baseline moved", async () => {
    storeHolds({
      version: 3,
      snapshots: [snapshot("2026-08-25", 150, 100)],
    });
    const { recordNetWorthSnapshot } = await importHistory();

    await recordNetWorthSnapshot(amounts(150), amounts(120));

    expect(setItemMock).toHaveBeenCalled();
  });

  // Roughly two years of daily samples — enough to fill the longest selectable
  // range with headroom, while still bounding the stored history.
  it("keeps only the most recent 800 samples", async () => {
    const many = Array.from({ length: 800 }, (_unused, index) =>
      snapshot(`2024-01-${String((index % 28) + 1).padStart(2, "0")}`, 1, 1),
    );
    storeHolds({ version: 3, snapshots: many });
    const { recordNetWorthSnapshot } = await importHistory();

    const result = await recordNetWorthSnapshot(amounts(150), amounts(100));

    expect(result).toHaveLength(800);
    expect(result.at(-1)?.date).toBe("2026-08-25");
  });

  // A home focus racing a delete must not interleave two read-modify-writes.
  it("serializes concurrent writes", async () => {
    const { recordNetWorthSnapshot } = await importHistory();

    const [first, second] = await Promise.all([
      recordNetWorthSnapshot(amounts(150), amounts(100)),
      recordNetWorthSnapshot(amounts(175), amounts(100)),
    ]);

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(second[0]?.totals.SGD).toBe(175);
  });

  // A store still holding a legacy shape reads as empty on this path, because
  // upgrading needs rates that `recordNetWorthSnapshot` does not have. The
  // caller is expected to have run `migrateSnapshots` first.
  it("reads a legacy store as empty rather than upgrading it", async () => {
    storeHolds({
      version: 2,
      snapshots: [{ date: "2026-08-01", total: 150, baseline: 100 }],
    });
    const { recordNetWorthSnapshot } = await importHistory();

    const result = await recordNetWorthSnapshot(amounts(175), amounts(100));

    expect(result).toHaveLength(1);
  });
});

describe("computeNetWorthTrend", () => {
  const trendOver = async (
    snapshots: NetWorthSnapshot[],
    currency: "SGD" | "USD" = "SGD",
  ) => {
    const { computeNetWorthTrend } = await importHistory();
    return computeNetWorthTrend(snapshots, currency);
  };

  it.each([
    ["an empty window", []],
    ["a single sample", [snapshot("2026-08-01", 150, 100)]],
  ])("reports nothing for %s", async (_label, snapshots) => {
    expect(await trendOver(snapshots)).toEqual({
      changePercent: null,
      delta: null,
    });
  });

  it("is the change in growth across the window", async () => {
    const trend = await trendOver([
      snapshot("2026-08-01", 100, 100),
      snapshot("2026-08-25", 150, 100),
    ]);

    // Growth went from 0 to 50 against 100 of capital at work.
    expect(trend.delta).toBeCloseTo(50, 10);
    expect(trend.changePercent).toBeCloseTo(50, 10);
  });

  it("is negative when the holdings lost", async () => {
    const trend = await trendOver([
      snapshot("2026-08-01", 100, 100),
      snapshot("2026-08-25", 80, 100),
    ]);

    expect(trend.delta).toBeCloseTo(-20, 10);
    expect(trend.changePercent).toBeCloseTo(-20, 10);
  });

  // Capital added mid-window is netted out. Dividing by the plain opening total
  // instead would inflate the percentage the moment an account is added — the
  // very distortion the ledger exists to remove.
  it("nets out capital added during the window", async () => {
    const trend = await trendOver([
      snapshot("2026-08-01", 100, 100),
      snapshot("2026-08-25", 250, 200),
    ]);

    // Growth 0 → 50 on 100 opening plus 100 added: 50 on 200.
    expect(trend.delta).toBeCloseTo(50, 10);
    expect(trend.changePercent).toBeCloseTo(25, 10);
  });

  // The same window read in another currency has a genuinely different answer,
  // because holdings are revalued and the capital behind them is not.
  it("answers per currency", async () => {
    const snapshots = [
      snapshot("2026-08-01", 100, 100),
      snapshot("2026-08-25", 150, 100),
    ];

    expect((await trendOver(snapshots, "USD")).delta).toBeCloseTo(25, 10);
  });

  // No capital at work means no meaningful percentage — reporting one would be
  // a division by zero dressed up as a number.
  it.each([
    ["nothing was ever invested", 0, 0],
    ["the capital nets out negative", 0, -50],
  ])("reports no percentage when %s", async (_label, total, baseline) => {
    const trend = await trendOver([
      snapshot("2026-08-01", total, baseline),
      snapshot("2026-08-25", total, baseline),
    ]);

    expect(trend.changePercent).toBeNull();
    expect(trend.delta).toBeCloseTo(0, 10);
  });
});
