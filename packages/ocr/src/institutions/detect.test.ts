import { describe, expect, it } from "vitest";

import { classifyTokens } from "../engine/token-classify";
import { row, screen } from "../test-support/screen";
import { detectInstitution, resolveInstitutionConfig } from "./detect";

// Detection runs on the labeled tokens of the whole screenshot, line by line,
// so build them the same way the parser does. One row unless a test needs more.
function tokensFor(...words: string[]) {
  return [classifyTokens(screen(row(...words)))];
}

// Detection picks which institution's rules the grouping step runs with. Get it
// wrong and an OCBC-specific rule fires on a DBS screenshot; that isolation is
// the whole point of the per-institution configs.
describe("detectInstitution", () => {
  it("detects from a standalone institution-name token", () => {
    expect(detectInstitution(tokensFor("OCBC"))).toBe("ocbc");
    expect(detectInstitution(tokensFor("DBS"))).toBe("dbs");
  });

  it("is case-insensitive on the name token", () => {
    expect(detectInstitution(tokensFor("ocbc"))).toBe("ocbc");
  });

  it("detects from a product name when the institution token is off screen", () => {
    // The header scrolls away but the product name stays.
    expect(detectInstitution(tokensFor("Multiplier", "Account"))).toBe("dbs");
    expect(detectInstitution(tokensFor("360", "Account"))).toBe("ocbc");
    expect(detectInstitution(tokensFor("Global", "Savings"))).toBe("ocbc");
  });

  it("prefers the institution-name token over a product name", () => {
    // A standalone "DBS" is unambiguous; a product word could in principle
    // appear on someone else's screen.
    expect(detectInstitution(tokensFor("DBS", "360", "Account"))).toBe("dbs");
  });

  it("falls back to unknown when nothing matches", () => {
    expect(detectInstitution(tokensFor("Savings", "Account"))).toBe("unknown");
    expect(detectInstitution([])).toBe("unknown");
  });

  it("does not guess from an account-number format two institutions share", () => {
    // OCBC and DBS both print the SG hyphen format, so it can't separate them —
    // guessing would be worse than falling back.
    expect(detectInstitution(tokensFor("275-023637-2"))).toBe("unknown");
  });

  describe("per-institution signals", () => {
    it.each([
      // Alipay never prints its own name on the overview (the wordmark is an
      // image), so its money-market fund carries detection.
      ["余额宝", "alipay"],
      ["中国建设银行", "ccb"],
      ["龙卡通", "ccb"],
      ["朝朝宝", "cmb"],
      // Neither HSBC entity can be told apart by name or account format — only
      // by its flagship product.
      ["汇丰One", "hsbchk"],
      ["Bitget", "bitget"],
      ["OKX", "okx"],
      // Trust Bank prints no "Trust" token; its Money Jar product does.
      ["储蓄罐", "trust"],
    ])("%s → %s", (token, institutionId) => {
      expect(detectInstitution(tokensFor(token))).toBe(institutionId);
    });

    it("detects HSBC Singapore by its flagship product", () => {
      expect(
        detectInstitution(tokensFor("Everyday", "Global", "Account")),
      ).toBe("hsbcsg");
    });

    it("detects IBKR by its portfolio vocabulary", () => {
      expect(detectInstitution(tokensFor("净清算价值"))).toBe("ibkr");
    });

    it.each([
      ["BOCHK", "012-394-2-033676-3", "bochk"],
      ["CMB Wing Lung all-in-one", "601-526-0984-7", "cmbwl"],
      ["CMB Wing Lung margin", "682-2-48564-2", "cmbwl"],
    ])("detects %s from its account-number shape", (_label, number, id) => {
      expect(detectInstitution(tokensFor(number))).toBe(id);
    });
  });

  // Each of these is a mistake the configs are shaped to avoid. They are the
  // reason the signals aren't the obvious ones.
  describe("does not confuse look-alike institutions", () => {
    it("keeps HSBC Hong Kong and Singapore apart", () => {
      // Both brands, both apps, and both account-number formats are identical,
      // so a shared "HSBC" name token would resolve to whichever is listed
      // first. Neither config declares one.
      expect(detectInstitution(tokensFor("汇丰One", "661-796201-833"))).toBe(
        "hsbchk",
      );
      expect(
        detectInstitution(
          tokensFor("Everyday", "Global", "Account", "145-742482-221"),
        ),
      ).toBe("hsbcsg");
    });

    it("does not let CMB swallow its Wing Lung subsidiary", () => {
      // 一卡通 appears on both banks' screens, so CMB is deliberately not keyed
      // on it. A Wing Lung screenshot carrying that brand must still resolve to
      // Wing Lung via its account number.
      expect(detectInstitution(tokensFor("一卡通", "601-526-0984-7"))).toBe(
        "cmbwl",
      );
    });

    it("does not read a broker screen as IBKR just because IBKR is held", () => {
      // IBKR is a listed company: its ticker and name show up in the holdings
      // list of ANY broker app where the user owns the stock. Detection is
      // keyed on IBKR's own UI vocabulary instead, so this stays unresolved
      // rather than being misattributed.
      expect(
        detectInstitution(tokensFor("IBKR", "NASDAQ.NMS", "89.74", "持仓")),
      ).toBe("unknown");
    });
  });
});

