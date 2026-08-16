import { describe, expect, it } from "vitest";

import { cleanAccountName } from "./account-grouping";
import { buildAccountKeywordRegex, rowTitlesAnAccount } from "./vocabulary";
import type { TokenWithRole } from "./token-classify";

const KEYWORDS = buildAccountKeywordRegex();

function nameTokens(...texts: string[]): TokenWithRole[] {
  return texts.map((text, index) => ({
    text,
    role: "accountName",
    box: { x: 0.05 + index * 0.1, y: 0.1, width: 0.09, height: 0.03 },
    index,
  }));
}

// The icon-tag strip is the rule most likely to eat a real name if it gets
// greedy: institution overviews render a circular icon whose label OCRs as a
// word right before the account name.
describe("cleanAccountName", () => {
  it("joins name tokens in order", () => {
    expect(
      cleanAccountName(
        nameTokens("Statement", "Savings", "Account"),
        KEYWORDS,
        [],
      ),
    ).toBe("Statement Savings Account");
  });

  it("returns empty for no tokens", () => {
    expect(cleanAccountName([], KEYWORDS, [])).toBe("");
  });

  describe("icon-tag stripping", () => {
    it("drops a leading icon tag when the rest is already a full name", () => {
      expect(
        cleanAccountName(
          nameTokens("GSA", "Global", "Savings", "Account"),
          KEYWORDS,
          ["360", "gsa", "sts"],
        ),
      ).toBe("Global Savings Account");
    });

    it("drops a leading token that repeats the next one", () => {
      // "360 360 Account" is the icon "360" plus the real name "360 Account".
      expect(
        cleanAccountName(nameTokens("360", "360", "Account"), KEYWORDS, [
          "360",
        ]),
      ).toBe("360 Account");
    });

    it("keeps a two-token name intact", () => {
      // "360 Account" must NOT lose its "360" — that's the identifier that
      // distinguishes it from every other "<X> Account".
      expect(
        cleanAccountName(nameTokens("360", "Account"), KEYWORDS, ["360"]),
      ).toBe("360 Account");
    });

    it("keeps a single-token name intact", () => {
      expect(cleanAccountName(nameTokens("Savings"), KEYWORDS, ["360"])).toBe(
        "Savings",
      );
    });

    it("does not strip a leading token that isn't an icon tag", () => {
      expect(
        cleanAccountName(
          nameTokens("Everyday", "Global", "Account"),
          KEYWORDS,
          ["360"],
        ),
      ).toBe("Everyday Global Account");
    });

    it("does not strip an icon tag when the rest isn't a full name", () => {
      // Without an account keyword in the rest, the leading token may well be
      // the name itself.
      expect(
        cleanAccountName(nameTokens("360", "Premium", "Tier"), KEYWORDS, [
          "360",
        ]),
      ).toBe("360 Premium Tier");
    });
  });

  it("matches icon tags case-insensitively", () => {
    expect(
      cleanAccountName(
        nameTokens("gsa", "Global", "Savings", "Account"),
        KEYWORDS,
        ["GSA"],
      ),
    ).toBe("Global Savings Account");
  });
});

describe("buildAccountKeywordRegex", () => {
  it("matches the shared account words", () => {
    expect(KEYWORDS.test("Savings Account")).toBe(true);
    expect(KEYWORDS.test("Credit Card")).toBe(true);
    expect(KEYWORDS.test("22:28")).toBe(false);
  });

  it("adds the institution's own product words", () => {
    const dbs = buildAccountKeywordRegex(["multiplier"]);
    expect(dbs.test("Multiplier")).toBe(true);
    // The shared defaults don't know that word on their own.
    expect(KEYWORDS.test("Multiplier")).toBe(false);
  });
});

// Word boundaries, and the trade-off they carry — see `boundedPatternSource`.
describe("account keyword boundaries", () => {
  it.each(["refund policy", "mastercard promotions"])(
    "%s titles no account",
    (text) => {
      // A disclaimer must not open an account and take the figure beside it.
      expect(rowTitlesAnAccount(text)).toBe(false);
    },
  );

  it.each(["accounts cards transfers", "home transactions cards rewards"])(
    "%s is scaffolding, not a title",
    (text) => {
      // A navigation bar. This is the half of the boundary rule that is easy to
      // lose: allowing a plural made every one of these a title, which deleted
      // the account whose balance sat below it.
      expect(rowTitlesAnAccount(text)).toBe(false);
    },
  );

  it("misses a plural title, knowingly", () => {
    // The cost of the rule above. Documented rather than fixed: separating "My
    // Cards" from the "Cards" tab needs the qualifier, which this vocabulary
    // does not carry.
    expect(rowTitlesAnAccount("structured deposits")).toBe(false);
    expect(rowTitlesAnAccount("structured deposit")).toBe(true);
  });
});
