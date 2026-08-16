import { describe, expect, it } from "vitest";

import {
  hasAmountShape,
  hasCurrencyAmountShape,
  isCardLike,
  isMaskedCard,
  matchAmount,
  stripDateFragments,
  toParsed,
} from "./amount";

// `matchAmount` is where most recognition mistakes are born: it decides whether
// a row of OCR text carries money, and if so how much and in what currency.
// Every case below is a shape that actually appears on an institution screen —
// the interesting ones are the rejections, because a false positive here
// invents a balance out of an account number, a date, or a phone number.
describe("matchAmount", () => {
  describe("accepts real amounts", () => {
    const cases: [text: string, amount: number, currency?: string][] = [
      ["1,234.56", 1234.56],
      ["6,672.59", 6672.59],
      // A zero balance is a real balance — an empty sub-account reads 0.00 and
      // the FORM layer decides whether to keep it, not the recognizer.
      ["0.00", 0],
      ["100,554.59", 100554.59],
      // Whole numbers with thousands grouping, no decimal tail.
      ["5,000", 5000],
      // ML Kit splits wide rows on spaces, so a space can act as the thousands
      // separator when a decimal tail proves it's one number.
      ["1 100.00", 1100],
      // Apostrophe grouping (some locales).
      ["1'234.56", 1234.56],
      // A credit card states its balance as a debt, so negatives are real
      // balances — every card account's balance was dropped while they weren't.
      ["-4,766.92", -4766.92],
      ["-1,745.52SGD", -1745.52, "SGD"],
      ["-5,797.06CNY", -5797.06, "CNY"],
      ["SGD 1,234.56", 1234.56, "SGD"],
      ["S$ 5,624.00", 5624, "SGD"],
      ["HK$ 26.14", 26.14, "HKD"],
      ["$ 789.10", 789.1, "USD"],
      // US$ must win over S$, which it contains as a substring.
      ["US$ 200.00", 200, "USD"],
      ["¥ 10,640.40", 10640.4, "CNY"],
      // CNH (offshore RMB) normalizes to CNY rather than introducing a currency
      // the app can't store.
      ["CNH 1,000.00", 1000, "CNY"],
      ["62,612.59 HKD", 62612.59, "HKD"],
    ];

    it.each(cases)("%s → %s %s", (text, amount, currency) => {
      const parsed = matchAmount(text);
      if (!parsed.ok) {
        throw new Error(`expected ${text} to parse as an amount`);
      }
      expect(parsed.amount).toBeCloseTo(amount, 2);
      expect(parsed.currency).toBe(currency);
    });
  });

  describe("rejects non-amounts", () => {
    const cases: [label: string, text: string][] = [
      // A bare integer is an account name's number ("360 Account"), not money.
      ["bare integer", "360"],
      ["bare integer with words", "360 Account"],
      // Card morphology: full numbers and masked ones.
      ["full card number", "4111 1111 1111 1111"],
      ["masked card", "**** 1234"],
      ["dotted mask", "•••• 4242"],
      // A date must never read as money.
      ["expiry date", "12/05"],
      ["full date", "12/05/2024"],
      // Three decimals is not a currency amount — reject rather than truncate.
      ["over-precise", "1,234.567"],
      ["no digits at all", "Available Balance"],
      ["empty", ""],
    ];

    it.each(cases)("%s: %s", (_label, text) => {
      expect(matchAmount(text).ok).toBe(false);
    });
  });

  // The single most valuable rule in this file: an account row often carries
  // its name and its balance on one visual line, and the name has digits of its
  // own. Anchoring to the currency mention is what keeps "360" out of the
  // balance.
  describe("anchors to the currency, not the first digit run", () => {
    it("reads the balance, not the account name's number", () => {
      const parsed = matchAmount("360 Account $5,000.00");
      expect(parsed).toMatchObject({ ok: true, amount: 5000, currency: "USD" });
    });

    it("works when the currency trails the amount", () => {
      const parsed = matchAmount("360 Account 5,000.00 SGD");
      expect(parsed).toMatchObject({ ok: true, amount: 5000, currency: "SGD" });
    });
  });
});

describe("toParsed", () => {
  it("strips grouping separators", () => {
    expect(toParsed("1,234.56", "SGD")).toMatchObject({
      ok: true,
      amount: 1234.56,
      currency: "SGD",
    });
  });

  it("keeps a zero balance", () => {
    expect(toParsed("0.00", "USD")).toMatchObject({ ok: true, amount: 0 });
  });

  it("accepts one or two decimal places", () => {
    // One decimal is a real money format: Bitget renders totals as "$403.3".
    expect(toParsed("403.3", "USD")).toMatchObject({ ok: true, amount: 403.3 });
    expect(toParsed("1.50", undefined)).toMatchObject({
      ok: true,
      amount: 1.5,
    });
  });

  it("rejects a fractional tail longer than 2 digits", () => {
    // Three or more decimals is a crypto quantity or a rate, not money.
    expect(toParsed("1.234", undefined).ok).toBe(false);
    expect(toParsed("0.00021312", undefined).ok).toBe(false);
  });

  it("accepts a bare integer (the caller applies the shape guard)", () => {
    // `toParsed` is the strict numeric conversion; deciding that a bare "360"
    // isn't a balance is `matchAmount`'s job, not this one's.
    expect(toParsed("360", undefined)).toMatchObject({ ok: true, amount: 360 });
  });
});

