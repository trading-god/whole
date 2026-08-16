import { type RecognizedAccount } from "@whole/ocr";
import { describe, expect, it } from "vitest";

import {
  type AccountDraft,
  applyRecognizedToDrafts,
  draftHasContent,
  draftToValidAccount,
  isWorthDrafting,
  mergeRecognizedIntoDraft,
  recognizedToDraft,
  selectRecognizedForAccount,
} from "@/features/assets/account-draft";
import { createBalanceRow } from "@/features/assets/balance-rows";

// Every case below is a bug this module's comments record having shipped once.
// The rules are subtle enough that the comments were, until now, the only thing
// holding them in place: a zero balance means opposite things depending on what
// sits beside it, and getting it backwards either hid a settled credit card or
// filled the form with an overview's empty sub-accounts.

function draft(overrides: Partial<AccountDraft> = {}): AccountDraft {
  return {
    name: "",
    lastFour: "",
    balances: [createBalanceRow("SGD")],
    kind: "cash",
    ...overrides,
  };
}

function filledDraft(): AccountDraft {
  return draft({
    name: "Savings",
    balances: [createBalanceRow("SGD", "1000")],
  });
}

describe("mergeRecognizedIntoDraft — what a zero balance means", () => {
  it("keeps a lone zero: a settled card is still the user's card", () => {
    // Dropping this row left a draft `draftToValidAccount` rejects, and one
    // such card blocked Save for every other account on the same screenshot.
    const recognized: RecognizedAccount = {
      accountName: "Platinum Card",
      balances: [{ currency: "SGD", balance: 0 }],
    };

    const merged = mergeRecognizedIntoDraft(draft(), recognized);

    expect(merged.balances).toHaveLength(1);
    expect(merged.balances[0]).toMatchObject({ currency: "SGD", balance: "0" });
  });

  it("drops zeros sitting beside real money: an overview's empty sub-accounts", () => {
    // A DBS Multiplier holds SGD 100,554.59 + HKD 0.00 + USD 0.00. The form
    // should open on the one balance that exists, not three rows.
    const recognized: RecognizedAccount = {
      accountName: "Multiplier",
      balances: [
        { currency: "SGD", balance: 100554.59 },
        { currency: "HKD", balance: 0 },
        { currency: "USD", balance: 0 },
      ],
    };

    const merged = mergeRecognizedIntoDraft(draft(), recognized);

    expect(merged.balances.map((row) => row.currency)).toEqual(["SGD"]);
  });

  it("keeps a zero in a currency the draft already tracks: the screenshot is correcting it", () => {
    // Hiding this left the stale figure in place — the user re-uploaded a
    // screenshot precisely because the balance had changed to zero.
    const existing = draft({
      name: "Multiplier",
      balances: [createBalanceRow("SGD", "100"), createBalanceRow("HKD", "50")],
    });
    const recognized: RecognizedAccount = {
      balances: [
        { currency: "SGD", balance: 100554.59 },
        { currency: "HKD", balance: 0 },
      ],
    };

    const merged = mergeRecognizedIntoDraft(existing, recognized);

    expect(merged.balances.map((row) => row.currency)).toEqual(["SGD", "HKD"]);
    expect(merged.balances[1].balance).toBe("0");
  });

  it("reads the row's VALUE, not just its currency, when deciding 'already tracks'", () => {
    // The blank seed row is a placeholder. Counting it made a US-locale seed
    // (an empty USD row) keep an overview's USD 0.00 sub-account while an
    // SG-locale seed dropped it — the same screenshot, two different forms.
    const usLocaleSeed = draft({ balances: [createBalanceRow("USD")] });
    const recognized: RecognizedAccount = {
      balances: [
        { currency: "SGD", balance: 100554.59 },
        { currency: "USD", balance: 0 },
      ],
    };

    const merged = mergeRecognizedIntoDraft(usLocaleSeed, recognized);

    expect(merged.balances.map((row) => row.currency)).toEqual(["SGD"]);
  });

  it("adopts an all-zero recognition rather than filtering it away to nothing", () => {
    // The filter is skipped entirely when nothing is non-zero, so these rows
    // survive and replace the draft's — the screenshot is the authority on a
    // balance that is now zero. What must NOT happen is the row list coming
    // back empty: gated on what was recognized rather than on what survives the
    // filter, an all-zero recognition passed the length check and assigned the
    // empty result, so `BalanceRowsField` rendered nothing at all and Save
    // stayed grey until the user found "add currency".
    const existing = draft({
      name: "Savings",
      balances: [createBalanceRow("SGD", "1000")],
    });
    const recognized: RecognizedAccount = {
      balances: [
        { currency: "HKD", balance: 0 },
        { currency: "USD", balance: 0 },
      ],
    };

    const merged = mergeRecognizedIntoDraft(existing, recognized);

    expect(merged.balances.map((row) => row.currency)).toEqual(["HKD", "USD"]);
    expect(merged.balances.every((row) => row.balance === "0")).toBe(true);
  });

  it("keeps the draft's rows when the recognition carries no balances at all", () => {
    // The only path that yields an empty row list, and the reason the fallback
    // exists: a recognition that names an account but reads no figure off it
    // must not blank the rows the user already has.
    const existing = draft({
      name: "Savings",
      balances: [createBalanceRow("SGD", "1000")],
    });

    expect(
      mergeRecognizedIntoDraft(existing, { accountName: "Renamed" }).balances,
    ).toEqual(existing.balances);
    expect(
      mergeRecognizedIntoDraft(existing, { balances: [] }).balances,
    ).toEqual(existing.balances);
  });
});

