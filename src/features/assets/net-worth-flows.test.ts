import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AssetAccount } from "@/features/assets/asset-repository";
import type { ExchangeRates } from "@/features/assets/currency-conversion";

// `vi.hoisted` so the same mocks survive `vi.resetModules()`, which every case
// needs because the ledger is cached at module level.
const { readJsonMock, setItemMock } = vi.hoisted(() => ({
  readJsonMock: vi.fn<(key: string) => Promise<unknown>>(),
  setItemMock: vi.fn<(key: string, value: string) => Promise<void>>(),
}));

vi.mock("@/storage/kv-store", () => ({
  readJson: readJsonMock,
  setItem: setItemMock,
}));

const KEY = "whole.netWorthFlows";

// "base per foreign", base SGD. One USD is 2 SGD, which makes the conversions
// below checkable by hand.
const RATES: ExchangeRates = { SGD: 1, USD: 2, HKD: 0.5, CNY: 0.2 };

const importFlows = () => import("@/features/assets/net-worth-flows");

const account = (
  id: string,
  balances: { currency: keyof ExchangeRates; balance: number }[],
): AssetAccount =>
  ({
    id,
    name: id,
    kind: "cash",
    balances,
  }) as AssetAccount;

const written = () => {
  const call = setItemMock.mock.calls.at(-1);
  if (!call) {
    throw new Error("expected a write");
  }
  return JSON.parse(call[1]) as {
    version: number;
    amounts: Record<string, number>;
    live: { accountId: string; currency: string; balance: number }[];
  };
};

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  readJsonMock.mockResolvedValue(null);
  setItemMock.mockResolvedValue(undefined);
});

