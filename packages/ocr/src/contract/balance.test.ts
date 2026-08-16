import { describe, expect, it } from "vitest";

import {
  accountBalanceSchema,
  balanceInputSchema,
  isPartialBalanceEntry,
} from "./balance";

// The sign of a balance is load-bearing: net worth is assets minus
// liabilities, so a credit card's debt has to survive both the recognizer and
// the form to be subtracted from the total. It once did not — the form's input
// schema rejected negatives, so a correctly recognized -4,766.92 was silently
// dropped on the way to storage.
describe("balanceInputSchema", () => {
  it.each([
    ["a plain amount", "1234.56", 1234.56],
    ["grouping separators", "1,234.56", 1234.56],
    ["whitespace", " 1 234.56 ", 1234.56],
    // An empty sub-account.
    ["zero", "0", 0],
    // A credit card's balance is what you owe.
    ["a debt", "-4766.92", -4766.92],
    ["a grouped debt", "-1,745.52", -1745.52],
  ])("accepts %s", (_label, input, expected) => {
    const parsed = balanceInputSchema.safeParse(input);
    expect(parsed.success && parsed.data).toBe(expected);
  });

  it.each([
    ["letters", "abc"],
    ["an empty string", ""],
    ["a lone sign", "-"],
  ])("rejects %s", (_label, input) => {
    expect(balanceInputSchema.safeParse(input).success).toBe(false);
  });
});

describe("accountBalanceSchema", () => {
  it("stores a debt as a negative balance", () => {
    const parsed = accountBalanceSchema.safeParse({
      currency: "SGD",
      balance: -4766.92,
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a currency the app can't store", () => {
    expect(
      accountBalanceSchema.safeParse({ currency: "JPY", balance: 1 }).success,
    ).toBe(false);
  });
});

// A thirty-seventh review pass.
describe("a typed balance has to be a figure", () => {
  it.each([
    ["1,23", false],
    ["12,34.56", false],
    ["1 2 3", false],
    ["0x10", false],
    ["1e3", false],
    ["-", false],
    ["1,234.56", true],
    ["1234.56", true],
    ["-1234.56", true],
    ["0", true],
    ["1234.567", true],
  ])("%s → %s", (text, accepted) => {
    // The engine rejects the malformed shapes as "silently 10-100x wrong"; a
    // schema that claims one definition for the keyboard and the recognizer has
    // to reject them too — the more so since the field's keyboard has a comma.
    expect(balanceInputSchema.safeParse(text).success).toBe(accepted);
  });
});

describe("an entry still being typed", () => {
  // "-4" is already a valid entry on its way to "-4766.92"; the others are not
  // valid yet. What they share is that none of them is WRONG — the field must
  // not complain about any of them while the user is still typing.
  it.each(["-4", "-4766.", "1,"])("%s is partial", (text) => {
    expect(isPartialBalanceEntry(text)).toBe(true);
  });

  it("counts a lone sign as partial", () => {
    // The first keystroke of every negative balance. A row LEFT holding it
    // still has to explain the grey Save button — the field answers that with
    // `editing`, not by calling this keystroke wrong.
    expect(isPartialBalanceEntry("-")).toBe(true);
  });

  it.each(["abc", "S$100", "0x10"])("%s is wrong, not partial", (text) => {
    expect(isPartialBalanceEntry(text)).toBe(false);
  });
});