describe("mergeRecognizedIntoDraft — partial recognition", () => {
  it("leaves fields the recognizer did not return untouched", () => {
    const existing = draft({
      name: "My Savings",
      lastFour: "1234",
      kind: "investment",
      balances: [createBalanceRow("SGD", "1000")],
    });

    const merged = mergeRecognizedIntoDraft(existing, {
      balances: [{ currency: "SGD", balance: 2000 }],
    });

    expect(merged.name).toBe("My Savings");
    expect(merged.lastFour).toBe("1234");
    expect(merged.kind).toBe("investment");
    expect(merged.balances[0].balance).toBe("2000");
  });
});

describe("recognizedToDraft", () => {
  it("seeds a blank draft from an empty recognition", () => {
    const seeded = recognizedToDraft({}, "SGD");

    expect(seeded).toMatchObject({ name: "", lastFour: "", kind: "cash" });
    expect(seeded.balances).toHaveLength(1);
    expect(seeded.balances[0]).toMatchObject({ currency: "SGD", balance: "" });
  });

  it("keeps a settled card's lone zero when seeding", () => {
    // The seed row carries no value, so it holds no currency and cannot make
    // the merge keep a zero the ADD path should drop. Pre-filtering here broke
    // exactly this case.
    const seeded = recognizedToDraft(
      { accountName: "Card", balances: [{ currency: "SGD", balance: 0 }] },
      "SGD",
    );

    expect(seeded.balances).toHaveLength(1);
    expect(seeded.balances[0].balance).toBe("0");
  });
});

describe("draftToValidAccount", () => {
  it("accepts a negative balance — a credit card's debt has to survive to storage", () => {
    // The form's input schema once carried `.nonnegative()`, so a correctly
    // recognized -4,766.92 was silently dropped on the way to storage and net
    // worth counted the debt as nothing.
    const account = draftToValidAccount(
      draft({ name: "Card", balances: [createBalanceRow("SGD", "-4766.92")] }),
    );

    expect(account?.balances).toEqual([{ currency: "SGD", balance: -4766.92 }]);
  });

  it("accepts a zero balance", () => {
    const account = draftToValidAccount(
      draft({ name: "Card", balances: [createBalanceRow("SGD", "0")] }),
    );

    expect(account?.balances).toEqual([{ currency: "SGD", balance: 0 }]);
  });

  it("refuses the whole save when a row holds text that is not a balance", () => {
    // Dropping just that row saved the account with the OTHER currency only,
    // and the holding disappeared without a word.
    const rejected = draftToValidAccount(
      draft({
        name: "Savings",
        balances: [
          createBalanceRow("SGD", "100"),
          createBalanceRow("USD", "S$100"),
        ],
      }),
    );

    expect(rejected).toBeNull();
  });

  it("refuses a duplicated currency", () => {
    expect(
      draftToValidAccount(
        draft({
          name: "Savings",
          balances: [
            createBalanceRow("SGD", "100"),
            createBalanceRow("SGD", "200"),
          ],
        }),
      ),
    ).toBeNull();
  });

  it("allows a blank duplicate row — it is not a duplicate yet", () => {
    expect(
      draftToValidAccount(
        draft({
          name: "Savings",
          balances: [createBalanceRow("SGD", "100"), createBalanceRow("SGD")],
        }),
      ),
    ).not.toBeNull();
  });

  it("refuses a blank name and trims the one it accepts", () => {
    expect(draftToValidAccount(draft({ name: "   " }))).toBeNull();
    expect(
      draftToValidAccount(
        draft({
          name: "  Savings  ",
          balances: [createBalanceRow("SGD", "1")],
        }),
      )?.name,
    ).toBe("Savings");
  });

  it("stores no last four rather than an empty string", () => {
    const account = draftToValidAccount(
      draft({ name: "Savings", balances: [createBalanceRow("SGD", "1")] }),
    );

    expect(account?.accountLastFourDigits).toBeUndefined();
  });

  it("refuses a last four that is not exactly four digits", () => {
    expect(
      draftToValidAccount(
        draft({
          name: "Savings",
          lastFour: "12",
          balances: [createBalanceRow("SGD", "1")],
        }),
      ),
    ).toBeNull();
  });

  it("refuses a draft with no balance at all", () => {
    expect(draftToValidAccount(draft({ name: "Savings" }))).toBeNull();
  });
});