describe("isMaskedCard", () => {
  it.each([
    ["**** 1234", true],
    ["•••• 4242", true],
    ["···· ···· ····", true],
    ["4111 1111 1111 1111", false],
    ["1,234.56", false],
  ])("%s → %s", (text, expected) => {
    expect(isMaskedCard(text)).toBe(expected);
  });
});

describe("isCardLike", () => {
  it.each([
    ["masked", "**** 1234", true],
    ["16 consecutive digits", "4111111111111111", true],
    ["4 groups of 4", "4218 0803 2297 3829", true],
    ["hyphen-grouped card", "4218-0803-2297-3829", true],
    // Thousands separators keep a big amount from reading as a card.
    ["large amount", "1,234,567.89", false],
    ["short digit run", "1234", false],
  ])("%s: %s → %s", (_label, text, expected) => {
    expect(isCardLike(text)).toBe(expected);
  });
});

describe("stripDateFragments", () => {
  it("removes an expiry so it can't blend into a card's last four", () => {
    expect(stripDateFragments("**** 1234 08/26")).not.toContain("08/26");
  });

  it("removes a full date", () => {
    expect(stripDateFragments("Posted 12/05/2024")).not.toContain("12/05");
  });

  it("leaves an amount untouched", () => {
    expect(stripDateFragments("1,234.56")).toBe("1,234.56");
  });
});

describe("hasAmountShape", () => {
  it.each([
    ["1,234", true],
    ["1'234", true],
    ["12.34", true],
    // One decimal is NOT money on its own — with no currency in sight it is far
    // more often a rate or a quantity. `hasCurrencyAmountShape` below is what
    // accepts it once the row names a currency.
    ["403.3", false],
    ["360", false],
  ])("%s → %s", (text, expected) => {
    expect(hasAmountShape(text)).toBe(expected);
  });

  it("accepts one decimal place once a currency is named", () => {
    // Bitget Wallet renders its total as "$403.3"; requiring two decimals
    // rejected the only figure on that screen that mattered.
    expect(hasCurrencyAmountShape("403.3")).toBe(true);
    expect(hasCurrencyAmountShape("360")).toBe(false);
  });
});

describe("stripPercentages", () => {
  it("removes a rate so the figure beside it still reads", () => {
    // "63,714 -327 -0.51%" is a total, a change, and a rate. Reading the rate
    // as money shifted real balances once negatives became valid.
    expect(matchAmount("63,714 -0.51%")).toMatchObject({
      ok: true,
      amount: 63714,
    });
  });

  it("leaves nothing to read in a bare percentage", () => {
    expect(matchAmount("-0.51%").ok).toBe(false);
    expect(matchAmount("1.41%").ok).toBe(false);
  });
});

describe("Chinese magnitude suffixes", () => {
  it("rejects a figure scaled by 亿 or 万", () => {
    // The parser applies no multiplier, so reading "3.51亿" as 3.51 would be
    // wrong by eight orders of magnitude. These only appear in marketing copy.
    expect(matchAmount("3.51亿美元的保护基金").ok).toBe(false);
    expect(matchAmount("1.5万元").ok).toBe(false);
  });

  it("leaves ordinary copy containing the character alone", () => {
    // No digit immediately before 万, so this is not a scaled figure.
    expect(matchAmount("升百万保障 1,234.56")).toMatchObject({
      ok: true,
      amount: 1234.56,
    });
  });
});

describe("Latin magnitude suffixes", () => {
  it.each(["15.8K", "26.4K", "1.2M", "3B", "42.7 K"])(
    "rejects %s rather than reading it unscaled",
    (text) => {
      // Reading "15.8K" as 15.8 is wrong by a factor of 1000. IBKR abbreviates
      // every figure in its holdings table this way.
      expect(matchAmount(text).ok).toBe(false);
    },
  );

  it("only treats the suffix as a multiplier when it ends the token", () => {
    // "1.50Km" is a distance, not 1,500 — the K is part of a longer word, so the
    // magnitude rule stands down and the figure parses at face value. What
    // matters is that it is NOT silently multiplied. (Written with two decimals
    // because a one-decimal figure with no currency isn't an amount at all —
    // see `hasAmountShape` — which would mask what this case is testing.)
    expect(matchAmount("1.50Km")).toMatchObject({ ok: true, amount: 1.5 });
    expect(matchAmount("SGD 1,234.56 Km away")).toMatchObject({
      ok: true,
      amount: 1234.56,
    });
  });
});

