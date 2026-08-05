import { z } from "zod";

import { readJson, setItem } from "@/storage/kv-store";

import { type AssetAccount } from "./asset-repository";
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

// Capital moved in and out of Whole, converted at the rate on the day it moved
// and frozen there — one running figure per display currency.
//
// Freezing the conversion is what lets an exchange-rate move count as growth.
// Holdings are revalued at today's rate every time the chart is drawn; the
// capital that bought them is not. So a USD account left untouched while USD
// strengthens against CNY shows a gain when the chart is read in CNY — which is
// exactly what happened to its owner — and no gain at all read in USD, where
// nothing moved.
//
// That difference is why the ledger is kept per display currency instead of in
// one base currency converted on the fly: "how much did I gain" has a genuinely
// different answer in each currency, and only the rate at the time of each
// movement can tell them apart. Converting a single base figure at today's rate
// would give every currency the same answer, scaled.
const liveBalanceSchema = z.object({
  accountId: z.string(),
  currency: currencySchema,
  balance: z.number(),
});

const storedFlowsSchema = z.object({
  version: z.literal(2),
  amounts: currencyAmountsSchema,
  live: z.array(liveBalanceSchema),
});

// Legacy v1 ledger: capital was tracked in each account's own currency, which
// moved the total and the ledger together and hid exchange-rate gains entirely.
// Upgraded by converting each currency's net figure at the current rate — the
// movements' original rates are gone, so the pre-upgrade history reads as if it
// all happened today. Rate gains accumulate correctly from the upgrade onward.
const v1FlowSchema = z.object({
  currency: currencySchema,
  amount: z.number(),
});

const storedV1FlowsSchema = z.object({
  version: z.literal(1),
  flows: z.array(v1FlowSchema),
  live: z.array(liveBalanceSchema),
});

type StoredFlows = z.infer<typeof storedFlowsSchema>;
type LiveBalance = z.infer<typeof liveBalanceSchema>;

// The stored ledger minus its version tag — what callers reason about.
export type NetWorthFlows = Omit<StoredFlows, "version">;

const STORAGE_KEY = "whole.netWorthFlows";

const emptyAmounts = (): CurrencyAmounts => mapCurrencies(() => 0);

const EMPTY_FLOWS: NetWorthFlows = { amounts: emptyAmounts(), live: [] };

// Identity of one tracked holding. An account can hold several currencies and
// each enters and leaves on its own, so the key is the pair, not the account.
function entryKey(accountId: string, currency: Currency): string {
  return `${accountId}|${currency}`;
}

// Books `amount` of `currency` into every display currency at today's rate.
// `rates` must be complete (see amountsConvertible) — callers check first, so a
// conversion never returns null here.
function bookFlow(
  amounts: CurrencyAmounts,
  currency: Currency,
  amount: number,
  rates: ExchangeRates,
): void {
  for (const target of knownAssetCurrencies) {
    const converted = convertCurrency(amount, currency, target, rates);
    if (converted !== null) {
      amounts[target] += converted;
    }
  }
}

async function parseStoredFlows(
  rates: ExchangeRates,
): Promise<{ flows: NetWorthFlows; upgraded: boolean }> {
  const stored = await readJson(STORAGE_KEY);

  const parsed = storedFlowsSchema.safeParse(stored);
  if (parsed.success) {
    return {
      flows: { amounts: parsed.data.amounts, live: parsed.data.live },
      upgraded: false,
    };
  }

  const v1 = storedV1FlowsSchema.safeParse(stored);
  if (v1.success) {
    const amounts = emptyAmounts();
    for (const flow of v1.data.flows) {
      bookFlow(amounts, flow.currency, flow.amount, rates);
    }
    return { flows: { amounts, live: v1.data.live }, upgraded: true };
  }

  return { flows: EMPTY_FLOWS, upgraded: false };
}

// Cache of the last loaded/written ledger so repeated reads (every home focus)
// return a stable reference instead of a freshly parsed object. Safe because
// this module is the sole writer of STORAGE_KEY.
let cachedFlows: NetWorthFlows | null = null;

// Serializes the read-modify-write below so a home focus racing a removeAccount
// can't both read the same ledger and clobber each other's write — a lost write
// would double-book an inflow or drop an outflow, permanently skewing growth.
const reconcile = createAsyncSerializer();

// Books the capital movements implied by the difference between `accounts` and
// the last known holdings: a holding seen for the first time is an inflow of its
// whole balance, one that has vanished (account deleted, or a currency row
// removed from the form) is an outflow of the balance it last held, and one
// whose balance merely changed moves nothing — that difference is growth, which
// is the entire point. Each movement is converted at today's rate and frozen.
//
// Returns null when `rates` can't convert every currency: booking a partial set
// would freeze capital at a rate of "no data" and skew growth in the missing
// currencies forever. Callers skip recording and retry on the next focus.
//
// Writes only when something actually moved, so an unchanged focus stays a pure
// read and the cached ledger keeps its identity.
export function reconcileNetWorthFlows(
  accounts: readonly AssetAccount[],
  rates: ExchangeRates,
): Promise<NetWorthFlows | null> {
  return reconcile(async () => {
    if (!amountsConvertible(rates)) {
      return null;
    }

    const { flows: current, upgraded } = cachedFlows
      ? { flows: cachedFlows, upgraded: false }
      : await parseStoredFlows(rates);
    // An upgraded ledger is cached only once its write lands below. Caching it
    // here would let a failed write leave memory on the v2 shape while storage
    // still holds v1, and the next run — seeing a cache hit — would never
    // retry the upgrade.
    if (!upgraded) {
      cachedFlows = current;
    }

    const amounts = { ...current.amounts };
    const liveByKey = new Map(
      current.live.map((entry) => [
        entryKey(entry.accountId, entry.currency),
        entry,
      ]),
    );

    const nextLive: LiveBalance[] = [];
    const seen = new Set<string>();
    let moved = false;

    for (const account of accounts) {
      for (const balance of account.balances) {
        const key = entryKey(account.id, balance.currency);
        // Defensive: balances are merged per currency upstream, but a duplicate
        // row would otherwise be booked as a second inflow of the same money.
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);

        const previous = liveByKey.get(key);
        if (!previous) {
          bookFlow(amounts, balance.currency, balance.balance, rates);
          moved = true;
        } else if (previous.balance !== balance.balance) {
          // The ledger stays put — only the bookkeeping balance follows the
          // edit, and the gap between them is the growth.
          moved = true;
        }
        nextLive.push({
          accountId: account.id,
          currency: balance.currency,
          balance: balance.balance,
        });
      }
    }

    const retired = new Set<string>();
    for (const previous of current.live) {
      const key = entryKey(previous.accountId, previous.currency);
      // `retired` guards against a duplicated stored row being booked out
      // twice, which would understate capital and inflate growth forever.
      if (seen.has(key) || retired.has(key)) {
        continue;
      }
      retired.add(key);
      bookFlow(amounts, previous.currency, -previous.balance, rates);
      moved = true;
    }

    // An upgrade has to be persisted even when no capital moved, otherwise the
    // v1 record is re-converted at a different rate on every launch.
    if (!moved && !upgraded) {
      return current;
    }

    const next: NetWorthFlows = { amounts, live: nextLive };
    const stored: StoredFlows = { version: 2, ...next };
    await setItem(STORAGE_KEY, JSON.stringify(stored));
    // Update the cache only after the write succeeds, so a failed write leaves
    // the cache matching storage (mirrors saveAssetAccounts).
    cachedFlows = next;
    return next;
  });
}
