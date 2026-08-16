import { describe, expect, it } from "vitest";

import { classifyTokens, type TokenRole } from "./token-classify";
import { row, screen } from "../test-support/screen";

// Classifies one visual row's words. `screen(row(...))` gives the row real
// geometry, which matters because the merge step unions boxes.
function roles(...words: string[]): { text: string; role: TokenRole }[] {
  const line = screen(row(...words));
  return classifyTokens(line).map((t) => ({ text: t.text, role: t.role }));
}

// Where `classifyRow` gives a line ONE role, this gives every word its own — so
// a row carrying a name and a balance doesn't force the grouping step to split
// the line by string surgery.
describe("classifyTokens", () => {
  it("labels a name-and-balance row word by word", () => {
    expect(roles("360", "Account", "$5,000.00")).toEqual([
      // A digits-only token is NOT labeled `accountName` — see the contract
      // test below for why "360" still reaches the account's name.
      { text: "360", role: "unknown" },
      { text: "Account", role: "accountName" },
      { text: "$5,000.00", role: "amount" },
    ]);
  });

  // The one cross-module contract in this file. `unknown` is not "discarded" —
  // the grouping step collects `accountName` AND `unknown` tokens when building
  // a name, which is what carries a digits-only identifier like the "360" of
  // "360 Account" into the recognized name. Narrowing that filter, or making
  // `unknown` mean "drop", silently truncates every such name.
  it("leaves a name's digit token as unknown, which grouping still collects", () => {
    expect(roles("360", "Account").map((t) => t.role)).toEqual([
      "unknown",
      "accountName",
    ]);
  });

  it("labels a standalone currency code", () => {
    const [currency, amount] = classifyTokens(screen(row("SGD", "6,672.59")));
    expect(currency).toMatchObject({ role: "currency", currency: "SGD" });
    expect(amount).toMatchObject({ role: "amount", amount: 6672.59 });
  });

  it("carries the currency fused into an amount token", () => {
    const [token] = classifyTokens(screen(row("$5,000.00")));
    expect(token).toMatchObject({
      role: "amount",
      amount: 5000,
      currency: "USD",
    });
  });

  it.each([
    ["••••", "cardNumber"],
    ["4218-0803-2297-3829", "cardNumber"],
    ["275-023637-2", "cardNumber"],
    ["08/26", "date"],
    [">", "navArrow"],
    ["›", "navArrow"],
    ["Total", "summaryMarker"],
    ["总资产", "summaryMarker"],
    ["Balance", "label"],
    ["余额", "label"],
    ["首页", "noise"],
    ["ЛКР", "noise"],
    ["Savings", "accountName"],
  ])("%s → %s", (text, role) => {
    expect(roles(text)[0]).toMatchObject({ role });
  });

  it("leaves a bare digit run unknown so it can't name an account", () => {
    // Digits without a keyword are inert to the grouping step.
    expect(roles("12345")[0].role).toBe("unknown");
  });

  it("leaves a standalone Chinese token unknown rather than naming an account", () => {
    // On Chinese UIs the account name is nearly always an English product name;
    // stray Chinese tokens are headers, so they must not open an account.
    expect(roles("持仓市值")[0].role).not.toBe("accountName");
  });

  // ML Kit splits wide rows mid-number. Merging is what turns "6," + "672.59"
  // back into one balance instead of two junk tokens.
  describe("merging OCR splits", () => {
    it("joins an amount split across blocks", () => {
      const tokens = classifyTokens(screen(row("6,", "672.59")));
      expect(tokens).toHaveLength(1);
      expect(tokens[0]).toMatchObject({ role: "amount", amount: 6672.59 });
    });

    it("unions the boxes of merged fragments", () => {
      const line = screen(row("6,", "672.59"));
      const [merged] = classifyTokens(line);
      const left = line[0].normalizedBox;
      const right = line[1].normalizedBox;
      expect(merged.box.x).toBeCloseTo(left.x, 5);
      expect(merged.box.x + merged.box.width).toBeCloseTo(
        right.x + right.width,
        5,
      );
    });

    it("joins adjacent label words", () => {
      const tokens = classifyTokens(screen(row("Available", "Balance")));
      expect(tokens).toHaveLength(1);
      expect(tokens[0]).toMatchObject({
        role: "label",
        text: "Available Balance",
      });
    });

    it("does not merge two already-complete amounts", () => {
      // A multi-currency value row is several whole amounts side by side; the
      // merge must not fuse them into one number.
      const tokens = classifyTokens(screen(row("1,000.00", "2,000.00")));
      expect(tokens).toHaveLength(2);
      expect(tokens.map((t) => t.amount)).toEqual([1000, 2000]);
    });

    it("does not merge account-name words", () => {
      // Keeping them separate is what lets the grouping step strip a leading
      // icon tag.
      const tokens = classifyTokens(screen(row("360", "360", "Account")));
      expect(tokens).toHaveLength(3);
    });
  });

  it("keeps a 0-based index per token for the trace", () => {
    const tokens = classifyTokens(screen(row("360", "Account", "$5,000.00")));
    expect(tokens.map((t) => t.index)).toEqual([0, 1, 2]);
  });
});

describe("nav tokens match the whole token, on a row that names nothing", () => {
  it("does not call 投资理财 noise because it contains 投资", () => {
    // Substring matching here repeated the mistake `vocabulary.ts` records from
    // the row-level check: the row lost its name, and with it its asset kind.
    expect(roles("投资理财")[0].role).not.toBe("noise");
  });

  it("still calls a standalone 投资 noise", () => {
    expect(roles("投资")[0].role).toBe("noise");
  });

  it("keeps a nav word that is part of a named account", () => {
    // "home" is a nav label, but this row names an account, so its words are
    // name words — "Home Loan" was losing its first token.
    expect(roles("Home", "Loan")).toEqual([
      { text: "Home", role: "accountName" },
      { text: "Loan", role: "accountName" },
    ]);
  });
});
