import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AssetAccount } from "@/features/assets/asset-repository";
import type { ExchangeRates } from "@/features/assets/currency-conversion";
import type { NetWorthSnapshot } from "@/features/assets/net-worth-history";
import { netWorthSnapshotsQueryOptions } from "@/features/assets/net-worth-snapshots-query";

// Three collaborators are mocked, and only ONE of them for the reason AGENTS.md
// caps at a single seam: `asset-repository` pulls in `expo-crypto`, which plain
// Node cannot load. `net-worth-flows` and `net-worth-history` are pure modules
// with their own suites — mocking them here is ordinary unit isolation, not a
// way around a native import. What is under test is this module's ORCHESTRATION:
// what runs in which order, and what it does when a step cannot produce an
// answer. The arithmetic belongs to the two suites next door.
vi.mock("@/features/assets/asset-repository", () => ({
  sumBalancesInEveryCurrency: vi.fn(),
}));
vi.mock("@/features/assets/net-worth-flows", () => ({
  reconcileNetWorthFlows: vi.fn(),
}));
vi.mock("@/features/assets/net-worth-history", () => ({
  migrateSnapshots: vi.fn(),
  recordNetWorthSnapshot: vi.fn(),
}));

const { sumBalancesInEveryCurrency } =
  await import("@/features/assets/asset-repository");
const { reconcileNetWorthFlows } =
  await import("@/features/assets/net-worth-flows");
const { migrateSnapshots, recordNetWorthSnapshot } =
  await import("@/features/assets/net-worth-history");

const sumMock = vi.mocked(sumBalancesInEveryCurrency);
const reconcileMock = vi.mocked(reconcileNetWorthFlows);
const migrateMock = vi.mocked(migrateSnapshots);
const recordMock = vi.mocked(recordNetWorthSnapshot);

const RATES: ExchangeRates = { SGD: 1, USD: 2, HKD: 0.5, CNY: 0.2 };
const AMOUNTS = { SGD: 150, USD: 75, HKD: 300, CNY: 750 };

const ACCOUNTS = [{ id: "a" }] as unknown as AssetAccount[];

const snapshot = (date: string): NetWorthSnapshot => ({
  date,
  totals: AMOUNTS,
  baselines: AMOUNTS,
});

const HISTORY = [snapshot("2026-08-01")];
const RECORDED = [snapshot("2026-08-01"), snapshot("2026-08-25")];

const options = (
  overrides: Partial<Parameters<typeof netWorthSnapshotsQueryOptions>[0]> = {},
) =>
  netWorthSnapshotsQueryOptions({
    accounts: ACCOUNTS,
    rates: RATES,
    accountsVersion: 1,
    ratesVersion: 2,
    ...overrides,
  });

const run = async (
  overrides: Parameters<typeof options>[0] = {},
): Promise<NetWorthSnapshot[]> => {
  const { queryFn } = options(overrides);
  if (typeof queryFn !== "function") {
    throw new TypeError("netWorthSnapshotsQueryOptions must supply a queryFn");
  }
  return (await queryFn({} as never)) as NetWorthSnapshot[];
};

beforeEach(() => {
  vi.resetAllMocks();
  migrateMock.mockResolvedValue(HISTORY);
  reconcileMock.mockResolvedValue({ amounts: AMOUNTS, live: [] });
  recordMock.mockResolvedValue(RECORDED);
  sumMock.mockReturnValue(AMOUNTS);
});

describe("netWorthSnapshotsQueryOptions", () => {
  // The two version stamps stand in for the arrays themselves: putting the
  // accounts in the key would hash every account on every render and store a
  // multi-kilobyte cache key.
  it("keys on the two version stamps", () => {
    expect(options().queryKey).toEqual(["netWorthSnapshots", 1, 2]);
  });

  // Recording against rates that have not loaded would freeze every foreign
  // holding at "no data".
  it("waits for the rates before running", () => {
    expect(options({ rates: undefined }).enabled).toBe(false);
    expect(options().enabled).toBe(true);
  });

  it("never goes stale, because its inputs are already the key", () => {
    expect(options().staleTime).toBe(Infinity);
  });

  // Overrides the client-wide `gcTime: Infinity`, which exists for the
  // persisted rate table and is wrong here: the key space is unbounded, so an
  // immortal entry per home-screen focus would accumulate for the life of the
  // process, each retaining its closure over that generation's accounts.
  it("expires entries, unlike the client default", () => {
    expect(options().gcTime).toBe(5 * 60 * 1000);
  });

  it("stays off the online gate and does not retry", () => {
    expect(options().networkMode).toBe("always");
    expect(options().retry).toBe(0);
  });

  // Holds the previous chart while a new key resolves, and keeps it on screen
  // when the new key fails outright.
  it("keeps the previous chart while a new key resolves", () => {
    expect(options().placeholderData).toBeTypeOf("function");
  });
});

describe("the recorded snapshot", () => {
  it("upgrades the history before anything else touches it", async () => {
    await run();

    expect(migrateMock).toHaveBeenCalledWith(RATES);
    expect(migrateMock.mock.invocationCallOrder[0]).toBeLessThan(
      reconcileMock.mock.invocationCallOrder[0]!,
    );
  });

  it("records today's sample from the summed balances and the ledger", async () => {
    const result = await run();

    expect(sumMock).toHaveBeenCalledWith(ACCOUNTS, RATES);
    expect(recordMock).toHaveBeenCalledWith(AMOUNTS, AMOUNTS);
    expect(result).toBe(RECORDED);
  });

  // Throwing is what makes the chart hold its previous shape: `placeholderData`
  // keeps the last list on screen and the next focus retries. Returning an
  // empty list would erase a history that is still intact on disk.
  it("throws rather than returning empty when the history is unreadable", async () => {
    migrateMock.mockResolvedValue(null);

    await expect(run()).rejects.toThrow("not readable yet");
    expect(recordMock).not.toHaveBeenCalled();
  });

  // Otherwise every day the app is opened stores one all-zero sample, and on
  // the second of those the chart stops showing its empty state and draws a
  // flat line down the middle of the card — the absence of a reading, rendered
  // as a curve.
  it("records nothing when there are no accounts and no history", async () => {
    migrateMock.mockResolvedValue([]);

    const result = await run({ accounts: [] });

    expect(result).toEqual([]);
    expect(reconcileMock).not.toHaveBeenCalled();
    expect(recordMock).not.toHaveBeenCalled();
  });

  // The guard is on an empty HISTORY, not on empty accounts alone: someone who
  // deletes their last account really has gone to zero, and that drop belongs
  // in the record they already have.
  it("still records the drop to zero for an existing history", async () => {
    const result = await run({ accounts: [] });

    expect(recordMock).toHaveBeenCalled();
    expect(result).toBe(RECORDED);
  });

  // Measuring against stale capital would book a new account's opening balance
  // as growth — precisely the spike the ledger exists to remove.
  it.each([
    ["the ledger cannot be reconciled", null],
    ["reconciling fails outright", new Error("disk full")],
  ])("skips today's sample when %s", async (_label, outcome) => {
    if (outcome instanceof Error) {
      reconcileMock.mockRejectedValue(outcome);
    } else {
      reconcileMock.mockResolvedValue(outcome);
    }

    const result = await run();

    expect(result).toBe(HISTORY);
    expect(recordMock).not.toHaveBeenCalled();
  });

  // A snapshot write failure must never blank the chart, so it falls back to
  // the list the upgrade just returned.
  it("falls back to the upgraded history when the write fails", async () => {
    recordMock.mockRejectedValue(new Error("disk full"));

    expect(await run()).toBe(HISTORY);
  });
});