describe("selectRecognizedForAccount — hijack protection", () => {
  const savings: RecognizedAccount = {
    accountName: "Savings",
    accountLastFourDigits: "1111",
    balances: [{ currency: "SGD", balance: 100 }],
  };
  const current: RecognizedAccount = {
    accountName: "Current",
    accountLastFourDigits: "2222",
    balances: [{ currency: "SGD", balance: 200 }],
  };

  it("trusts a lone result as-is", () => {
    expect(selectRecognizedForAccount([savings], undefined)).toBe(savings);
  });

  it("requires a last-four match among several candidates", () => {
    expect(selectRecognizedForAccount([savings, current], "2222")).toBe(
      current,
    );
    expect(
      selectRecognizedForAccount([savings, current], "9999"),
    ).toBeUndefined();
    expect(
      selectRecognizedForAccount([savings, current], undefined),
    ).toBeUndefined();
  });

  it("counts the recognition, not what survives the filter", () => {
    // Filtering first turned a two-account screenshot whose second row was junk
    // into a "lone result", and the edit screen then applied the OTHER
    // account's name and balances to the account being edited.
    const junk: RecognizedAccount = {
      balances: [{ currency: "SGD", balance: 0 }],
    };

    expect(
      selectRecognizedForAccount([savings, junk], undefined),
    ).toBeUndefined();
  });
});

describe("isWorthDrafting", () => {
  it("keeps an account the screen names, whatever its figures say", () => {
    expect(
      isWorthDrafting({
        accountName: "Card",
        balances: [{ currency: "SGD", balance: 0 }],
      }),
    ).toBe(true);
    expect(isWorthDrafting({ accountLastFourDigits: "1234" })).toBe(true);
  });

  it("drops a row with no identity and no money", () => {
    expect(
      isWorthDrafting({ balances: [{ currency: "SGD", balance: 0 }] }),
    ).toBe(false);
    expect(isWorthDrafting({})).toBe(false);
  });
});

describe("applyRecognizedToDrafts", () => {
  it("seeds one draft per account when several are recognized", () => {
    const drafts = applyRecognizedToDrafts(
      [draft()],
      [
        { accountName: "A", balances: [{ currency: "SGD", balance: 1 }] },
        { accountName: "B", balances: [{ currency: "SGD", balance: 2 }] },
      ],
      "SGD",
    );

    expect(drafts.map((entry) => entry.name)).toEqual(["A", "B"]);
  });

  it("reseeds through the zero filter when the single draft is still blank", () => {
    // Includes the FIRST upload, where the screen's one draft is the blank
    // seed: a one-account overview otherwise opened with a row per empty
    // sub-account.
    const drafts = applyRecognizedToDrafts(
      [draft()],
      [
        {
          accountName: "Multiplier",
          balances: [
            { currency: "SGD", balance: 100554.59 },
            { currency: "HKD", balance: 0 },
          ],
        },
      ],
      "SGD",
    );

    expect(drafts[0].balances.map((row) => row.currency)).toEqual(["SGD"]);
  });

  it("merges into a draft the user has filled in", () => {
    const drafts = applyRecognizedToDrafts(
      [filledDraft()],
      [{ accountLastFourDigits: "4321" }],
      "SGD",
    );

    expect(drafts[0].name).toBe("Savings");
    expect(drafts[0].lastFour).toBe("4321");
  });
});

describe("draftHasContent", () => {
  it("is false for a freshly seeded draft", () => {
    expect(draftHasContent(draft())).toBe(false);
  });

  it("is true once any field carries something", () => {
    expect(draftHasContent(draft({ name: "A" }))).toBe(true);
    expect(draftHasContent(draft({ lastFour: "1234" }))).toBe(true);
    expect(
      draftHasContent(draft({ balances: [createBalanceRow("SGD", "1")] })),
    ).toBe(true);
  });
});
