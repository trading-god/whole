import { describe, expect, it } from "vitest";

import type { OcrTextBlock } from "../contract/block";
import { row, screen } from "../test-support/screen";
import { recognitionSelectionSchema, resolveRecognition } from "./resolve";

// A screen whose block indices the cases below refer to by position.
const blocksOf = (...texts: string[][]): OcrTextBlock[] =>
  screen(...texts.map((line) => row(...line)));

const SCREEN = blocksOf(
  ["360", "Account"], // 0, 1
  ["624-680187-001"], // 2
  ["可用余额", "6,672.59", "SGD"], // 3, 4, 5
);

const selection = (overrides: Record<string, unknown> = {}) =>
  recognitionSelectionSchema.parse({
    accounts: [
      {
        nameBlocks: [0, 1],
        lastFourBlock: 2,
        balances: [{ amountBlock: 4, currencyBlock: 5 }],
      },
    ],
    ...overrides,
  });

describe("recognitionSelectionSchema", () => {
  it("accepts a complete selection", () => {
    expect(selection().accounts).toHaveLength(1);
  });

  // An index is a position in a list, so anything that is not a whole
  // non-negative number is not an index — and rejecting it in the schema means
  // the resolver never has to consider it.
  it.each([
    ["a negative index", -1],
    ["a fractional index", 1.5],
    ["a string", "4"],
  ])("rejects %s", (_label, amountBlock) => {
    expect(
      recognitionSelectionSchema.safeParse({
        accounts: [{ balances: [{ amountBlock }] }],
      }).success,
    ).toBe(false);
  });

  it("defaults the optional lists so the resolver never sees undefined", () => {
    const parsed = recognitionSelectionSchema.parse({ accounts: [{}] });

    expect(parsed.accounts[0]).toMatchObject({ nameBlocks: [], balances: [] });
  });

  // The one free-text field that touches money is the asset kind, and it is a
  // closed enum — so a model cannot invent a category to file an account under.
  it("rejects an asset kind the app cannot store", () => {
    expect(
      recognitionSelectionSchema.safeParse({
        accounts: [{ kind: "real-estate" }],
      }).success,
    ).toBe(false);
  });
});