describe("resolveInstitutionConfig", () => {
  it("layers the institution's overrides on the shared defaults", () => {
    const { institutionId, config } = resolveInstitutionConfig(
      tokensFor("OCBC"),
    );

    expect(institutionId).toBe("ocbc");
    expect(config.iconTags).toEqual(["360", "gsa", "sts"]);
    // Inherited from DEFAULT_CONFIG rather than redeclared per institution.
    expect(config.equivalentTotalPattern).toBeDefined();
  });

  it("returns the shared defaults for an unknown institution", () => {
    const { institutionId, config } = resolveInstitutionConfig(
      tokensFor("Savings", "Account"),
    );

    expect(institutionId).toBe("unknown");
    // An unrecognized institution degrades to the shared rules; it does not
    // pick up another institution's icon tags.
    expect(config.iconTags).toBeUndefined();
  });
});

describe("generic words are not institution-name tokens", () => {
  it("does not read a security named 'Trust' as Trust Bank", () => {
    // The name-token tier is swept across every institution before the
    // product-name tier, so "trust" — an ordinary word in security names
    // (unit trusts, REITs) — outranked IBKR's own term of art and flipped the
    // account's kind from investment to cash.
    const { institutionId } = resolveInstitutionConfig(
      tokensFor("净清算价值", "63,714.00", "Link", "REIT", "Trust"),
    );
    expect(institutionId).toBe("ibkr");
  });

  it("still detects Trust Bank by its own product name", () => {
    const { institutionId } = resolveInstitutionConfig(
      tokensFor("储蓄罐", "1,000.00"),
    );
    expect(institutionId).toBe("trust");
  });
});

describe("short product names need word boundaries", () => {
  it("does not detect OCBC from 'sts' inside an ordinary word", () => {
    // Product names were substring-matched, so OCBC's "sts" icon code fired on
    // "trusts" / "costs" / "interests" — and because the product tier is swept
    // across every institution, OCBC won detection on any screen listing a REIT.
    const { institutionId } = resolveInstitutionConfig(
      tokensFor("Portfolio", "Link", "REIT", "Trusts", "Cash", "Account"),
    );
    expect(institutionId).toBe("unknown");
  });

  it("still detects OCBC from its real product names", () => {
    expect(
      resolveInstitutionConfig(tokensFor("360", "Account", "6,672.59"))
        .institutionId,
    ).toBe("ocbc");
  });
});

describe("two institutions named on one screen", () => {
  it("prefers the one that signs the top of the screen", () => {
    // An exchange listing 支付宝 as a funding method names both, and
    // declaration order handed it to Alipay — flipping the account's kind from
    // crypto to investment. The app that owns the screen signs it at the top.
    const lines = [
      ...tokensFor("OKX"),
      ...tokensFor("Funding", "Account"),
      ...tokensFor("支付宝"),
    ].map((line, lineIndex) =>
      line.map((token) => ({
        ...token,
        box: { ...token.box, y: lineIndex * 0.1 },
      })),
    );
    expect(resolveInstitutionConfig(lines).institutionId).toBe("okx");
  });

  it("still detects Alipay when it is the screen's own brand", () => {
    expect(
      resolveInstitutionConfig(tokensFor("支付宝", "余额宝", "5,203.47"))
        .institutionId,
    ).toBe("alipay");
  });
});

describe("a product name has to fit on one row", () => {
  it("does not assemble one out of two unrelated rows", () => {
    // Joined across lines, "Acme Global" above "Savings Rates" spelled OCBC's
    // "global savings" and routed the screenshot to OCBC's config and currency.
    const lines = [
      ...tokensFor("Acme", "Global"),
      ...tokensFor("Savings", "Rates"),
    ];
    expect(detectInstitution(lines)).toBe("unknown");
  });

  it("still detects it when one row carries the whole name", () => {
    expect(detectInstitution(tokensFor("Global", "Savings", "Account"))).toBe(
      "ocbc",
    );
  });
});