describe("reconcileNetWorthFlows", () => {
  // Booking a partial set would freeze capital at a rate of "no data" and skew
  // growth in the missing currencies forever. Skipping and retrying on the next
  // focus is the only safe move.
  it("returns null when the rates cannot convert every currency", async () => {
    const { reconcileNetWorthFlows } = await importFlows();

    const result = await reconcileNetWorthFlows(
      [account("a", [{ currency: "SGD", balance: 100 }])],
      { ...RATES, HKD: 0 },
    );

    expect(result).toBeNull();
    expect(setItemMock).not.toHaveBeenCalled();
  });

  it("books a first sighting as an inflow of the whole balance", async () => {
    const { reconcileNetWorthFlows } = await importFlows();

    const result = await reconcileNetWorthFlows(
      [account("a", [{ currency: "USD", balance: 50 }])],
      RATES,
    );

    // 50 USD at 2 SGD per USD is 100 SGD, and 100 SGD is 200 HKD at 0.5.
    expect(result?.amounts.USD).toBeCloseTo(50, 10);
    expect(result?.amounts.SGD).toBeCloseTo(100, 10);
    expect(result?.amounts.HKD).toBeCloseTo(200, 10);
    expect(result?.live).toEqual([
      { accountId: "a", currency: "USD", balance: 50 },
    ]);
  });

  it("persists the ledger under a versioned envelope", async () => {
    const { reconcileNetWorthFlows } = await importFlows();

    await reconcileNetWorthFlows(
      [account("a", [{ currency: "SGD", balance: 100 }])],
      RATES,
    );

    expect(setItemMock).toHaveBeenCalledWith(KEY, expect.any(String));
    expect(written().version).toBe(2);
  });

  // The entire point of the model: holdings are revalued at today's rate, the
  // capital behind them is not, and the gap is growth.
  it("moves no capital when only the balance changed", async () => {
    readJsonMock.mockResolvedValue({
      version: 2,
      amounts: { SGD: 100, USD: 50, HKD: 200, CNY: 500 },
      live: [{ accountId: "a", currency: "SGD", balance: 100 }],
    });
    const { reconcileNetWorthFlows } = await importFlows();

    const result = await reconcileNetWorthFlows(
      [account("a", [{ currency: "SGD", balance: 175 }])],
      RATES,
    );

    expect(result?.amounts.SGD).toBe(100);
    // The bookkeeping balance still follows the edit, so the next run does not
    // read the change as a fresh inflow.
    expect(result?.live).toEqual([
      { accountId: "a", currency: "SGD", balance: 175 },
    ]);
  });

  it("books a vanished holding as an outflow of what it last held", async () => {
    readJsonMock.mockResolvedValue({
      version: 2,
      amounts: { SGD: 100, USD: 50, HKD: 200, CNY: 500 },
      live: [{ accountId: "a", currency: "SGD", balance: 100 }],
    });
    const { reconcileNetWorthFlows } = await importFlows();

    const result = await reconcileNetWorthFlows([], RATES);

    expect(result?.amounts.SGD).toBeCloseTo(0, 10);
    expect(result?.live).toEqual([]);
  });

  // An account holding several currencies has each one enter and leave on its
  // own, so the ledger key is the pair, not the account.
  it("tracks each currency of one account separately", async () => {
    readJsonMock.mockResolvedValue({
      version: 2,
      amounts: { SGD: 100, USD: 50, HKD: 200, CNY: 500 },
      live: [
        { accountId: "a", currency: "SGD", balance: 100 },
        { accountId: "a", currency: "USD", balance: 10 },
      ],
    });
    const { reconcileNetWorthFlows } = await importFlows();

    const result = await reconcileNetWorthFlows(
      [account("a", [{ currency: "SGD", balance: 100 }])],
      RATES,
    );

    // Only the USD row left: 10 USD is 20 SGD, so 100 − 20 = 80.
    expect(result?.amounts.SGD).toBeCloseTo(80, 10);
    expect(result?.live).toEqual([
      { accountId: "a", currency: "SGD", balance: 100 },
    ]);
  });

  // An unchanged focus must stay a pure read, so the cached ledger keeps its
  // identity and the home screen does not re-render on every focus.
  it("does not write when nothing moved", async () => {
    readJsonMock.mockResolvedValue({
      version: 2,
      amounts: { SGD: 100, USD: 50, HKD: 200, CNY: 500 },
      live: [{ accountId: "a", currency: "SGD", balance: 100 }],
    });
    const { reconcileNetWorthFlows } = await importFlows();

    await reconcileNetWorthFlows(
      [account("a", [{ currency: "SGD", balance: 100 }])],
      RATES,
    );

    expect(setItemMock).not.toHaveBeenCalled();
  });

  it("starts from an empty ledger when storage holds nothing usable", async () => {
    readJsonMock.mockResolvedValue({ version: 99, nonsense: true });
    const { reconcileNetWorthFlows } = await importFlows();

    const result = await reconcileNetWorthFlows(
      [account("a", [{ currency: "SGD", balance: 100 }])],
      RATES,
    );

    expect(result?.amounts.SGD).toBeCloseTo(100, 10);
  });

  // Balances are merged per currency upstream, but a duplicated row would
  // otherwise be booked as a second inflow of the same money.
  it("books a duplicated currency row only once", async () => {
    const { reconcileNetWorthFlows } = await importFlows();

    const result = await reconcileNetWorthFlows(
      [
        account("a", [
          { currency: "SGD", balance: 100 },
          { currency: "SGD", balance: 100 },
        ]),
      ],
      RATES,
    );

    expect(result?.amounts.SGD).toBeCloseTo(100, 10);
    expect(result?.live).toHaveLength(1);
  });

  // A duplicated stored row booked out twice would understate capital and
  // inflate growth forever.
  it("books a duplicated stored row out only once", async () => {
    readJsonMock.mockResolvedValue({
      version: 2,
      amounts: { SGD: 100, USD: 50, HKD: 200, CNY: 500 },
      live: [
        { accountId: "a", currency: "SGD", balance: 100 },
        { accountId: "a", currency: "SGD", balance: 100 },
      ],
    });
    const { reconcileNetWorthFlows } = await importFlows();

    const result = await reconcileNetWorthFlows([], RATES);

    expect(result?.amounts.SGD).toBeCloseTo(0, 10);
  });

  describe("the v1 upgrade", () => {
    const v1 = {
      version: 1,
      flows: [{ currency: "USD", amount: 50 }],
      live: [{ accountId: "a", currency: "USD", balance: 50 }],
    };

    // v1 tracked capital in each account's own currency, which moved the total
    // and the ledger together and hid rate gains entirely. The original rates
    // are gone, so the pre-upgrade history reads as if it happened today.
    it("re-books the legacy ledger into every currency at today's rate", async () => {
      readJsonMock.mockResolvedValue(v1);
      const { reconcileNetWorthFlows } = await importFlows();

      const result = await reconcileNetWorthFlows(
        [account("a", [{ currency: "USD", balance: 50 }])],
        RATES,
      );

      expect(result?.amounts.USD).toBeCloseTo(50, 10);
      expect(result?.amounts.SGD).toBeCloseTo(100, 10);
    });

    // Otherwise the v1 record is re-converted at a different rate on every
    // launch, and the ledger drifts a little each time.
    it("persists even though no capital moved", async () => {
      readJsonMock.mockResolvedValue(v1);
      const { reconcileNetWorthFlows } = await importFlows();

      await reconcileNetWorthFlows(
        [account("a", [{ currency: "USD", balance: 50 }])],
        RATES,
      );

      expect(written().version).toBe(2);
    });

    // Caching the upgraded shape before the write lands would leave memory on
    // v2 while storage still holds v1 — and the next run, seeing a cache hit,
    // would never retry the upgrade.
    it("retries the upgrade after a failed write", async () => {
      readJsonMock.mockResolvedValue(v1);
      setItemMock.mockRejectedValueOnce(new Error("disk full"));
      const { reconcileNetWorthFlows } = await importFlows();
      const accounts = [account("a", [{ currency: "USD", balance: 50 }])];

      await expect(reconcileNetWorthFlows(accounts, RATES)).rejects.toThrow(
        "disk full",
      );

      await reconcileNetWorthFlows(accounts, RATES);

      expect(readJsonMock).toHaveBeenCalledTimes(2);
      expect(written().version).toBe(2);
    });
  });

  // A home focus racing a delete must not let both read the same ledger and
  // clobber each other: a lost write would double-book an inflow or drop an
  // outflow, permanently skewing growth.
  it("serializes concurrent reconciliations", async () => {
    const { reconcileNetWorthFlows } = await importFlows();
    const accounts = [account("a", [{ currency: "SGD", balance: 100 }])];

    const [first, second] = await Promise.all([
      reconcileNetWorthFlows(accounts, RATES),
      reconcileNetWorthFlows(accounts, RATES),
    ]);

    // The second run sees the first's ledger, so the inflow is booked once.
    expect(first?.amounts.SGD).toBeCloseTo(100, 10);
    expect(second?.amounts.SGD).toBeCloseTo(100, 10);
    expect(setItemMock).toHaveBeenCalledTimes(1);
  });

  // Caching after a successful write only, mirroring `saveAssetAccounts`.
  it("reads storage once and serves the cache afterwards", async () => {
    const { reconcileNetWorthFlows } = await importFlows();
    const accounts = [account("a", [{ currency: "SGD", balance: 100 }])];

    await reconcileNetWorthFlows(accounts, RATES);
    await reconcileNetWorthFlows(accounts, RATES);

    expect(readJsonMock).toHaveBeenCalledTimes(1);
  });
});
