import { describe, expect, it } from "vitest";

import { matchAmount } from "./amount";
import {
  classifyRow,
  hasSummaryMarker,
  isAccountNumber,
  isCurrencyNameLabel,
} from "./line-classify";
import { hasLabelMarker } from "./vocabulary";

// Row roles drive grouping: an account name opens a new account, a summary row
// closes one, noise is dropped. A row promoted to `accountName` by mistake
// invents an account; one demoted to `noise` loses a real one.
describe("classifyRow", () => {
  it.each([
    ["360 Account", "accountName"],
    ["Statement Savings Account", "accountName"],
    ["DBS Multiplier", "accountName"],
    ["Everyday Global Account", "accountName"],
  ])("%s → %s", (text, role) => {
    expect(classifyRow(text)).toBe(role);
  });

  it.each([
    ["1,234.56", "amountRow"],
    ["SGD 6,672.59", "amountRow"],
    ["0.00", "amountRow"],
    // A label with no number is still a label, not a name — grouping must not
    // open an account for it.
    ["Available Balance", "amountRow"],
    ["可用余额", "amountRow"],
  ])("%s → %s", (text, role) => {
    expect(classifyRow(text)).toBe(role);
  });

  it.each([
    ["**** 1234", "cardNumber"],
    ["•••• •••• ••••", "cardNumber"],
    ["4218 0803 2297 3829", "cardNumber"],
    // A hyphen-joined SG account number is not money and not a name.
    ["275-023637-2", "cardNumber"],
  ])("%s → %s", (text, role) => {
    expect(classifyRow(text)).toBe(role);
  });

  it.each([
    ["Total", "summaryRow"],
    ["Net Worth", "summaryRow"],
    ["总资产", "summaryRow"],
    ["资产总额", "summaryRow"],
  ])("%s → %s", (text, role) => {
    expect(classifyRow(text)).toBe(role);
  });

  describe("noise", () => {
    it.each([
      // Standalone nav labels.
      ["home", "noise"],
      ["settings", "noise"],
      ["首页", "noise"],
      ["退出", "noise"],
      // OCR gibberish from the status bar / app icons.
      ["ЛКР EITE", "noise"],
      ["iR₩", "noise"],
      ["22:28 A 5G E", "noise"],
    ])("%s → %s", (text, role) => {
      expect(classifyRow(text)).toBe(role);
    });

    it("does not drop a real name that carries a glyph", () => {
      // The account-keyword guard is what protects a real name from the
      // morphological-noise rules.
      expect(classifyRow("€ Savings Account")).not.toBe("noise");
    });

    it("keeps a ¥ row on the amount path", () => {
      // ¥ is the CNY symbol this app recognizes, unlike the ₩/₺ icon glyphs.
      expect(classifyRow("¥ 10,640.40")).toBe("amountRow");
    });
  });

  // "Total" must never look like an account, even though it has no digits and
  // would otherwise fall through to accountName.
  it("checks summary before anything else", () => {
    expect(classifyRow("Total Balance")).toBe("summaryRow");
  });

  it("reads ordinary large amounts as money", () => {
    expect(classifyRow("1,234,567.89")).toBe("amountRow");
    // 10 digits is the ceiling the amount path allows.
    expect(classifyRow("12,345,678.90")).toBe("amountRow");
  });

  // The amount ceiling applies to the longest single run of digits, not to
  // every digit on the row. That distinction is what lets a row carrying
  // several figures still read as money: IBKR's "63,714 -327 -0.51%" totals
  // eleven digits but its largest run is three.
  describe("the amount ceiling counts one figure, not the whole row", () => {
    it("reads a row of several small figures as money", () => {
      expect(classifyRow("63,714 -327 -0.51%")).toBe("amountRow");
    });

    it("reads a separated figure above ten digits as money", () => {
      expect(classifyRow("123,456,789,012.34")).toBe("amountRow");
    });

    // KNOWN LIMITATION, pinned rather than asserted as correct. Without
    // separators the digits form one 12-digit run, which is card morphology, so
    // the card check claims the row and its tail four would become the
    // account's last four. Only reachable above ~10 billion with no thousands
    // separators, which no real account screen prints.
    it("still treats an unseparated 14-digit figure as a card number", () => {
      expect(matchAmount("123456789012.34").ok).toBe(true);
      expect(classifyRow("123456789012.34")).toBe("cardNumber");
    });
  });
});

describe("isCurrencyNameLabel", () => {
  it.each(["chinese yuan", "united states dollar", "singapore dollar"])(
    "%s is a currency label",
    (text) => {
      expect(isCurrencyNameLabel(text)).toBe(true);
    },
  );

  // A currency-name row is absorbed into the open account rather than opening a
  // new one — but a real account name containing a currency word must not be.
  it.each(["Dollar Savings Account", "US Dollar Account"])(
    "%s stays an account name",
    (text) => {
      expect(classifyRow(text)).toBe("accountName");
    },
  );
});

describe("isAccountNumber", () => {
  it.each([
    ["275-023637-2", true],
    ["517-345377-201", true],
    ["1,234.56", false],
    ["360", false],
  ])("%s → %s", (text, expected) => {
    expect(isAccountNumber(text)).toBe(expected);
  });
});

describe("marker helpers", () => {
  it("matches label markers in both scripts", () => {
    expect(hasLabelMarker("available balance")).toBe(true);
    expect(hasLabelMarker("可用余额")).toBe(true);
    expect(hasLabelMarker("360 account")).toBe(false);
    // 余额宝 is Alipay's fund, not a 余额 label — a product row that must stay
    // an account name.
    expect(hasLabelMarker("余额宝")).toBe(false);
  });

  it("matches summary markers in both scripts", () => {
    expect(hasSummaryMarker("total")).toBe(true);
    expect(hasSummaryMarker("总资产")).toBe(true);
  });

  it("does not fire 'sum' inside ordinary words", () => {
    // "sum" was removed from the marker list because it matched
    // "consumption"/"consumer" — pin that so it can't come back unnoticed.
    expect(hasSummaryMarker("consumption")).toBe(false);
    expect(hasSummaryMarker("consumer credit")).toBe(false);
  });
});

describe("currency-name labels need word boundaries", () => {
  it.each(["europe growth", "wonder plan"])(
    "%s is not a currency-name label",
    (text) => {
      // "euro" sits inside "Europe" and "won" inside "Wonder"; substring
      // matching classified these as amount rows, so they were absorbed into
      // the account above instead of opening their own.
      expect(classifyRow(text)).not.toBe("amountRow");
    },
  );

  it("still recognizes a real currency-name row", () => {
    expect(classifyRow("united states dollar")).toBe("amountRow");
  });
});
