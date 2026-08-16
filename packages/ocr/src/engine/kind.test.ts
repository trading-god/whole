import { describe, expect, it } from "vitest";

import { detectAssetKind } from "./kind";

// Kind classification is a keyword table, so the risk isn't the happy path —
// it's short tokens firing inside longer words and routing a cash account to
// the wrong kind.
//
// `detectAssetKind` returns undefined rather than "cash" when nothing matches:
// that is what lets the parser fall back to the institution's own kind before
// defaulting (see `groupToRecognized`), so these assert undefined, not "cash".
describe("detectAssetKind", () => {
  it("returns undefined when no keyword matches", () => {
    expect(detectAssetKind("360 Account")).toBeUndefined();
    expect(detectAssetKind("")).toBeUndefined();
  });

  it.each([
    ["IBKR Brokerage", "investment"],
    ["Securities Account", "investment"],
    ["证券账户", "investment"],
    ["股票持仓", "investment"],
    ["理财产品", "investment"],
    ["Crypto Wallet", "crypto"],
    ["BTC", "crypto"],
    ["ETH Balance", "crypto"],
    ["USDT", "crypto"],
    ["数字货币", "crypto"],
    ["交易所账户", "crypto"],
  ])("%s → %s", (text, kind) => {
    expect(detectAssetKind(text)).toBe(kind);
  });

  // ASCII keywords are word-bounded precisely so these don't fire.
  describe("short tickers don't fire inside longer words", () => {
    it.each([
      ["Netherlands Savings", "eth"],
      ["Bethany Account", "eth"],
    ])("%s stays unmatched (would have matched %s)", (text) => {
      expect(detectAssetKind(text)).toBeUndefined();
    });
  });

  // These were deliberately left out of the table: too many non-crypto
  // products use them, and misrouting a cash account is worse than defaulting.
  describe("deliberate non-markers", () => {
    it.each(["零钱包", "支付宝钱包", "ABC Trading Ltd"])(
      "%s stays unmatched",
      (text) => {
        expect(detectAssetKind(text)).toBeUndefined();
      },
    );
  });

  it("prefers investment over crypto when both appear", () => {
    // Rule order is specificity order; this pins it so a reorder is visible.
    expect(detectAssetKind("证券 crypto")).toBe("investment");
  });
});
