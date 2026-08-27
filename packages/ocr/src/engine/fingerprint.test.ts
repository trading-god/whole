import { describe, expect, it } from "vitest";

import { row, screen } from "../test-support/screen";
import {
  LAYOUT_MATCH_THRESHOLD,
  fingerprintSimilarity,
  layoutFingerprint,
} from "./fingerprint";

const fingerprintOf = (...lines: string[][]) =>
  layoutFingerprint(screen(...lines.map((line) => row(...line))));

// Close to the real screen rather than a toy: an overview carries a nav bar, a
// tab strip and several account cards, and the similarity below only means
// something against that many labels. Four tokens would make any extra cell
// look like a different page.
const OCBC_OVERVIEW_ROWS: string[][] = [
  ["退出"],
  ["贷款", "银行卡", "账户", "保险", "投资"],
  ["360", "Account"],
  ["624-680187-001"],
  ["可用余额", "6,672.59", "SGD"],
  ["借记卡", "4218-0803-2297-3829"],
  ["Global", "Savings", "Account", "GSA"],
  ["517-345377-201"],
  ["等值新币", "2,009.85", "SGD"],
  ["首页", "计划", "转账与付款", "奖励积点", "更多"],
];

const OCBC_OVERVIEW = () => fingerprintOf(...OCBC_OVERVIEW_ROWS);

describe("layoutFingerprint", () => {
  // The definition of "same layout": the same app on the same page keeps its
  // labels, and only the amounts move. Blanking the digits is what turns a
  // screen into the page it came from.
  it("is unchanged when only the figures move", () => {
    const before = OCBC_OVERVIEW();
    const after = fingerprintOf(
      ...OCBC_OVERVIEW_ROWS.map((line) =>
        line.map((text) => (text === "6,672.59" ? "7,104.20" : text)),
      ),
    );

    expect(after.hash).toBe(before.hash);
  });

  it("differs between two different pages", () => {
    const ocbc = OCBC_OVERVIEW();
    const cmb = fingerprintOf(["账户总览"], ["活钱", "76,007.05"]);

    expect(cmb.hash).not.toBe(ocbc.hash);
  });

  // Same screen, same answer — otherwise the template cache would miss on
  // every second capture of a screen that had not changed at all.
  it("is stable across two reads of the same screen", () => {
    expect(OCBC_OVERVIEW().hash).toBe(OCBC_OVERVIEW().hash);
  });

  it("is a non-empty string", () => {
    expect(OCBC_OVERVIEW().hash).toMatch(/^[0-9a-z]+$/);
  });

  it("keeps the skeleton tokens for a near match", () => {
    expect(OCBC_OVERVIEW().tokens).toContain("account");
  });

  // Case and spacing are OCR noise, not layout.
  it("ignores case and surrounding whitespace", () => {
    expect(fingerprintOf(["  Account  "]).hash).toBe(
      fingerprintOf(["ACCOUNT"]).hash,
    );
  });

  it("fingerprints an empty screen without failing", () => {
    expect(layoutFingerprint([]).tokens).toEqual([]);
  });
});

describe("fingerprintSimilarity", () => {
  it("is 1 for the same layout", () => {
    expect(fingerprintSimilarity(OCBC_OVERVIEW(), OCBC_OVERVIEW())).toBe(1);
  });

  it("is 0 for two layouts with nothing in common", () => {
    expect(
      fingerprintSimilarity(OCBC_OVERVIEW(), fingerprintOf(["总资产估值"])),
    ).toBe(0);
  });

  // An exact hash alone would be too brittle to be worth having: a promotional
  // banner or a notification badge appears on one capture and not the next, and
  // the layout is still the same page. The similarity is what survives that.
  it("stays above the threshold when a banner appears on one capture", () => {
    const withoutBanner = OCBC_OVERVIEW();
    const withBanner = fingerprintOf(
      ["Earn", "1.6%", "p.a."],
      ...OCBC_OVERVIEW_ROWS,
    );

    expect(fingerprintSimilarity(withBanner, withoutBanner)).toBeGreaterThan(
      LAYOUT_MATCH_THRESHOLD,
    );
  });

  it("falls below the threshold for a different page of the same app", () => {
    const overview = OCBC_OVERVIEW();
    const card = fingerprintOf(
      ["退出"],
      ["OCBC", "365", "Credit", "Card", "VISA"],
      ["4524-1920-1166-4269"],
      ["您花了", "4,766.92", "SGD"],
      ["账单", "24", "Aug到期", "3,580.91", "SGD"],
      ["信用额度", "24,033.08", "of", "28,800.00", "SGD"],
      ["信用卡分期付", "现金分期", "立即申请"],
    );

    expect(fingerprintSimilarity(card, overview)).toBeLessThan(
      LAYOUT_MATCH_THRESHOLD,
    );
  });

  it("is symmetric", () => {
    const a = OCBC_OVERVIEW();
    const b = fingerprintOf(["账户总览"], ["活钱", "76,007.05"]);

    expect(fingerprintSimilarity(a, b)).toBe(fingerprintSimilarity(b, a));
  });

  // Two empty screens are not "the same layout"; there is nothing to be the
  // same about, and reporting a perfect match would let an empty capture hit
  // whatever template happened to be stored.
  it("is 0 when either side has no skeleton at all", () => {
    const empty = layoutFingerprint([]);

    expect(fingerprintSimilarity(empty, OCBC_OVERVIEW())).toBe(0);
    expect(fingerprintSimilarity(empty, empty)).toBe(0);
  });
});
