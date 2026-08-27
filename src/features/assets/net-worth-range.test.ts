import { beforeEach, describe, expect, it, vi } from "vitest";

import type { NetWorthSnapshot } from "@/features/assets/net-worth-history";

// `vi.hoisted` so the same two mock functions survive `vi.resetModules()` —
// see the note in `base-currency-store.test.ts`.
const { getItemMock, setItemMock } = vi.hoisted(() => ({
  getItemMock: vi.fn<(key: string) => Promise<string | null>>(),
  setItemMock: vi.fn<(key: string, value: string) => Promise<void>>(),
}));

vi.mock("@/storage/kv-store", () => ({
  getItem: getItemMock,
  setItem: setItemMock,
}));

const KEY = "whole.netWorthRange";

const importRange = () => import("@/features/assets/net-worth-range");

// Only the date matters to range selection; the figures ride along untouched.
const snapshotOn = (date: string): NetWorthSnapshot => ({
  date,
  totals: { SGD: 1, USD: 1, HKD: 1, CNY: 1 },
  baselines: { SGD: 0, USD: 0, HKD: 0, CNY: 0 },
});

const NOW = new Date(2026, 7, 25); // 2026-08-25, local time

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  setItemMock.mockResolvedValue(undefined);
});

describe("NET_WORTH_RANGES", () => {
  // The array order is the order the picker renders, shortest window first.
  it("is ordered shortest to longest", async () => {
    const { NET_WORTH_RANGES } = await importRange();

    expect(NET_WORTH_RANGES).toEqual(["1m", "3m", "6m", "1y", "all"]);
  });

  // Matches the window the footer claimed before the range became selectable,
  // so the chart an existing user knows does not change under them on upgrade.
  it("defaults to six months", async () => {
    const { DEFAULT_NET_WORTH_RANGE } = await importRange();

    expect(DEFAULT_NET_WORTH_RANGE).toBe("6m");
  });
});

describe("selectSnapshotsInRange", () => {
  it("returns everything for the all-time range", async () => {
    const { selectSnapshotsInRange } = await importRange();
    const snapshots = [snapshotOn("2019-01-01"), snapshotOn("2026-08-25")];

    expect(selectSnapshotsInRange(snapshots, "all", NOW)).toEqual(snapshots);
  });

  // A copy, not the same array: the caller sorts and slices the result, and
  // handing back the stored array would let it mutate history in place.
  it("copies rather than aliasing for the all-time range", async () => {
    const { selectSnapshotsInRange } = await importRange();
    const snapshots = [snapshotOn("2026-08-25")];

    expect(selectSnapshotsInRange(snapshots, "all", NOW)).not.toBe(snapshots);
  });

  it.each([
    ["1m", "2026-07-25"],
    ["3m", "2026-05-25"],
    ["6m", "2026-02-25"],
    ["1y", "2025-08-25"],
  ] as const)(
    "keeps snapshots on the %s cutoff itself",
    async (range, cutoff) => {
      const { selectSnapshotsInRange } = await importRange();

      expect(
        selectSnapshotsInRange([snapshotOn(cutoff)], range, NOW).map(
          (s) => s.date,
        ),
      ).toEqual([cutoff]);
    },
  );

  it("drops snapshots from before the cutoff", async () => {
    const { selectSnapshotsInRange } = await importRange();
    const snapshots = [
      snapshotOn("2026-06-24"),
      snapshotOn("2026-07-24"),
      snapshotOn("2026-08-01"),
    ];

    expect(
      selectSnapshotsInRange(snapshots, "1m", NOW).map((s) => s.date),
    ).toEqual(["2026-08-01"]);
  });

  it("returns nothing when every snapshot predates the cutoff", async () => {
    const { selectSnapshotsInRange } = await importRange();

    expect(
      selectSnapshotsInRange([snapshotOn("2020-01-01")], "1m", NOW),
    ).toEqual([]);
  });

  // Subtracting a calendar month from the 31st lands in the previous month
  // (Mar 31 − 1 month → Mar 3, because Feb 31 does not exist). Documented as
  // immaterial for windows this wide — this pins the actual behaviour so the
  // note and the code cannot drift apart.
  it("tolerates a cutoff that lands in a shorter month", async () => {
    const { selectSnapshotsInRange } = await importRange();
    const march31 = new Date(2026, 2, 31);

    expect(
      selectSnapshotsInRange(
        [snapshotOn("2026-03-02"), snapshotOn("2026-03-10")],
        "1m",
        march31,
      ).map((s) => s.date),
    ).toEqual(["2026-03-10"]);
  });
});

describe("the persisted range", () => {
  it("reads the stored range", async () => {
    getItemMock.mockResolvedValue("1y");
    const { loadNetWorthRange } = await importRange();

    expect(await loadNetWorthRange()).toBe("1y");
    expect(getItemMock).toHaveBeenCalledWith(KEY);
  });

  it("writes through", async () => {
    const { saveNetWorthRange } = await importRange();

    await saveNetWorthRange("3m");

    expect(setItemMock).toHaveBeenCalledWith(KEY, "3m");
  });

  it("falls back to the default when nothing is stored", async () => {
    getItemMock.mockResolvedValue(null);
    const { loadNetWorthRange, DEFAULT_NET_WORTH_RANGE } = await importRange();

    expect(await loadNetWorthRange()).toBe(DEFAULT_NET_WORTH_RANGE);
  });

  // A view preference, never data: an unrecognized stored value degrades to
  // the default rather than failing.
  it("falls back when the stored range is unrecognized", async () => {
    getItemMock.mockResolvedValue("2y");
    const { loadNetWorthRange, DEFAULT_NET_WORTH_RANGE } = await importRange();

    expect(await loadNetWorthRange()).toBe(DEFAULT_NET_WORTH_RANGE);
  });

  // Unlike the base currency, the default here is a plain constant — there is
  // nothing for a stored copy to protect it from, so it is not pinned.
  it("does not pin the default", async () => {
    getItemMock.mockResolvedValue(null);
    const { loadNetWorthRange } = await importRange();

    await loadNetWorthRange();

    expect(setItemMock).not.toHaveBeenCalled();
  });
});
