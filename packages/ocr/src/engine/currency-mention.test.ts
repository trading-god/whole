import { describe, expect, it } from "vitest";

import { currencyMention, leadingCurrencyName } from "./currency-mention";

// The currency scanner tells the amount parser WHERE a currency sits and HOW
// it's spelled, so ordering bugs here (a symbol that contains another symbol)
// silently mis-denominate a balance rather than failing loudly.
describe("currencyMention", () => {
  it.each([
    ["SGD 1,234.56", "SGD"],
    ["USD 100.00", "USD"],
    ["HKD 26.14", "HKD"],
    ["CNY 10,640.40", "CNY"],
    ["S$ 5,624.00", "SGD"],
    ["HK$ 62,612.59", "HKD"],
    ["CN¥ 1,000.00", "CNY"],
    ["$ 789.10", "USD"],
  ])("%s → %s", (text, currency) => {
    expect(currencyMention(text)?.currency).toBe(currency);
  });

  it("returns undefined when no currency is named", () => {
    expect(currencyMention("360 Account")).toBeUndefined();
    expect(currencyMention("1,234.56")).toBeUndefined();
  });

  // The two aliases that only exist because real screens print them.
  describe("OCR-only spellings", () => {
    it("reads a bare ¥ as CNY", () => {
      // The display map only carries the disambiguating CN¥, but Chinese bank
      // screens print a bare ¥.
      expect(currencyMention("¥ 10,640.40")?.currency).toBe("CNY");
    });

    it("normalizes CNH (offshore RMB) to CNY", () => {
      // Treating CNH as its own currency would introduce one the app can't
      // store; for account recognition they're the same money.
      expect(currencyMention("CNH 1,000.00")?.currency).toBe("CNY");
    });
  });

  // US$ contains S$. Scanning in the wrong order would read "US$ 200" as SGD —
  // a wrong currency on a real balance, which is worse than no reading at all.
  it("prefers US$ over the S$ it contains", () => {
    expect(currencyMention("US$ 200.00")?.currency).toBe("USD");
  });

  it("reports the earliest mention when a row names several", () => {
    const mention = currencyMention("SGD 1,000.00 / USD 750.00");
    expect(mention?.currency).toBe("SGD");
    expect(mention?.index).toBe(0);
  });

  it("reports the index and spelling so the amount can be anchored to it", () => {
    const mention = currencyMention("360 Account $5,000.00");
    expect(mention).toMatchObject({ currency: "USD", token: "$" });
    // The index must point at the "$", not at the row start, or the amount
    // parser's window would center on the account name's digits.
    expect(mention?.index).toBe("360 Account ".length);
  });

  it("matches an ISO code only as a whole word", () => {
    // "USDT" is a crypto ticker, not a USD mention with a stray T.
    expect(currencyMention("USDT")?.currency).not.toBe("USD");
  });
});

describe("the index points into the text the caller holds", () => {
  it("survives a ligature before the currency", () => {
    // `toUpperCase` turns ﬁ into FI, so an index taken from an uppercased copy
    // lands a character off — onto the neighbouring token.
    const text = "Proﬁt S$1,234.56";
    const mention = currencyMention(text);
    expect(mention).toBeDefined();
    expect(
      text.slice(mention!.index, mention!.index + mention!.token.length),
    ).toBe("S$");
  });

  it("still refuses a code embedded in a ticker", () => {
    expect(currencyMention("USDT 100")).toBeUndefined();
  });
});

describe("an ISO alias is bounded like an ISO code", () => {
  it("reads CNH as CNY but not inside a longer word", () => {
    expect(currencyMention("CNH 1,234.56")).toMatchObject({ currency: "CNY" });
    expect(currencyMention("TCNHX 100")).toBeUndefined();
  });
});

describe("leadingCurrencyName", () => {
  it.each([
    ["港元储蓄", "HKD"],
    ["美元储蓄", "USD"],
    ["人民币储蓄", "CNY"],
    ["新加坡元储蓄", "SGD"],
  ])("%s names %s", (text, currency) => {
    expect(leadingCurrencyName(text)).toBe(currency);
  });

  it.each([
    // Mid-sentence marketing copy, and a card whose NAME ends in a currency.
    "3.51亿美元的",
    "汇丰Pulse银联双币钻石卡-人民币",
    // ISO codes and symbols are not word-bounded here, and a crypto screen is
    // full of tokens that merely start with one.
    "USDT",
    "$5,000.00",
    "储蓄",
  ])("%s names none", (text) => {
    expect(leadingCurrencyName(text)).toBeUndefined();
  });
});
