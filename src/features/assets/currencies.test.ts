import { describe, expect, it } from "vitest";

import {
  CURRENCY_SYMBOLS,
  type Currency,
  amountsConvertible,
  currencyAmountsSchema,
  defaultDisplayCurrencyForLanguageTag,
  knownAssetCurrencies,
  mapCurrencies,
  orderedDisplayCurrencies,
} from "@/features/assets/currencies";

const RATES: Record<Currency, number> = {
  SGD: 1,
  USD: 2,
  HKD: 0.5,
  CNY: 0.2,
};

describe("mapCurrencies", () => {
  it("builds a complete record from the currency list", () => {
    expect(mapCurrencies((currency) => currency.toLowerCase())).toEqual({
      SGD: "sgd",
      USD: "usd",
      HKD: "hkd",
      CNY: "cny",
    });
  });

  // The one cast that asserts exhaustiveness lives here, so every per-currency
  // record in the app is built the same way instead of four hand-rolled loops.
  it("covers every known currency", () => {
    expect(Object.keys(mapCurrencies(() => 0)).sort()).toEqual(
      [...knownAssetCurrencies].sort(),
    );
  });
});

describe("CURRENCY_SYMBOLS", () => {
  // Hermes' Intl currency-symbol resolution is unreliable, which is why the
  // table is explicit — so it has to stay exhaustive by hand.
  it("names a symbol for every currency", () => {
    for (const currency of knownAssetCurrencies) {
      expect(CURRENCY_SYMBOLS[currency]).toBeTruthy();
    }
  });

  // CN¥ rather than a bare ¥, which JPY also uses.
  it("disambiguates the yuan from the yen", () => {
    expect(CURRENCY_SYMBOLS.CNY).toBe("CN¥");
  });
});

describe("currencyAmountsSchema", () => {
  it("accepts a complete set of amounts", () => {
    expect(currencyAmountsSchema.parse(RATES)).toEqual(RATES);
  });

  // Exhaustive both ways, which is what makes adding or removing a currency
  // invalidate every stored snapshot at once — a stored-data migration, not a
  // silent partial read.
  it("rejects a set missing a currency", () => {
    expect(
      currencyAmountsSchema.safeParse({ SGD: 1, USD: 2, HKD: 0.5 }).success,
    ).toBe(false);
  });

  it("accepts negative amounts, because a balance can be a debt", () => {
    expect(
      currencyAmountsSchema.safeParse({ ...RATES, USD: -4766.92 }).success,
    ).toBe(true);
  });
});

describe("amountsConvertible", () => {
  it("is true when every currency has a usable rate", () => {
    expect(amountsConvertible(RATES)).toBe(true);
  });

  // All-or-nothing: booking a partial set would freeze capital at a rate of
  // "no data" and permanently skew growth in the missing currencies.
  it.each([
    ["a rate of zero, which means no data", 0],
    ["a negative rate", -1],
  ])("is false for %s", (_label, badRate) => {
    expect(amountsConvertible({ ...RATES, HKD: badRate })).toBe(false);
  });
});

describe("defaultDisplayCurrencyForLanguageTag", () => {
  it.each([
    ["zh-Hant", "HKD"],
    ["zh-Hant-HK", "HKD"],
    ["zh-TW", "HKD"],
    ["zh-HK", "HKD"],
    ["zh-MO", "HKD"],
    ["zh-Hans", "CNY"],
    ["zh-Hans-CN", "CNY"],
    ["zh-CN", "CNY"],
    ["zh", "CNY"],
    ["en-SG", "SGD"],
    ["zh-SG", "SGD"],
    ["en-US", "USD"],
    ["en", "USD"],
    ["ja-JP", "USD"],
  ] as const)("maps %s to %s", (tag, expected) => {
    expect(defaultDisplayCurrencyForLanguageTag(tag)).toBe(expected);
  });

  // Singapore is checked after the Hans/Hant families, so `zh-Hans-SG` lands on
  // CNY rather than SGD. Pinned deliberately: the ordering is what the comment
  // in the module describes, and a silent flip would change what every new
  // Singaporean Simplified-Chinese install shows.
  it("resolves zh-Hans-SG through the Simplified Chinese branch", () => {
    expect(defaultDisplayCurrencyForLanguageTag("zh-Hans-SG")).toBe("CNY");
  });
});

describe("orderedDisplayCurrencies", () => {
  it("puts the locale default first and sorts the rest by code", () => {
    expect(orderedDisplayCurrencies("SGD")).toEqual([
      "SGD",
      "CNY",
      "HKD",
      "USD",
    ]);
    expect(orderedDisplayCurrencies("CNY")).toEqual([
      "CNY",
      "HKD",
      "SGD",
      "USD",
    ]);
  });

  it("lists every currency exactly once", () => {
    expect(orderedDisplayCurrencies("USD").sort()).toEqual(
      [...knownAssetCurrencies].sort(),
    );
  });
});