describe("the Latin magnitude suffix stands down only for words", () => {
  it.each([
    // A real magnitude, whatever glyph OCR glues on after it.
    ["$15.8K⑦", false],
    ["$1.5M", false],
    ["$1.5M total", false],
    // The suffix is the first letter of a word, not a multiplier.
    ["1.50Km", true],
    ["SGD 5,000.00 M&A", true],
    ["SGD 1,234.56 B/F", true],
  ])("%s parses: %s", (text, ok) => {
    expect(matchAmount(text).ok).toBe(ok);
  });
});

describe("a sign printed before the currency symbol", () => {
  it.each([
    ["-S$28,120.74", -28120.74, "SGD"],
    ["-$403.30", -403.3, "USD"],
    ["-HK$1,000.00", -1000, "HKD"],
    ["-CN¥5,000.00", -5000, "CNY"],
    // The trailing layout already worked; pinned so the two stay in step.
    ["-1,745.52SGD", -1745.52, "SGD"],
  ])("%s → %s %s", (text, amount, currency) => {
    // The leading-symbol layout puts the sign outside `NUMBER_SOURCE`'s own
    // optional sign, so it was dropped and a card's debt read as an asset.
    expect(matchAmount(text)).toMatchObject({ ok: true, amount, currency });
  });

  it("does not read a spaced hyphen as a sign", () => {
    // "Savings - S$1,000.00" separates two fields. Only a sign GLUED to the
    // symbol is a sign.
    expect(matchAmount("Savings - S$1,000.00")).toMatchObject({
      ok: true,
      amount: 1000,
    });
  });
});

describe("a sign must not smuggle a scaled figure past the guard", () => {
  it.each(["-¥1.5万", "-$15.8K", "-CN¥3.51亿"])("%s is rejected", (text) => {
    // The sign is captured from the far side of the currency symbol, so `raw`
    // ("-1.5") no longer appears in the text the magnitude search scans — and a
    // signed scaled figure read at 1/1000th of its value.
    expect(matchAmount(text).ok).toBe(false);
  });

  it("still reads a signed figure that carries no magnitude suffix", () => {
    expect(matchAmount("-S$28,120.74")).toMatchObject({
      ok: true,
      amount: -28120.74,
    });
  });
});

describe("the sign must be glued to the digits", () => {
  it.each([
    ["Everyday Global - 1,234.56 SGD", 1234.56],
    ["储蓄户口 - 5,000.00", 5000],
  ])("%s reads a separator hyphen as a separator", (text, amount) => {
    // `NUMBER_SOURCE` allowed whitespace between the sign and the digits. That
    // was harmless while negatives were rejected outright; once they became
    // real balances, a hyphen between two fields turned one into a debt.
    expect(matchAmount(text)).toMatchObject({ ok: true, amount });
  });

  it.each([
    ["-1,745.52SGD", -1745.52],
    ["-S$28,120.74", -28120.74],
  ])("%s is still a debt", (text, amount) => {
    expect(matchAmount(text)).toMatchObject({ ok: true, amount });
  });

  it("still reads ML Kit's space-grouped thousands", () => {
    expect(matchAmount("SGD 1 100.00")).toMatchObject({
      ok: true,
      amount: 1100,
    });
  });
});

describe("the fallback scans for a well-formed figure", () => {
  it("finds the balance past card artwork on the same row", () => {
    // Taking the FIRST digit run and then rejecting it for shape threw the row
    // away over a number that was never a candidate.
    expect(matchAmount("$59 1,234.56")).toMatchObject({
      ok: true,
      amount: 1234.56,
    });
  });

  it("still refuses a row whose only figures are bare integers", () => {
    expect(matchAmount("360 Account").ok).toBe(false);
  });
});

// A twenty-third review pass.
describe("a decimal tail that is not cents", () => {
  it.each([
    // Money carries one or two decimals. Three is a crypto quantity or a rate,
    // and a bare dot is OCR that clipped the cents off — "1,234." could be
    // 1,234.00 or 1,234.99, so reading it as 1234 turns a lost digit into a
    // confident wrong figure.
    ["1234.567", false],
    ["1234.", false],
    ["1234.5", true],
    ["1234.56", true],
    ["1234", true],
  ])("toParsed %s → %s", (text, expected) => {
    expect(toParsed(text, undefined).ok).toBe(expected);
  });

  it("reads past OCR debris but not past a broken figure", () => {
    // `matchAmount` reads noisy text, so it takes the sound figure inside it —
    // but only when what surrounds it is DEBRIS. A neighbouring digit, comma or
    // dot means the sound-looking part is a piece of a figure this parser
    // cannot read, and taking it drops a digit group silently.
    expect(matchAmount("1,212.52⑦")).toMatchObject({
      ok: true,
      amount: 1212.52,
    });
    expect(matchAmount("$59 1,234.56")).toMatchObject({
      ok: true,
      amount: 1234.56,
    });
    expect(matchAmount("1,234.").ok).toBe(false);
    expect(matchAmount("1,234.567").ok).toBe(false);
    expect(matchAmount("12,34.56").ok).toBe(false);
    expect(matchAmount("1,23,456.78").ok).toBe(false);
  });

  it("still reads one decimal when the token carries its currency", () => {
    expect(matchAmount("$403.3")).toMatchObject({ ok: true, amount: 403.3 });
  });
});