describe("resolveRecognition", () => {
  it("joins the name out of the blocks the model pointed at", () => {
    const { accounts } = resolveRecognition(SCREEN, selection());

    expect(accounts[0]?.accountName).toBe("360 Account");
  });

  // THE property the whole design rests on. The figure recorded is parsed from
  // the block's own text, so a model cannot report a number that is not on the
  // screen — it can only point at the wrong block, which a person can see.
  it("reads the balance out of the block, not out of the answer", () => {
    const { accounts } = resolveRecognition(SCREEN, selection());

    expect(accounts[0]?.balances).toEqual([
      { currency: "SGD", balance: 6672.59 },
    ]);
  });

  it("reads the last four digits off the end of the account number", () => {
    const { accounts } = resolveRecognition(SCREEN, selection());

    // "624-680187-001" is the digit run 624680187001; its tail four is 7001.
    expect(accounts[0]?.accountLastFourDigits).toBe("7001");
  });

  it("carries the asset kind through", () => {
    const parsed = recognitionSelectionSchema.parse({
      accounts: [{ nameBlocks: [0], kind: "crypto" }],
    });

    expect(resolveRecognition(SCREEN, parsed).accounts[0]?.kind).toBe("crypto");
  });

  describe("out-of-range indices", () => {
    // The range check is the second half of the provenance guarantee: an index
    // that points nowhere is a field dropped, never a field invented.
    it("drops a name that points past the end of the screen", () => {
      const parsed = recognitionSelectionSchema.parse({
        accounts: [
          {
            nameBlocks: [99],
            balances: [{ amountBlock: 4, currencyBlock: 5 }],
          },
        ],
      });

      const { accounts } = resolveRecognition(SCREEN, parsed);

      expect(accounts[0]?.accountName).toBeUndefined();
      // …and the rest of the account survives, because dropping a whole
      // account over one bad index would throw away work the user can use.
      expect(accounts[0]?.balances).toHaveLength(1);
    });

    it("drops a balance whose amount points nowhere", () => {
      const parsed = recognitionSelectionSchema.parse({
        accounts: [{ nameBlocks: [0, 1], balances: [{ amountBlock: 99 }] }],
      });

      const { accounts } = resolveRecognition(SCREEN, parsed);

      expect(accounts[0]?.balances).toBeUndefined();
      expect(accounts[0]?.accountName).toBe("360 Account");
    });

    it("drops a last four that points nowhere", () => {
      const parsed = recognitionSelectionSchema.parse({
        accounts: [{ nameBlocks: [0], lastFourBlock: 99 }],
      });

      expect(
        resolveRecognition(SCREEN, parsed).accounts[0]?.accountLastFourDigits,
      ).toBeUndefined();
    });

    it("skips a name block that points nowhere but keeps the rest", () => {
      const parsed = recognitionSelectionSchema.parse({
        accounts: [{ nameBlocks: [0, 99, 1] }],
      });

      expect(resolveRecognition(SCREEN, parsed).accounts[0]?.accountName).toBe(
        "360 Account",
      );
    });
  });

  describe("what the block does not say", () => {
    // Pointing at a label instead of a figure is the model's mistake to make;
    // recording "可用余额" as a balance is not something this layer will do.
    it("drops a balance whose block holds no amount", () => {
      const parsed = recognitionSelectionSchema.parse({
        accounts: [{ balances: [{ amountBlock: 3, currencyBlock: 5 }] }],
      });

      expect(resolveRecognition(SCREEN, parsed).accounts).toEqual([]);
    });

    it("drops a last four whose block holds no digits", () => {
      const parsed = recognitionSelectionSchema.parse({
        accounts: [{ nameBlocks: [0], lastFourBlock: 3 }],
      });

      expect(
        resolveRecognition(SCREEN, parsed).accounts[0]?.accountLastFourDigits,
      ).toBeUndefined();
    });

    it("drops a currency block that names no currency", () => {
      const parsed = recognitionSelectionSchema.parse({
        accounts: [{ balances: [{ amountBlock: 4, currencyBlock: 3 }] }],
      });

      expect(resolveRecognition(SCREEN, parsed).accounts).toEqual([]);
    });
  });

  describe("where the currency comes from", () => {
    it("takes it from the block the model pointed at", () => {
      const { accounts } = resolveRecognition(SCREEN, selection());

      expect(accounts[0]?.balances?.[0]?.currency).toBe("SGD");
    });

    // A card prints its debt already signed and already denominated, in one
    // block: "-1,745.52SGD".
    it("takes it from the amount block when it is written there", () => {
      const blocks = blocksOf(["HSBC Live+"], ["-1,745.52SGD"]);
      const parsed = recognitionSelectionSchema.parse({
        accounts: [{ nameBlocks: [0], balances: [{ amountBlock: 1 }] }],
      });

      expect(resolveRecognition(blocks, parsed).accounts[0]?.balances).toEqual([
        { currency: "SGD", balance: -1745.52 },
      ]);
    });

    // A domestic bank prints its home currency nowhere — a China Merchants
    // overview reads "76,007.05" with no symbol on screen. There is no block to
    // point at, so the model states the currency instead. It cannot invent one:
    // the schema is a four-member enum, and a wrong-but-valid choice is visible
    // to the user in the draft.
    it("takes a stated currency when the screen names none", () => {
      const blocks = blocksOf(["活钱"], ["76,007.05"]);
      const parsed = recognitionSelectionSchema.parse({
        accounts: [
          { nameBlocks: [0], balances: [{ amountBlock: 1, currency: "CNY" }] },
        ],
      });

      expect(resolveRecognition(blocks, parsed).accounts[0]?.balances).toEqual([
        { currency: "CNY", balance: 76007.05 },
      ]);
    });

    it("prefers the block over a stated currency that disagrees", () => {
      const parsed = recognitionSelectionSchema.parse({
        accounts: [
          {
            balances: [{ amountBlock: 4, currencyBlock: 5, currency: "CNY" }],
          },
        ],
      });

      expect(
        resolveRecognition(SCREEN, parsed).accounts[0]?.balances?.[0]?.currency,
      ).toBe("SGD");
    });

    // A currency index that points nowhere falls through to the next source
    // rather than taking the balance down with it.
    it("falls back when the currency block points nowhere", () => {
      const blocks = blocksOf(["HSBC Live+"], ["-1,745.52SGD"]);
      const parsed = recognitionSelectionSchema.parse({
        accounts: [
          {
            nameBlocks: [0],
            balances: [{ amountBlock: 1, currencyBlock: 99 }],
          },
        ],
      });

      expect(resolveRecognition(blocks, parsed).accounts[0]?.balances).toEqual([
        { currency: "SGD", balance: -1745.52 },
      ]);
    });

    it("drops a balance with no currency from anywhere", () => {
      const blocks = blocksOf(["活钱"], ["76,007.05"]);
      const parsed = recognitionSelectionSchema.parse({
        accounts: [{ nameBlocks: [0], balances: [{ amountBlock: 1 }] }],
      });

      expect(
        resolveRecognition(blocks, parsed).accounts[0]?.balances,
      ).toBeUndefined();
    });

    // A settled card reads 0.00 and an empty sub-account reads 0.00; both are
    // real readings. Whether either is worth carrying into the form is the
    // form's decision, not this layer's.
    it("keeps a zero balance", () => {
      const blocks = blocksOf(["Global Savings"], ["0.00", "USD"]);
      const parsed = recognitionSelectionSchema.parse({
        accounts: [
          {
            nameBlocks: [0],
            balances: [{ amountBlock: 1, currencyBlock: 2 }],
          },
        ],
      });

      expect(resolveRecognition(blocks, parsed).accounts[0]?.balances).toEqual([
        { currency: "USD", balance: 0 },
      ]);
    });
  });

  // A card's balance is what is OWED, and net worth is assets minus
  // liabilities — so the sign has to survive the whole chain in order to be
  // subtracted. Issuers print it two ways: already signed ("-1,745.52SGD"), or
  // as what was SPENT beside a label that says so ("您花了 4,766.92"). Pure
  // indices cannot express the second, which is why this one inference exists.
  describe("debts", () => {
    it("negates a figure the screen printed as an amount spent", () => {
      const blocks = blocksOf(
        ["OCBC 365 Credit Card"],
        ["您花了", "4,766.92", "SGD"],
      );
      const parsed = recognitionSelectionSchema.parse({
        accounts: [
          {
            nameBlocks: [0],
            balances: [{ amountBlock: 2, currencyBlock: 3, isDebt: true }],
          },
        ],
      });

      expect(resolveRecognition(blocks, parsed).accounts[0]?.balances).toEqual([
        { currency: "SGD", balance: -4766.92 },
      ]);
    });

    // Idempotent, so a card that prints the sign AND carries a debt label does
    // not come out positive again.
    it("leaves an already-negative figure negative", () => {
      const blocks = blocksOf(["HSBC Live+"], ["-1,745.52SGD"]);
      const parsed = recognitionSelectionSchema.parse({
        accounts: [
          { nameBlocks: [0], balances: [{ amountBlock: 1, isDebt: true }] },
        ],
      });

      expect(resolveRecognition(blocks, parsed).accounts[0]?.balances).toEqual([
        { currency: "SGD", balance: -1745.52 },
      ]);
    });

    it("leaves a balance alone when nothing says it is a debt", () => {
      const blocks = blocksOf(["360 Account"], ["6,672.59", "SGD"]);
      const parsed = recognitionSelectionSchema.parse({
        accounts: [
          {
            nameBlocks: [0],
            balances: [{ amountBlock: 1, currencyBlock: 2 }],
          },
        ],
      });

      expect(
        resolveRecognition(blocks, parsed).accounts[0]?.balances?.[0]?.balance,
      ).toBe(6672.59);
    });

    // Zero owed is zero either way; negating it must not produce -0, which
    // serializes as "-0" and reads as a bug.
    it("keeps a settled card at zero rather than negative zero", () => {
      const blocks = blocksOf(["Settled card"], ["0.00", "SGD"]);
      const parsed = recognitionSelectionSchema.parse({
        accounts: [
          {
            nameBlocks: [0],
            balances: [{ amountBlock: 1, currencyBlock: 2, isDebt: true }],
          },
        ],
      });

      expect(
        Object.is(
          resolveRecognition(blocks, parsed).accounts[0]?.balances?.[0]
            ?.balance,
          0,
        ),
      ).toBe(true);
    });
  });

  // A generic tail-four rule reads "012-394-2-033676-3" as 6763, while a person
  // reads it as 3676 — the trailing digit is a check digit. The per-institution
  // rule that knew this is gone with the rest of the config, so the model may
  // state the four digits instead. It still cannot invent them: they have to
  // appear in the block it pointed at.
  describe("an account number with a check digit", () => {
    const blocks = blocksOf(["储蓄"], ["012-394-2-033676-3"]);

    it("takes the digits the model named", () => {
      const parsed = recognitionSelectionSchema.parse({
        accounts: [{ nameBlocks: [0], lastFourBlock: 1, lastFour: "3676" }],
      });

      expect(
        resolveRecognition(blocks, parsed).accounts[0]?.accountLastFourDigits,
      ).toBe("3676");
    });

    // The provenance rule, applied to the one field where the model may state a
    // value: four digits that are not in the block are four digits it made up.
    it("refuses digits that are not in the block", () => {
      const parsed = recognitionSelectionSchema.parse({
        accounts: [{ nameBlocks: [0], lastFourBlock: 1, lastFour: "9999" }],
      });

      expect(
        resolveRecognition(blocks, parsed).accounts[0]?.accountLastFourDigits,
      ).toBeUndefined();
    });

    it("falls back to the tail when the model names nothing", () => {
      const parsed = recognitionSelectionSchema.parse({
        accounts: [{ nameBlocks: [0], lastFourBlock: 1 }],
      });

      expect(
        resolveRecognition(blocks, parsed).accounts[0]?.accountLastFourDigits,
      ).toBe("6763");
    });

    it("rejects a stated last four that is not four digits", () => {
      expect(
        recognitionSelectionSchema.safeParse({
          accounts: [{ lastFourBlock: 1, lastFour: "36" }],
        }).success,
      ).toBe(false);
    });
  });

  describe("accounts with nothing left", () => {
    // An account that lost every field is not an account the user can fix — it
    // is an empty row in the draft, which reads as a recognition failure the
    // person then has to delete by hand.
    it("drops an account whose every field failed", () => {
      const parsed = recognitionSelectionSchema.parse({
        accounts: [{ nameBlocks: [99], balances: [{ amountBlock: 99 }] }],
      });

      expect(resolveRecognition(SCREEN, parsed).accounts).toEqual([]);
    });

    it("keeps an account that still has a name", () => {
      const parsed = recognitionSelectionSchema.parse({
        accounts: [{ nameBlocks: [0, 1], balances: [{ amountBlock: 99 }] }],
      });

      expect(resolveRecognition(SCREEN, parsed).accounts).toHaveLength(1);
    });

    it("keeps the accounts that survived beside the ones that did not", () => {
      const parsed = recognitionSelectionSchema.parse({
        accounts: [{ nameBlocks: [99] }, { nameBlocks: [0, 1] }],
      });

      expect(
        resolveRecognition(SCREEN, parsed).accounts.map((a) => a.accountName),
      ).toEqual(["360 Account"]);
    });
  });

  describe("the institution", () => {
    // Free text, deliberately: the name is printed on the screen — or inferable
    // from a product name — and requiring it to pre-exist in an i18n catalog is
    // exactly the coupling this redesign removes. It touches no figure, so a
    // wrong one costs a correction rather than a wrong total.
    it("carries the name the model read", () => {
      const parsed = recognitionSelectionSchema.parse({
        accounts: [{ nameBlocks: [0] }],
        institution: { displayName: "OCBC" },
      });

      expect(resolveRecognition(SCREEN, parsed).institution).toEqual({
        displayName: "OCBC",
      });
    });

    // "China Merchants Bank or Wing Lung Bank" — the two share a product name,
    // and offering the choice beats leaving the field blank.
    it("carries the alternates when the model is unsure", () => {
      const parsed = recognitionSelectionSchema.parse({
        accounts: [{ nameBlocks: [0] }],
        institution: {
          displayName: "China Merchants Bank",
          alternates: ["Wing Lung Bank"],
        },
      });

      expect(
        resolveRecognition(SCREEN, parsed).institution?.alternates,
      ).toEqual(["Wing Lung Bank"]);
    });

    it("reports none when the model could not place the screen", () => {
      const parsed = recognitionSelectionSchema.parse({
        accounts: [{ nameBlocks: [0] }],
      });

      expect(resolveRecognition(SCREEN, parsed).institution).toBeUndefined();
    });
  });
});
