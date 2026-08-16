import { describe, expect, it } from "vitest";

import { classifyRow } from "./line-classify";
import { parseOcrBlocks, parseOcrBlocksTraced } from "./parser";
import { columns, row, screen } from "../test-support/screen";

// End-to-end tests: blocks in, recognized accounts out. These are the ones that
// state what the package actually promises — the unit tests above them explain
// why each rule behaves as it does, but this is the contract the app consumes.
describe("parseOcrBlocks", () => {
  it("recognizes a single account with its balance", () => {
    const accounts = parseOcrBlocks(
      screen(row("Statement", "Savings", "Account"), row("SGD", "6,672.59")),
    );

    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({
      accountName: "Statement Savings Account",
      balances: [{ currency: "SGD", balance: 6672.59 }],
      kind: "cash",
    });
  });

  it("recognizes the name and balance from one shared row", () => {
    // An overview row often carries both; the currency anchor is what keeps the
    // name's digits out of the balance.
    const accounts = parseOcrBlocks(screen(row("360", "Account", "$5,000.00")));

    expect(accounts[0]).toMatchObject({
      accountName: "360 Account",
      balances: [{ currency: "USD", balance: 5000 }],
    });
  });

  it("extracts the last four from a masked card row", () => {
    const accounts = parseOcrBlocks(
      screen(
        row("Platinum", "Card"),
        row("••••", "4242"),
        row("SGD", "1,234.56"),
      ),
    );

    expect(accounts[0]).toMatchObject({
      accountLastFourDigits: "4242",
      balances: [{ currency: "SGD", balance: 1234.56 }],
    });
  });

  // Non-masked account numbers were the single biggest gap in recognition:
  // every one of these rows used to fall through to `accountName`, losing the
  // last four AND opening a spurious account for what is really an attribute
  // of the account above.
  describe("last four from non-masked account numbers", () => {
    it("reads a last four the screen states outright", () => {
      const accounts = parseOcrBlocks(
        screen(row("龙卡通"), row("尾号7732"), row("CNY", "10,922.04")),
      );

      expect(accounts[0].accountLastFourDigits).toBe("7732");
    });

    it("reads a bare account number", () => {
      const accounts = parseOcrBlocks(
        screen(
          row("储蓄户口"),
          row("户口号码", "0193855038"),
          row("SGD", "2,845.42"),
        ),
      );

      expect(accounts[0]).toMatchObject({
        accountLastFourDigits: "5038",
        balances: [{ currency: "SGD", balance: 2845.42 }],
      });
    });

    // KNOWN LIMITATION. The name here comes out as "户口号码" (the label on the
    // account-number row), not "储蓄户口" (the account's actual title one row
    // above), because the account-keyword test that decides whether a row opens
    // an account region only knows English words — a Chinese title doesn't
    // match, so its row never opens the region and the name is taken from
    // whatever row does.
    //
    // Simply adding Chinese keywords does not fix it: those words label
    // sub-account rows as often as accounts, and doing so regressed the corpus.
    // See the note on `defaultAccountKeywords`. Pinned so the day the grouping
    // step learns to tell an account from its sub-rows, this test flips and
    // says so.
    it("does not yet title an account from a Chinese name row", () => {
      const accounts = parseOcrBlocks(
        screen(
          row("储蓄户口"),
          row("户口号码", "0193855038"),
          row("SGD", "2,845.42"),
        ),
      );

      expect(accounts[0].accountName).toBe("户口号码");
    });

    it("reads a hyphen-grouped account number", () => {
      const accounts = parseOcrBlocks(
        screen(row("Savings", "Account"), row("601-526-0984-7")),
      );

      expect(accounts[0].accountLastFourDigits).toBe("9847");
    });

    it("takes the account number, not a balance sharing the row", () => {
      // Joining the row first would fuse "…-0371" and "-1,745.52" into one run
      // and yield "3711". Reading per token is what prevents that.
      const accounts = parseOcrBlocks(
        screen(row("Credit", "Card", "4921-6001-0138-0371", "-1,745.52SGD")),
      );

      expect(accounts[0].accountLastFourDigits).toBe("0371");
    });

    it("does not mistake a crypto quantity for an account number", () => {
      // "0.00021312" contains an 8-digit run, but it isn't a standalone digit
      // token, so it stays on the amount path.
      const accounts = parseOcrBlocks(
        screen(row("BTC", "Wallet"), row("USD", "13.62")),
      );

      expect(accounts[0].accountLastFourDigits).toBeUndefined();
    });
  });

  describe("account names carried on a card row", () => {
    it("names the account from the row that carries its number", () => {
      // Some screens title an account only on its card row.
      const accounts = parseOcrBlocks(
        screen(row("一卡通", "601-526-0984-7"), row("HKD", "10,336.81")),
      );

      expect(accounts[0]).toMatchObject({
        accountName: "一卡通",
        accountLastFourDigits: "9847",
        balances: [{ currency: "HKD", balance: 10336.81 }],
      });
    });

    it("recovers an account that a summary row would otherwise swallow", () => {
      // A "总资产" summary starts discarding rows; only a row that names an
      // account ends it. When the account is titled on its card row, that row
      // has to be able to restart — otherwise the whole screen is discarded.
      const accounts = parseOcrBlocks(
        screen(
          row("总资产"),
          row("HKD", "10,362.95"),
          row("一卡通", "601-526-0984-7"),
          row("HKD", "10,336.81"),
        ),
      );

      expect(accounts).toHaveLength(1);
      expect(accounts[0]).toMatchObject({
        accountName: "一卡通",
        balances: [{ currency: "HKD", balance: 10336.81 }],
      });
    });

    it("does not split an account off its own attached card", () => {
      // "借记卡 4218-…" under an open account is that account's card, not a
      // second account. A named card row must not act as a boundary.
      const accounts = parseOcrBlocks(
        screen(
          row("360", "Account"),
          row("SGD", "6,672.59"),
          row("借记卡", "4218-0803-2297-3829"),
        ),
      );

      expect(accounts).toHaveLength(1);
      expect(accounts[0].accountName).toBe("360 Account");
    });

    it("never names an account after a bare digit run", () => {
      // The "4242" of a masked card row is not a name; treating it as one used
      // to split the card off the account it belongs to.
      const accounts = parseOcrBlocks(
        screen(
          row("Platinum", "Card"),
          row("SGD", "1,234.56"),
          row("••••", "4242"),
        ),
      );

      expect(accounts).toHaveLength(1);
      expect(accounts[0]).toMatchObject({
        accountName: "Platinum Card",
        accountLastFourDigits: "4242",
      });
    });
  });

  it("keeps an expiry out of the last four", () => {
    const accounts = parseOcrBlocks(
      screen(row("Platinum", "Card"), row("••••", "1234", "08/26")),
    );

    expect(accounts[0].accountLastFourDigits).toBe("1234");
  });

  it("reads a zero balance as a real balance", () => {
    // An empty sub-account is recognized; whether to keep it is the form's
    // decision, not the recognizer's.
    const accounts = parseOcrBlocks(
      screen(row("Savings", "Account"), row("USD", "0.00")),
    );

    expect(accounts[0].balances).toEqual([{ currency: "USD", balance: 0 }]);
  });

  it("splits two accounts into two results", () => {
    const accounts = parseOcrBlocks(
      screen(
        row("Statement", "Savings", "Account"),
        row("SGD", "6,672.59"),
        row("Global", "Savings", "Account"),
        row("USD", "1,200.00"),
      ),
    );

    expect(accounts).toHaveLength(2);
    expect(accounts.map((a) => a.accountName)).toEqual([
      "Statement Savings Account",
      "Global Savings Account",
    ]);
    expect(accounts[1].balances).toEqual([{ currency: "USD", balance: 1200 }]);
  });

  it("reads a multi-currency table by column alignment", () => {
    // A currency header row over a value row: each amount belongs to the
    // currency sitting above it, which only column geometry can tell you.
    const accounts = parseOcrBlocks(
      screen(
        row("Global", "Savings", "Account"),
        columns([
          ["SGD", 0.2],
          ["HKD", 0.5],
          ["USD", 0.8],
        ]),
        columns([
          ["100,554.59", 0.2],
          ["2,000.00", 0.5],
          ["0.00", 0.8],
        ]),
      ),
    );

    expect(accounts[0].balances).toEqual([
      { currency: "SGD", balance: 100554.59 },
      { currency: "HKD", balance: 2000 },
      { currency: "USD", balance: 0 },
    ]);
  });

  it("does not turn a summary row into an account", () => {
    const accounts = parseOcrBlocks(
      screen(
        row("Total", "Assets"),
        row("SGD", "999,999.00"),
        row("Statement", "Savings", "Account"),
        row("SGD", "6,672.59"),
      ),
    );

    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({
      accountName: "Statement Savings Account",
      balances: [{ currency: "SGD", balance: 6672.59 }],
    });
  });

  it("drops nav and status-bar noise", () => {
    const accounts = parseOcrBlocks(
      screen(
        row("22:28", "A", "5G"),
        row("Statement", "Savings", "Account"),
        row("SGD", "6,672.59"),
        row("home"),
      ),
    );

    expect(accounts).toHaveLength(1);
    expect(accounts[0].accountName).toBe("Statement Savings Account");
  });

  it("returns nothing for a screenshot with no account content", () => {
    expect(parseOcrBlocks(screen(row("home"), row("settings")))).toEqual([]);
    expect(parseOcrBlocks([])).toEqual([]);
  });

  it("classifies a brokerage screen as investment", () => {
    const accounts = parseOcrBlocks(
      screen(row("Securities", "Account"), row("SGD", "63,714.00")),
    );

    expect(accounts[0].kind).toBe("investment");
  });

  describe("institution detection", () => {
    it("detects OCBC from its name token and strips the icon tag", () => {
      // "360 360 Account" is the icon label plus the real name; the account is
      // "360 Account", not "360 360 Account".
      const accounts = parseOcrBlocks(
        screen(
          row("OCBC"),
          row("360", "360", "Account"),
          row("SGD", "6,672.59"),
        ),
      );

      expect(accounts[0]).toMatchObject({
        institutionId: "ocbc",
        accountName: "360 Account",
      });
    });

    it("detects DBS from its product name alone", () => {
      // The institution token can be scrolled off screen; the product name
      // still identifies it.
      const accounts = parseOcrBlocks(
        screen(row("DBS", "Multiplier"), row("SGD", "1,234.56")),
      );

      expect(accounts[0].institutionId).toBe("dbs");
    });

    it("falls back to unknown, still recognizing the account", () => {
      // An unrecognized institution degrades to the shared rules rather than
      // failing — the account is still read.
      const accounts = parseOcrBlocks(
        screen(row("Statement", "Savings", "Account"), row("SGD", "6,672.59")),
      );

      expect(accounts[0]).toMatchObject({
        institutionId: "unknown",
        accountName: "Statement Savings Account",
      });
    });
  });

  it("tags every account on a screenshot with the same institution", () => {
    const accounts = parseOcrBlocks(
      screen(
        row("OCBC"),
        row("Statement", "Savings", "Account"),
        row("SGD", "6,672.59"),
        row("Global", "Savings", "Account"),
        row("USD", "1,200.00"),
      ),
    );

    expect(accounts).toHaveLength(2);
    expect(new Set(accounts.map((a) => a.institutionId))).toEqual(
      new Set(["ocbc"]),
    );
  });

  it("only emits fields it actually recognized", () => {
    // Every field is optional; the form fills the rest. An account with no card
    // row must not carry a fabricated last four.
    const accounts = parseOcrBlocks(
      screen(row("Statement", "Savings", "Account"), row("SGD", "6,672.59")),
    );

    expect(accounts[0].accountLastFourDigits).toBeUndefined();
  });
});

describe("parseOcrBlocksTraced", () => {
  it("returns the same accounts as the plain parser", () => {
    const blocks = screen(
      row("Statement", "Savings", "Account"),
      row("SGD", "6,672.59"),
    );

    expect(parseOcrBlocksTraced(blocks).accounts).toEqual(
      parseOcrBlocks(blocks),
    );
  });

  it("exposes the intermediate stages for diagnosis", () => {
    const { trace } = parseOcrBlocksTraced(
      screen(
        row("OCBC"),
        row("Statement", "Savings", "Account"),
        row("SGD", "6,672.59"),
      ),
    );

    expect(trace.institutionId).toBe("ocbc");
    expect(trace.classified.map((line) => line.role)).toEqual([
      "accountName",
      "accountName",
      "amountRow",
    ]);
    // Line indexes are 1-based so a diagnosis report can point at a row.
    expect(trace.classified[0].index).toBe(1);
    expect(trace.groups.length).toBeGreaterThan(0);
  });
});

// Rules learned from real screens. Each of these was a wrong reading of an
// actual screenshot before the rule existed, so the case is the screen.
describe("reading real screen layouts", () => {
  describe("credit cards", () => {
    it("reads what you spent as a negative balance", () => {
      // A card reports debt. "您花了 4,766.92" is a balance of -4,766.92.
      const accounts = parseOcrBlocks(
        screen(
          row("OCBC", "365", "Credit", "Card"),
          row("4524-1920-1166-4269"),
          row("您花了", "4,766.92", "SGD"),
        ),
      );

      expect(accounts[0]).toMatchObject({
        accountLastFourDigits: "4269",
        balances: [{ currency: "SGD", balance: -4766.92 }],
      });
    });

    it("ignores the credit limit and the statement due", () => {
      // Summing these turned a 4,766.92 card into 61,180.91.
      const accounts = parseOcrBlocks(
        screen(
          row("OCBC", "365", "Credit", "Card"),
          row("您花了", "4,766.92", "SGD"),
          row("账单", "到期", "3,580.91", "SGD"),
          row("信用额度", "24,033.08", "of", "28,800.00", "SGD"),
        ),
      );

      expect(accounts[0].balances).toEqual([
        { currency: "SGD", balance: -4766.92 },
      ]);
    });
  });

  it("stops reading at a transaction list", () => {
    // Every posting below the heading looks exactly like a balance row.
    const accounts = parseOcrBlocks(
      screen(
        row("DBS", "Multiplier", "Account"),
        row("SGD", "100,554.59"),
        row("Transaction", "History"),
        row("TRF", "TOP-UP", "TO", "PAYLAH!"),
        row("SGD", "-4.50"),
      ),
    );

    expect(accounts[0].balances).toEqual([
      { currency: "SGD", balance: 100554.59 },
    ]);
  });

  it("takes the total when a single-account screen states only that", () => {
    // A crypto exchange shows its total and then per-wallet splits; the chart
    // axis labels between them are not balances.
    const accounts = parseOcrBlocks(
      screen(
        row("OKX"),
        row("总资产估值"),
        row("SGD", "44,503.83"),
        row("S$52,417.55"),
        row("S$27,012.77"),
      ),
    );

    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({
      kind: "crypto",
      balances: [{ currency: "SGD", balance: 44503.83 }],
    });
  });

  it("counts a repeated figure once", () => {
    // An overview restates the same money at several levels of detail.
    const accounts = parseOcrBlocks(
      screen(
        row("Statement", "Savings", "Account"),
        row("SGD", "5,203.47"),
        row("SGD", "5,203.47"),
      ),
    );

    expect(accounts[0].balances).toEqual([
      { currency: "SGD", balance: 5203.47 },
    ]);
  });

  it("ignores a gain printed beside the balance", () => {
    const accounts = parseOcrBlocks(
      screen(row("Savings", "Account"), row("SGD", "5,203.47", "+0.88")),
    );

    expect(accounts[0].balances).toEqual([
      { currency: "SGD", balance: 5203.47 },
    ]);
  });

  it("does not open an account for a disclaimer", () => {
    // HSBC prints prose containing its own name under the cards.
    const accounts = parseOcrBlocks(
      screen(
        row("汇丰One"),
        row("661-796201-833"),
        row("62,612.59", "HKD"),
        row("保障您的存款免遭诈骗或未经授权使用。", "开立汇丰智安存账户"),
      ),
    );

    expect(accounts).toHaveLength(1);
  });

  describe("currencies named in Chinese", () => {
    it("reads 港元 / 美元 / 新加坡元 / 人民币", () => {
      const accounts = parseOcrBlocks(
        screen(row("智能账户"), row("港元", "1,212.52"), row("012049644240")),
      );

      expect(accounts[0].balances).toEqual([
        { currency: "HKD", balance: 1212.52 },
      ]);
    });

    it("does not read a bare 元 in marketing copy as a currency", () => {
      // "日享约2.21元" is ad copy, not a balance.
      const accounts = parseOcrBlocks(
        screen(row("活期存款"), row("转朝朝宝日享约2.21元")),
      );

      expect(accounts[0]?.balances).toBeUndefined();
    });
  });

  it("denominates a domestic bank's bare figure in its own currency", () => {
    // A China Merchants overview prints 76,007.05 with no currency anywhere.
    const accounts = parseOcrBlocks(
      screen(row("朝朝宝"), row("活期存款"), row("76,007.05")),
    );

    expect(accounts[0]).toMatchObject({
      institutionId: "cmb",
      balances: [{ currency: "CNY", balance: 76007.05 }],
    });
  });

  it("drops the card total once its sub-accounts are listed", () => {
    // HSBC One shows the card's total, then "7个账户", then the parts. Keeping
    // both double-counts the money.
    const accounts = parseOcrBlocks(
      screen(
        row("汇丰One"),
        row("661-796201-833"),
        row("74,987.99HKD"),
        row("7个账户"),
        row("港元储蓄"),
        row("62,612.59", "HKD"),
        row("人民币储蓄"),
        row("10,640.40CNY"),
      ),
    );

    expect(accounts[0].balances).toEqual([
      { currency: "HKD", balance: 62612.59 },
      { currency: "CNY", balance: 10640.4 },
    ]);
  });

  describe("names cleaned of OCR debris", () => {
    it("strips a fragment of card artwork", () => {
      const accounts = parseOcrBlocks(
        screen(
          row("200RO", "$59", "OCBC", "365", "Credit", "Card"),
          row("您花了", "4,766.92", "SGD"),
        ),
      );

      expect(accounts[0]?.accountName).toBe("OCBC 365 Credit Card");
    });

    it("strips a lone letter left by a logo", () => {
      const accounts = parseOcrBlocks(
        screen(row("D", "Bitget", "Wallet"), row("$403.3")),
      );

      expect(accounts[0]).toMatchObject({
        accountName: "Bitget Wallet",
        balances: [{ currency: "USD", balance: 403.3 }],
      });
    });

    it("ends the name at its last account word", () => {
      // A tab bar runs together with the title on one OCR line.
      // 储蓄罐 identifies Trust, whose product list knows 储蓄户口 as an
      // account word; the truncation has to have an anchor to cut at.
      const accounts = parseOcrBlocks(
        screen(
          row("储蓄罐"),
          row("储蓄户口", "付款", "更多"),
          row("户口号码", "0193855038"),
        ),
      );

      expect(accounts[0]?.accountName).toBe("储蓄户口");
    });
  });
});

// A broker's holdings table is the most misleading layout on any of these
// screens: it prints a currency label per row, but every figure beside it is
// already converted into the account's base currency. Reading those rows as
// per-currency balances is wrong twice over — wrong currency AND, with a K/M
// suffix, wrong by three orders of magnitude.
describe("broker holdings tables", () => {
  it("takes no balance from a converted holdings row", () => {
    // IBKR's "HKD 现金 15.8K 市场价值" is 15,800 SGD, not 15,800 HKD. The
    // account's own total already includes it.
    const accounts = parseOcrBlocks(
      screen(
        row("剩余流动性"),
        row("SGD", "现金", "602.72", "市场价值"),
        row("HKD", "现金", "15.8K", "市场价值"),
        row("USD", "现金", "26.4K", "市场价值"),
      ),
    );

    expect(accounts.flatMap((a) => a.balances ?? [])).toEqual([]);
  });

  it("reads the account total, not the holdings that make it up", () => {
    const accounts = parseOcrBlocks(
      screen(
        row("净清算价值", "当日盈亏"),
        row("63,714", "-327", "-0.51%"),
        row("现金余额"),
        row("HKD", "现金", "15.8K", "市场价值"),
        row("SGD", "现金", "602.72", "市场价值"),
      ),
    );

    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({
      institutionId: "ibkr",
      kind: "investment",
      balances: [{ currency: "SGD", balance: 63714 }],
    });
  });
});

// Regressions found by review, each pinned by the screen that produced it.
describe("rows that must not swallow or invent a balance", () => {
  it("keeps reading past a nav row that merely mentions transactions", () => {
    // "transactions" used to be substring-matched against the whole row, and
    // this marker stops the scan outright — so a top nav bar aborted parsing
    // at row 1 and every account below was silently lost.
    const accounts = parseOcrBlocks(
      screen(
        row("Home", "Transactions", "Cards"),
        row("Savings", "Account"),
        row("SGD", "1,234.56"),
      ),
    );
    expect(accounts).toHaveLength(1);
    expect(accounts[0].balances).toEqual([
      { currency: "SGD", balance: 1234.56 },
    ]);
  });

  it("does not read a bare one-decimal figure as money", () => {
    // "Interest rate 3.5" was parsed as a 3.50 balance and summed into the
    // account's real one. A one-decimal figure is money only next to a
    // currency (Bitget's "$403.3") — see `hasCurrencyAmountShape`.
    const accounts = parseOcrBlocks(
      screen(
        row("Savings", "Account"),
        row("Interest", "rate", "3.5"),
        row("SGD", "1,000.00"),
      ),
    );
    expect(accounts[0].balances).toEqual([{ currency: "SGD", balance: 1000 }]);
  });

  it("does not read a statement date as an account number", () => {
    // "2025-08-15" is 8+ digits with hyphen grouping, so it read as a
    // standalone account number and fabricated an account whose last four was
    // "0815".
    const accounts = parseOcrBlocks(
      screen(
        row("截至", "2025-08-15"),
        row("Savings", "Account"),
        row("SGD", "1,234.56"),
      ),
    );
    expect(accounts).toHaveLength(1);
    expect(accounts[0].accountName).toBe("Savings Account");
  });

  it("keeps the balance on a card row that also carries the number", () => {
    // A zh-Hans card list prints identity and money on one line. The row is
    // classified `cardNumber` (the last-four test runs first), so the amount
    // path never saw it and the money was dropped.
    const accounts = parseOcrBlocks(
      screen(row("储蓄卡", "尾号7732", "HKD", "12,345.67")),
    );
    expect(accounts[0].accountLastFourDigits).toBe("7732");
    expect(accounts[0].balances).toEqual([
      { currency: "HKD", balance: 12345.67 },
    ]);
  });

  it("does not name an untitled card region after its currency", () => {
    // The "name the account after its leading currency" rule exists for
    // "美元 美元 5,673.53", where the currency is repeated. A single leading
    // currency token is just a balance row, and naming the account "SGD"
    // pre-filled the form with a currency code.
    const accounts = parseOcrBlocks(
      screen(row("****", "4242"), row("SGD", "1,234.56")),
    );
    expect(accounts[0].accountName).toBeUndefined();
    expect(accounts[0].accountLastFourDigits).toBe("4242");
  });

  it("still names a foreign-currency account after its repeated currency", () => {
    const accounts = parseOcrBlocks(screen(row("美元", "美元", "5,673.53")));
    expect(accounts[0].accountName).toBe("美元");
    expect(accounts[0].balances).toEqual([
      { currency: "USD", balance: 5673.53 },
    ]);
  });
});

// A second review pass, once negative balances were first-class.
describe("signs and rates", () => {
  it("reads a summary debt, not the gain printed beside it", () => {
    // The fallback picks the biggest summary figure. Compared by signed value,
    // any positive figure beat a card's negative total; and a "+"-signed gain
    // was captured at all, which the per-account path already refuses.
    const accounts = parseOcrBlocks(
      screen(row("总资产"), row("-1,745.52", "SGD", "+50.00")),
    );
    expect(accounts[0].balances).toEqual([
      { currency: "SGD", balance: -1745.52 },
    ]);
  });

  it("ignores a rate whose % was split into its own token", () => {
    // `matchAmount` strips percentages per ROW, but balances are summed per
    // TOKEN — so a split "%" left "-0.51" labelled `amount` and it was added to
    // the balance.
    const split = parseOcrBlocks(
      screen(row("Savings", "Account"), row("SGD", "1,234.56", "-0.51", "%")),
    );
    const glued = parseOcrBlocks(
      screen(row("Savings", "Account"), row("SGD", "1,234.56", "-0.51%")),
    );
    const expected = [{ currency: "SGD", balance: 1234.56 }];
    expect(split[0].balances).toEqual(expected);
    expect(glued[0].balances).toEqual(expected);
  });
});

// A third review pass. Each of these lost or invented money on a plausible row.
describe("neighbouring tokens must not steal the balance", () => {
  it("reads a balance beside a tenor label", () => {
    // The magnitude guard used to test the whole row, so a fixed deposit's
    // "12M" discarded the 50,000.00 next to it — and with it the account.
    const accounts = parseOcrBlocks(
      screen(row("Time", "Deposit", "12M", "SGD", "50,000.00")),
    );
    expect(accounts[0].accountName).toBe("Time Deposit");
    expect(accounts[0].balances).toEqual([{ currency: "SGD", balance: 50000 }]);
  });

  it("does not read a day-first date as an account number", () => {
    // Same shape as the ISO case: 8+ chars of [0-9-] is the standalone
    // account-number morphology, so "15-08-2025" yielded a last four of "2025".
    const accounts = parseOcrBlocks(
      screen(
        row("Savings", "Account"),
        row("SGD", "1,234.56"),
        row("结算日", "15-08-2025"),
      ),
    );
    expect(accounts).toHaveLength(1);
    expect(accounts[0].accountLastFourDigits).toBeUndefined();
  });

  it("ignores a gain whose + was split into its own token", () => {
    // "an explicitly signed + figure is a gain, never a balance" only fired
    // when the sign was glued on; OCR emits it as its own block often enough
    // that the gain was being summed into the balance.
    const accounts = parseOcrBlocks(
      screen(row("Savings", "Account"), row("SGD", "5,203.47", "+", "12.88")),
    );
    expect(accounts[0].balances).toEqual([
      { currency: "SGD", balance: 5203.47 },
    ]);
  });

  it("does not hand a whole screen's total to one of several accounts", () => {
    // The summary fallback is for a single-account overview. On a screen with
    // several accounts and no per-account balance, it used to assign the grand
    // total to the first account and leave the rest blank.
    const accounts = parseOcrBlocks(
      screen(
        row("总资产"),
        row("SGD", "9,999.00"),
        row("Savings", "Account"),
        row("Current", "Account"),
      ),
    );
    expect(accounts.every((a) => a.balances === undefined)).toBe(true);
  });
});

// A fourth review pass. Every one of these dropped a real account or its money.
describe("titles and headings that must not be misread", () => {
  it("opens an account whose title contains an abbreviation", () => {
    // `SENTENCE_LIKE_RE` treated any punctuation-plus-space as prose, so
    // "U.S. Dollar Account" never opened a region — and its balance was then
    // discarded as a converted total.
    const accounts = parseOcrBlocks(
      screen(
        row("Savings", "Account"),
        row("SGD", "1,000.00"),
        row("U.S.", "Dollar", "Account"),
        row("USD", "2,000.00"),
      ),
    );
    expect(accounts).toHaveLength(2);
    expect(accounts[1].balances).toEqual([{ currency: "USD", balance: 2000 }]);
  });

  it("keeps reading past a top tab bar that leads with a heading word", () => {
    // Anchoring the heading to the row start fixed a mid-row false positive but
    // not this one: a tab bar leads its row exactly like a heading does. A
    // section END cannot precede the section.
    const accounts = parseOcrBlocks(
      screen(
        row("Transactions", "Cards", "Rewards"),
        row("Savings", "Account"),
        row("SGD", "1,000.00"),
      ),
    );
    expect(accounts).toHaveLength(1);
    expect(accounts[0].balances).toEqual([{ currency: "SGD", balance: 1000 }]);
  });

  it("keeps a balance beside a word that starts with a magnitude character", () => {
    // 万 opens ordinary words. Unguarded, "万事达卡" (Mastercard) read as a
    // 10^4 multiplier and the row's balance was rejected outright.
    const accounts = parseOcrBlocks(
      screen(row("储蓄", "账户"), row("CNY", "5,000.00", "万事达卡")),
    );
    expect(accounts[0].balances).toEqual([{ currency: "CNY", balance: 5000 }]);
  });

  it("keeps a maturity date from suppressing a term deposit's balance", () => {
    // 到期 marks a card's statement due amount, but 到期日 labels a maturity
    // date printed beside a real balance.
    const accounts = parseOcrBlocks(
      screen(
        row("定期存款", "账户"),
        row("CNY", "50,000.00", "到期日", "2027-01-01"),
      ),
    );
    expect(accounts[0].balances).toEqual([{ currency: "CNY", balance: 50000 }]);
  });

  it("reads a last four past a stray bullet beside the account number", () => {
    // The masked-card branch gave up when fewer than four digits followed the
    // mask, short-circuiting the account-number fallback below it — so a "·"
    // OCR'd next to the number cost the row its last four.
    const accounts = parseOcrBlocks(
      screen(row("Everyday", "Global", "Account"), row("·", "145-742482-221")),
    );
    expect(accounts[0].accountLastFourDigits).toBe("2221");
  });
});

// A sixth review pass. Word boundaries and adjacency, mostly.
describe("neighbouring words must not be read as currency or code", () => {
  it("keeps a balance beside a three-letter institution abbreviation", () => {
    // The unstorable-currency guard matched any three capitals, so "DBS" beside
    // a fused "S$1,234.56" threw the balance away — and the account with it.
    const accounts = parseOcrBlocks(
      screen(row("Savings", "Account"), row("DBS", "S$1,234.56")),
    );
    expect(accounts[0].balances).toEqual([
      { currency: "SGD", balance: 1234.56 },
    ]);
  });

  it("drops a figure in an unstorable currency printed next to it", () => {
    const accounts = parseOcrBlocks(
      screen(
        row("Savings", "Account"),
        row("601-526-0984-7"),
        row("HKD", "26.14"),
        row("JPY", "1,000.00"),
      ),
    );
    expect(accounts[0].balances).toEqual([{ currency: "HKD", balance: 26.14 }]);
  });

  it("does not read a rate sharing a row with a real balance", () => {
    // The one-decimal relaxation was scoped to the ROW having a currency, so a
    // rate anywhere on a currency-denominated row was summed in.
    const accounts = parseOcrBlocks(
      screen(
        row("Savings", "Account"),
        row("SGD", "5,000.00", "Interest", "3.5"),
      ),
    );
    expect(accounts[0].balances).toEqual([{ currency: "SGD", balance: 5000 }]);
  });

  it("keeps an untitled card region when a named account follows", () => {
    // The open region was dropped unless it had a NAME, so a card carrying a
    // real last four and a real balance vanished when the next title arrived.
    const accounts = parseOcrBlocks(
      screen(
        row("••••", "1234"),
        row("SGD", "1,000.00"),
        row("Savings", "Account"),
        row("SGD", "2,000.00"),
      ),
    );
    expect(accounts).toHaveLength(2);
    expect(accounts[0].accountLastFourDigits).toBe("1234");
    expect(accounts[0].balances).toEqual([{ currency: "SGD", balance: 1000 }]);
  });
});

// A seventh review pass. Guards that had grown wider than the thing they guard.
describe("guards must not eat the balance they protect", () => {
  it("keeps the summary slot for a row that could be a balance", () => {
    // A change row sits between the total and its figure on every wallet
    // screen. Claiming the one summary slot with it left no account at all.
    const accounts = parseOcrBlocks(
      screen(
        row("总资产估值"),
        row("今日变动", "-0.11"),
        row("44,503.83", "SGD"),
      ),
    );
    expect(accounts[0].balances).toEqual([
      { currency: "SGD", balance: 44503.83 },
    ]);
  });

  it("still drops a rate whose % was split off", () => {
    const accounts = parseOcrBlocks(
      screen(row("Savings", "Account"), row("SGD", "1,234.56", "-0.51", "%")),
    );
    expect(accounts[0].balances).toEqual([
      { currency: "SGD", balance: 1234.56 },
    ]);
  });

  it("keeps a balance followed by a word starting with K/M/B", () => {
    // The magnitude guard fired whenever the next character wasn't
    // alphanumeric, so "5,000.00 M&A" rejected the row outright.
    const accounts = parseOcrBlocks(
      screen(row("Savings", "Account"), row("SGD", "5,000.00", "M&A")),
    );
    expect(accounts[0].balances).toEqual([{ currency: "SGD", balance: 5000 }]);
  });

  it("does not take a last four from a service hotline", () => {
    // A hotline is a hyphen-grouped digit run of exactly the account-number
    // shape, so a footer row donated "8888" to whichever account lacked one.
    const accounts = parseOcrBlocks(
      screen(
        row("Savings", "Account"),
        row("CNY", "1,234.56"),
        row("客服热线", "400-820-8888"),
      ),
    );
    expect(accounts[0].accountLastFourDigits).toBeUndefined();
  });
});

// An eighth review pass.
describe("layout and word boundaries decide what a figure means", () => {
  it("reads a trailing-currency row as two balances", () => {
    // The currency was always taken from BEFORE the figure, so a row printing
    // its codes after the figures collapsed into one made-up total.
    const trailing = parseOcrBlocks(
      screen(
        row("Savings", "Account"),
        row("1,212.52", "HKD", "5,673.53", "USD"),
      ),
    );
    const leading = parseOcrBlocks(
      screen(
        row("Savings", "Account"),
        row("HKD", "1,212.52", "USD", "5,673.53"),
      ),
    );
    const expected = [
      { currency: "HKD", balance: 1212.52 },
      { currency: "USD", balance: 5673.53 },
    ];
    expect(trailing[0].balances).toEqual(expected);
    expect(leading[0].balances).toEqual(expected);
  });

  it("does not take a last four from 'Pending'/'Spending'", () => {
    // `ending` had no leading word boundary, so it matched inside ordinary
    // words and the row donated a bogus last four to the open account.
    const accounts = parseOcrBlocks(
      screen(
        row("Savings", "Account"),
        row("SGD", "1,234.56"),
        row("Pending", "1234"),
      ),
    );
    expect(accounts[0].accountLastFourDigits).toBeUndefined();
  });

  it("still reads an explicit 'ending in' label", () => {
    const accounts = parseOcrBlocks(
      screen(row("Savings", "Account"), row("ending", "in", "1234")),
    );
    expect(accounts[0].accountLastFourDigits).toBe("1234");
  });
});

// A ninth review pass, all about the summary slot and account identity.
describe("accounts and summaries must not swallow each other", () => {
  it("keeps two accounts whose names differ only after the keyword", () => {
    // `cleanAccountName` truncates at the last account word, so both titles
    // reduced to "Current Account" — and the repeat-absorb branch then merged
    // the second into the first, reporting one account holding the sum.
    const accounts = parseOcrBlocks(
      screen(
        row("Current", "Account", "(Personal)"),
        row("SGD", "100.00"),
        row("Current", "Account", "(Joint)"),
        row("SGD", "200.00"),
      ),
    );
    expect(accounts).toHaveLength(2);
    expect(accounts[0].balances).toEqual([{ currency: "SGD", balance: 100 }]);
    expect(accounts[1].balances).toEqual([{ currency: "SGD", balance: 200 }]);
  });

  it("still absorbs a card that repeats its own title", () => {
    const accounts = parseOcrBlocks(
      screen(
        row("Everyday", "Global", "Account"),
        row("Everyday", "Global", "Account"),
        row("5,624.00SGD"),
      ),
    );
    expect(accounts).toHaveLength(1);
    expect(accounts[0].balances).toEqual([{ currency: "SGD", balance: 5624 }]);
  });

  it("does not let a bare gain row claim the summary slot", () => {
    // The slot was marked taken before knowing whether the row yielded a
    // figure, so a "+0.88" line consumed it and the real total was dropped.
    const accounts = parseOcrBlocks(
      screen(row("总资产"), row("+0.88"), row("5,203.47", "SGD")),
    );
    expect(accounts[0].balances).toEqual([
      { currency: "SGD", balance: 5203.47 },
    ]);
  });

  it("reads a total printed on the summary row itself", () => {
    // `summaryAmounts` was filled only from FOLLOWING rows, so a marker and its
    // figure sharing one clustered row recognized nothing at all.
    const accounts = parseOcrBlocks(screen(row("总资产", "44,503.83", "SGD")));
    expect(accounts[0].balances).toEqual([
      { currency: "SGD", balance: 44503.83 },
    ]);
  });
});

// A tenth review pass.
describe("labels attach to a figure, not to the whole row", () => {
  it("takes only the labelled figure from a debt row", () => {
    // Negating every figure read the card's remaining credit as more debt
    // (-14,766.92); counting it as a balance read it as an asset (+5,233.08).
    // A row that says it states a debt states ONE.
    const accounts = parseOcrBlocks(
      screen(
        row("信用卡"),
        row("您花了", "4,766.92", "SGD", "剩余额度", "10,000.00", "SGD"),
      ),
    );
    expect(accounts[0].balances).toEqual([
      { currency: "SGD", balance: -4766.92 },
    ]);
  });

  it.each([
    ["结息期间", "2025-2026"],
    ["客户经理", "9123-4567"],
  ])("does not take a last four from %s %s", (label, digits) => {
    // 8+ chars of digits and hyphens is the account-number shape, so a year
    // range and a phone number both donated their tail four.
    const accounts = parseOcrBlocks(
      screen(
        row("Savings", "Account"),
        row("SGD", "12,345.67"),
        row(label, digits),
      ),
    );
    expect(accounts[0].accountLastFourDigits).toBeUndefined();
  });

  it("still reads a real unmasked account number", () => {
    const accounts = parseOcrBlocks(
      screen(row("Savings", "Account"), row("0193855038")),
    );
    expect(accounts[0].accountLastFourDigits).toBe("5038");
  });
});

// An eleventh review pass — the negative-balance path, both layouts.
describe("a debt stays a debt through the pipeline", () => {
  it("reads a sign glued before the currency symbol", () => {
    const accounts = parseOcrBlocks(
      screen(row("360", "Account"), row("-S$4,766.92")),
    );
    expect(accounts[0].balances).toEqual([
      { currency: "SGD", balance: -4766.92 },
    ]);
  });

  it("reads a sign on a currency token split from its figure", () => {
    // "-S$" wasn't recognized as a currency token at all, so the figure lost
    // both its sign and its currency — and on an institution with no
    // `defaultCurrency` the account was dropped entirely.
    const accounts = parseOcrBlocks(
      screen(row("Savings", "Account"), row("-S$", "1,234.56")),
    );
    expect(accounts[0].balances).toEqual([
      { currency: "SGD", balance: -1234.56 },
    ]);
  });

  it("leaves an unsigned split currency token positive", () => {
    const accounts = parseOcrBlocks(
      screen(row("Savings", "Account"), row("S$", "1,234.56")),
    );
    expect(accounts[0].balances).toEqual([
      { currency: "SGD", balance: 1234.56 },
    ]);
  });
});

// A twelfth review pass.
describe("a debt label anywhere on its row, and holdings that are not conversions", () => {
  it("reads a debt whose label trails the figure", () => {
    // The labelled-figure lookup only searched AFTER the label token, so a
    // trailing label returned -1 and every amount on the row was skipped —
    // taking the account with them.
    const accounts = parseOcrBlocks(
      screen(
        row("OCBC", "365", "Credit", "Card"),
        row("4,766.92", "SGD", "欠款"),
      ),
    );
    expect(accounts[0].balances).toEqual([
      { currency: "SGD", balance: -4766.92 },
    ]);
  });

  it("keeps every currency a multi-currency account lists", () => {
    // Any non-zero figure in a not-yet-established currency counted as a
    // converted total, so a plain per-currency list lost everything after the
    // first row.
    const accounts = parseOcrBlocks(
      screen(
        row("Multi", "Currency", "Account"),
        row("SGD", "1,000.00"),
        row("USD", "500.00"),
      ),
    );
    expect(accounts[0].balances).toEqual([
      { currency: "SGD", balance: 1000 },
      { currency: "USD", balance: 500 },
    ]);
  });

  it("still drops an equivalent total in the institution's home currency", () => {
    const accounts = parseOcrBlocks(
      screen(
        row("Global", "Savings", "Account"),
        row("CNY", "10,716.02"),
        row("USD", "0.00"),
        row("Equivalent", "in", "SGD", "2,009.85"),
      ),
    );
    expect(accounts[0].balances).toEqual([
      { currency: "CNY", balance: 10716.02 },
      { currency: "USD", balance: 0 },
    ]);
  });
});

describe("a compact date is not an account number", () => {
  it("does not take a last four from yyyymmdd", () => {
    // No separator, so `stripDateFragments` leaves it and the 8-digit run reads
    // as a standalone account number ending "0815".
    const accounts = parseOcrBlocks(
      screen(
        row("Savings", "Account"),
        row("SGD", "1,234.56"),
        row("记账日期", "20250815"),
      ),
    );
    expect(accounts[0].accountLastFourDigits).toBeUndefined();
  });
});

// A fifteenth review pass.
describe("holdings, debts and totals a screen states plainly", () => {
  it.each([
    ["foreign first", ["美元", "500.00"], ["港元", "1,000.00"]],
    ["home first", ["港元", "1,000.00"], ["美元", "500.00"]],
  ])("keeps both currencies whichever is listed first (%s)", (_, a, b) => {
    // The unmarked converted-total guess dropped whichever holding happened to
    // be in the institution's home currency and listed second.
    const accounts = parseOcrBlocks(
      screen(row("汇丰One"), row(...a), row(...b)),
    );
    expect(accounts[0].balances).toHaveLength(2);
  });

  it("still drops a total the row says is an equivalent", () => {
    const accounts = parseOcrBlocks(
      screen(
        row("Global", "Savings", "Account"),
        row("CNY", "10,716.02"),
        row("USD", "0.00"),
        row("Equivalent", "in", "SGD", "2,009.85"),
      ),
    );
    expect(accounts[0].balances).toEqual([
      { currency: "CNY", balance: 10716.02 },
      { currency: "USD", balance: 0 },
    ]);
  });

  it("takes the debt from a row that also states the limit", () => {
    // Non-balance markers suppressed the whole row, so a card clustering both
    // labels onto one line reported no balance at all.
    const accounts = parseOcrBlocks(
      screen(
        row("OCBC", "365"),
        row("****", "1234"),
        row("信用额度", "10,000.00", "已用额度", "4,766.92"),
      ),
    );
    expect(accounts[0].balances).toEqual([
      { currency: "SGD", balance: -4766.92 },
    ]);
  });

  it("still takes nothing from a limit-only row", () => {
    const accounts = parseOcrBlocks(
      screen(
        row("OCBC", "365"),
        row("****", "1234"),
        row("信用额度", "10,000.00"),
      ),
    );
    expect(accounts[0].balances).toBeUndefined();
  });

  it("reads a total clustered with its change figure", () => {
    // The summary row carries the marker itself, so gating it on non-balance
    // markers let a chart axis label claim the slot instead.
    const accounts = parseOcrBlocks(
      screen(
        row("总资产估值", "44,503.83", "SGD", "今日变动", "-0.11"),
        row("52,417.55", "SGD"),
        row("27,012.77", "SGD"),
      ),
    );
    expect(accounts[0].balances).toEqual([
      { currency: "SGD", balance: 44503.83 },
    ]);
  });
});

// A sixteenth review pass.
describe("overlapping labels and recovered names", () => {
  it("does not add the minimum payment to the card's debt", () => {
    // "minimum amount due" contains the debt marker "amount due", so the 50.00
    // was negated onto the real 4,766.92. The longer match describes the row.
    const accounts = parseOcrBlocks(
      screen(
        row("OCBC", "365", "Credit", "Card"),
        row("••••", "4242"),
        row("Outstanding", "balance", "S$4,766.92"),
        row("Minimum", "amount", "due", "S$50.00"),
      ),
    );
    expect(accounts[0].balances).toEqual([
      { currency: "SGD", balance: -4766.92 },
    ]);
  });

  it("counts a card titled on its own balance row once", () => {
    // The amount path recovered the name but not the untruncated source the
    // repeat-absorb guard compares, so the repeat below opened a second
    // account and the balance was counted twice.
    const accounts = parseOcrBlocks(
      screen(
        row("Everyday", "Global", "Account", "SGD", "1,234.56"),
        row("Everyday", "Global", "Account"),
        row("SGD", "1,234.56"),
      ),
    );
    expect(accounts).toHaveLength(1);
    expect(accounts[0].balances).toEqual([
      { currency: "SGD", balance: 1234.56 },
    ]);
  });
});

// A seventeenth review pass — a nav word inside a real name.
describe("nav vocabulary is row-level, not word-level", () => {
  it.each([
    [["Home", "Loan"], "Home Loan"],
    [["Profile", "Savings"], "Profile Savings"],
  ])("keeps %s whole", (words, expected) => {
    // Every token of a multi-word name stands alone by construction, so the
    // row-level nav list ("home", "profile") was eating the first word.
    const accounts = parseOcrBlocks(
      screen(row(...words), row("SGD", "1,000.00")),
    );
    expect(accounts[0].accountName).toBe(expected);
  });

  it("still drops a nav row that names no account", () => {
    const accounts = parseOcrBlocks(
      screen(row("Savings", "Account"), row("SGD", "1,000.00"), row("Home")),
    );
    expect(accounts).toHaveLength(1);
    expect(accounts[0].accountName).toBe("Savings Account");
  });
});

// An eighteenth review pass.
describe("two labels on one row, and a rate beside a balance", () => {
  it.each([
    ["zh", ["您花了", "4,766.92", "SGD", "信用额度", "10,000.00", "SGD"]],
    ["en", ["You", "spent", "4,766.92", "SGD", "Credit", "limit", "10,000.00"]],
  ])("takes the debt when the two labels are unrelated (%s)", (_, cells) => {
    // Comparing raw marker LENGTHS across the two vocabularies suppressed the
    // row whenever the debt label happened to be the shorter word — and the
    // card lost its only balance.
    const accounts = parseOcrBlocks(screen(row("Card"), row(...cells)));
    expect(accounts[0].balances).toEqual([
      { currency: "SGD", balance: -4766.92 },
    ]);
  });

  it("drops a rate that trails the currency", () => {
    // The percentage exemption keyed on currency adjacency, and on a
    // trailing-currency layout the RATE is what sits next to the currency.
    const accounts = parseOcrBlocks(
      screen(row("Savings", "Account"), row("1,212.52", "HKD", "-0.51", "%")),
    );
    expect(accounts[0].balances).toEqual([
      { currency: "HKD", balance: 1212.52 },
    ]);
  });
});

// A nineteenth review pass.
describe("a signed currency token still marks its figure as money", () => {
  it("reads a one-decimal figure beside a signed currency token", () => {
    // The adjacency test didn't strip the leading "-", so "-S$" wasn't seen as
    // a currency and the figure lost the looser one-decimal shape — with no
    // other figure on the row, the account was dropped entirely.
    const accounts = parseOcrBlocks(
      screen(row("Bitget", "Wallet"), row("-S$", "403.3")),
    );
    expect(accounts[0].balances).toEqual([
      { currency: "SGD", balance: -403.3 },
    ]);
  });

  it("leaves the unsigned form positive", () => {
    const accounts = parseOcrBlocks(
      screen(row("Bitget", "Wallet"), row("S$", "403.3")),
    );
    expect(accounts[0].balances).toEqual([{ currency: "SGD", balance: 403.3 }]);
  });
});

// A twentieth review pass.
describe("two cards that print the same title", () => {
  it("keeps them apart when each has its own number", () => {
    // The repeat-absorb guard fired across an intervening card row, merging
    // the two: the second card's balance was added to the first and its last
    // four was discarded.
    const accounts = parseOcrBlocks(
      screen(
        row("Savings", "Account"),
        row("****", "1234"),
        row("SGD", "1,000.00"),
        row("Savings", "Account"),
        row("****", "5678"),
        row("SGD", "2,500.00"),
      ),
    );
    expect(accounts).toHaveLength(2);
    expect(accounts.map((a) => a.accountLastFourDigits)).toEqual([
      "1234",
      "5678",
    ]);
    expect(accounts.map((a) => a.balances?.[0].balance)).toEqual([1000, 2500]);
  });

  it("still absorbs a card that repeats its title above its balance", () => {
    const accounts = parseOcrBlocks(
      screen(
        row("Everyday", "Global", "Account"),
        row("145-742482-221"),
        row("Everyday", "Global", "Account"),
        row("5,624.00SGD"),
      ),
    );
    expect(accounts).toHaveLength(1);
    expect(accounts[0].balances).toEqual([{ currency: "SGD", balance: 5624 }]);
  });
});

// A figure followed by a bare "%" block is a percentage, with no exception.
describe("a split percentage is a percentage", () => {
  // The split-off "-0.51 %" case beside a balance is covered above by
  // "still drops a rate whose % was split off"; this block adds the case the
  // other one does not reach — a rate on a row of its own.
  it("reads a rate on its own row without touching the balance", () => {
    const accounts = parseOcrBlocks(
      screen(
        row("招商银行", "一卡通"),
        row("可用余额", "76,007.05"),
        row("利率", "3.50", "%"),
      ),
    );
    expect(accounts[0].balances).toEqual([
      { currency: "CNY", balance: 76007.05 },
    ]);
  });
});

// A twenty-second review pass.
describe("rows that look like something they are not", () => {
  it("does not read a product name as a sub-account count", () => {
    // `\d+\s+accounts?` matched OCBC's "360 Account", which cleared the
    // region's balances and then opened an account called "360 Account" as if
    // it were a count row.
    const accounts = parseOcrBlocks(
      screen(
        row("360", "Account"),
        row("SGD", "6,672.59"),
        row("借记卡", "4218-0803-2297-3829"),
      ),
    );
    expect(accounts).toHaveLength(1);
    expect(accounts[0].accountName).toBe("360 Account");
  });

  it("does not name an account after a real count row", () => {
    const accounts = parseOcrBlocks(
      screen(
        row("Everyday", "Global", "Account"),
        row("SGD", "74,987.99"),
        row("3", "accounts"),
        row("Savings", "SGD", "1,000.00"),
      ),
    );
    expect(accounts.every((a) => a.accountName !== "3 accounts")).toBe(true);
  });

  it("keeps reading past a tab bar that follows a stray figure", () => {
    // A figure above the tab bar opens a nameless placeholder region, and
    // counting that as "the account list has started" let the tab bar stop the
    // scan before the real account.
    const accounts = parseOcrBlocks(
      screen(
        row("$1,234.56"),
        row("Transactions", "Cards", "Rewards"),
        row("Savings", "Account"),
        row("SGD", "5,000.00"),
      ),
    );
    expect(accounts.some((a) => a.accountName === "Savings Account")).toBe(
      true,
    );
  });

  it("reads the currency code on the side the row puts them", () => {
    // Checking both neighbours made a currency-leading row read the NEXT
    // figure's unstorable code as this one's, dropping a real HKD balance.
    const accounts = parseOcrBlocks(
      screen(row("Savings", "Account"), row("HKD", "1,212.52", "JPY", "0.00")),
    );
    expect(accounts[0].balances).toEqual([
      { currency: "HKD", balance: 1212.52 },
    ]);
  });

  it("does not name an account after an unstorable currency code", () => {
    const accounts = parseOcrBlocks(
      screen(row("****", "1234"), row("1,212.52", "HKD", "0.00", "JPY")),
    );
    expect(accounts[0].accountName).toBeUndefined();
  });
});

// A twenty-third review pass.
describe("labels that are part of a name, products that are not labels", () => {
  it("keeps a label word that sits between two name words", () => {
    // "Balance" labels a value AND names products. Dropping it wherever it
    // appeared deleted one word from the middle of a real account name.
    const accounts = parseOcrBlocks(
      screen(row("Cash", "Balance", "Account"), row("SGD", "1,000.00")),
    );
    expect(accounts[0].accountName).toBe("Cash Balance Account");
  });

  it("still treats a leading label as the label of its figure", () => {
    const accounts = parseOcrBlocks(
      screen(row("360", "Account"), row("Available", "Balance", "S$1,000.00")),
    );
    expect(accounts).toHaveLength(1);
    expect(accounts[0].accountName).toBe("360 Account");
  });

  it("opens an account for 余额宝 rather than reading it as a 余额 label", () => {
    const accounts = parseOcrBlocks(
      screen(row("支付宝"), row("余额宝", "1,000.00")),
    );
    expect(accounts[0].accountName).toBe("余额宝");
  });

  it("stops at a 资产明细 breakdown of the assets above it", () => {
    // Alipay repeats the same money below this heading as per-product rows.
    const accounts = parseOcrBlocks(
      screen(
        row("稳健理财", "5,203.47"),
        row("资产明细"),
        row("余额宝", "5,203.47"),
      ),
    );
    expect(accounts).toHaveLength(1);
    expect(accounts[0].balances).toEqual([
      { currency: "CNY", balance: 5203.47 },
    ]);
  });
});

describe("a sign, a due amount, and a total the app cannot store", () => {
  it("signs a figure whose minus was OCR'd as its own token", () => {
    const accounts = parseOcrBlocks(
      screen(row("Card"), row("-", "4,766.92", "SGD")),
    );
    expect(accounts[0].balances).toEqual([
      { currency: "SGD", balance: -4766.92 },
    ]);
  });

  it("leaves a hyphen between two words alone", () => {
    const accounts = parseOcrBlocks(
      screen(row("Everyday", "Global", "-", "SGD", "1,234.56")),
    );
    expect(accounts[0].balances).toEqual([
      { currency: "SGD", balance: 1234.56 },
    ]);
  });

  it("keeps a debt marker its row's other label does not contain", () => {
    // "Minimum amount due" swallows "amount due", and cancelling every debt
    // marker on the row suppressed the row whole — losing the account.
    const accounts = parseOcrBlocks(
      screen(
        row("Credit", "Card"),
        row("Outstanding", "balance", "S$4,766.92"),
        row("Minimum", "amount", "due", "S$50.00"),
      ),
    );
    expect(accounts[0].balances).toEqual([
      { currency: "SGD", balance: -4766.92 },
    ]);
  });

  it("does not denominate an unstorable summary in the home currency", () => {
    // On a single-account overview the summary is the only balance path, so a
    // JPY total was being reported as ¥1,000 CNY.
    const accounts = parseOcrBlocks(
      screen(row("支付宝"), row("总资产"), row("1,000.00", "JPY")),
    );
    expect(accounts.some((a) => a.balances !== undefined)).toBe(false);
  });
});

describe("a card row's own words are identity and labels, not a name", () => {
  it("does not name an account after the last-four label beside it", () => {
    const accounts = parseOcrBlocks(
      screen(
        row("招商银行"),
        row("尾号7732", "龙卡通"),
        row("余额（元）10,922.04"),
      ),
    );
    expect(accounts[0].accountName).toBe("龙卡通");
    expect(accounts[0].accountLastFourDigits).toBe("7732");
  });

  it("does not name an account after the labels on a card row", () => {
    // "尾号7732 信用额度 10,000.00 已用额度 4,766.92" carries no title at all —
    // it was recognized as an account called "信用额度 已用额度".
    const accounts = parseOcrBlocks(
      screen(
        row("招商银行"),
        row("信用卡"),
        row("尾号7732", "信用额度", "10,000.00", "已用额度", "4,766.92"),
      ),
    );
    expect(accounts[0].accountName).toBeUndefined();
    expect(accounts[0].accountLastFourDigits).toBe("7732");
    // The limit stays out of it; only the labelled debt is the balance.
    expect(accounts[0].balances).toEqual([
      { currency: "CNY", balance: -4766.92 },
    ]);
  });
});

// A twenty-fourth review pass. Each of these lost, moved, or invented money.
describe("regions the screen shows once", () => {
  it("recovers a summary balance for a card titled below its number", () => {
    // Two regions — a masked card and the title under it — counted as two
    // accounts, so the single-account summary fallback stood down and the only
    // balance on screen was dropped.
    const accounts = parseOcrBlocks(
      screen(
        row("****", "9999"),
        row("Savings", "Account"),
        row("总资产"),
        row("44,503.83", "SGD"),
      ),
    );
    expect(accounts).toHaveLength(1);
    expect(accounts[0].accountName).toBe("Savings Account");
    expect(accounts[0].accountLastFourDigits).toBe("9999");
    expect(accounts[0].balances).toEqual([
      { currency: "SGD", balance: 44503.83 },
    ]);
  });

  it("still refuses to hand a whole screen's total to any one account", () => {
    // The total belongs to neither account, so neither gets it — but both are
    // still what the screen showed, and reporting them without figures leaves
    // the user two named drafts to fill instead of nothing at all.
    const accounts = parseOcrBlocks(
      screen(
        row("总资产"),
        row("SGD", "9,999.00"),
        row("Savings", "Account"),
        row("Current", "Account"),
      ),
    );
    expect(accounts.map((a) => a.accountName)).toEqual([
      "Savings Account",
      "Current Account",
    ]);
    expect(accounts.every((a) => a.balances === undefined)).toBe(true);
  });

  it("keeps two masked cards apart", () => {
    const accounts = parseOcrBlocks(
      screen(
        row("****", "9999"),
        row("SGD", "1,000.00"),
        row("****", "8888"),
        row("SGD", "2,000.00"),
      ),
    );
    expect(accounts).toHaveLength(2);
    expect(accounts.map((a) => a.accountLastFourDigits)).toEqual([
      "9999",
      "8888",
    ]);
  });

  it("still attaches a card printed in full under a titled account", () => {
    const accounts = parseOcrBlocks(
      screen(
        row("360", "Account"),
        row("SGD", "1,000.00"),
        row("借记卡", "4218-0803-2297-3829"),
      ),
    );
    expect(accounts).toHaveLength(1);
    expect(accounts[0].accountLastFourDigits).toBe("3829");
  });
});

describe("a figure takes the currency printed above it, not below", () => {
  it("does not denominate a domestic balance in a sub-account's currency", () => {
    // HSBC HK prints an unmarked HKD balance and then a 美元 sub-account. Read
    // forwards, the account's own 1,000.00 became USD and the two were summed.
    const accounts = parseOcrBlocks(
      screen(
        row("汇丰One"),
        row("可用余额", "1,000.00"),
        row("美元", "5,673.53"),
      ),
    );
    expect(accounts[0].balances).toEqual([
      { currency: "HKD", balance: 1000 },
      { currency: "USD", balance: 5673.53 },
    ]);
  });

  it("still reads a leading unmarked balance on an unknown institution", () => {
    const accounts = parseOcrBlocks(
      screen(
        row("Savings", "Account"),
        row("Available", "Balance", "1,000.00"),
        row("SGD", "2,000.00"),
      ),
    );
    expect(accounts[0].balances).toEqual([{ currency: "SGD", balance: 3000 }]);
  });
});

describe("money that must reach the account it belongs to", () => {
  it("hands the figure above a number-first account number to that account", () => {
    const accounts = parseOcrBlocks(
      screen(
        row("一卡通", "601-526-0984-7"),
        row("港元", "10,336.81"),
        row("HKD", "26.14"),
        row("保证金证券", "682-2-48564-2"),
      ),
    );
    expect(accounts).toHaveLength(2);
    expect(accounts[1].accountName).toBe("保证金证券");
    expect(accounts[1].balances).toEqual([{ currency: "HKD", balance: 26.14 }]);
  });

  it("signs a figure whose minus follows a bullet", () => {
    const accounts = parseOcrBlocks(
      screen(row("Card"), row("·", "-", "1,234.56", "SGD")),
    );
    expect(accounts[0].balances).toEqual([
      { currency: "SGD", balance: -1234.56 },
    ]);
  });

  it("keeps an account whose only balance is in an unstorable currency", () => {
    // Recognize everything visible; the form filters. Dropping the account left
    // the user nothing to correct.
    const accounts = parseOcrBlocks(
      screen(row("Savings", "Account"), row("JPY", "1,000.00")),
    );
    expect(accounts).toHaveLength(1);
    expect(accounts[0].accountName).toBe("Savings Account");
    expect(accounts[0].balances).toBeUndefined();
  });

  it("does not invent a balance for an action bar", () => {
    // A screen of nothing but a button bar has no account on it, and none is
    // read: the row keeps its name only because the last-resort rule prefers a
    // named draft over reporting nothing when NOTHING else survived (see
    // `groupIntoAccounts`' tail). What must never happen is a figure appearing
    // on it — and beside a real account, the bar is dropped entirely.
    const alone = parseOcrBlocks(
      screen(row("存入资金", "PayNow", "储蓄罐", "Statements")),
    );
    expect(alone.every((a) => a.balances === undefined)).toBe(true);

    const beside = parseOcrBlocks(
      screen(
        row("Savings", "Account"),
        row("SGD", "1,000.00"),
        row("存入资金", "PayNow", "储蓄罐", "Statements"),
      ),
    );
    expect(beside.map((a) => a.accountName)).toEqual(["Savings Account"]);
  });
});

// A twenty-fifth review pass.
describe("guards apply before a figure is handed to the next account", () => {
  it("does not bank a credit limit printed above a number-first account", () => {
    const accounts = parseOcrBlocks(
      screen(
        row("可用额度", "10,000.00"),
        row("一卡通", "601-526-0984-7"),
        row("港元", "1,234.56"),
      ),
    );
    expect(accounts[0].balances).toEqual([
      { currency: "HKD", balance: 1234.56 },
    ]);
  });

  it("keeps a debt's sign when the row is handed on", () => {
    const accounts = parseOcrBlocks(
      screen(
        row("已用额度", "4,766.92"),
        row("一卡通", "601-526-0984-7"),
        row("港元", "1,234.56"),
      ),
    );
    expect(accounts[0].balances).toEqual([
      { currency: "HKD", balance: -3532.36 },
    ]);
  });
});

describe("a separator has to be separating something", () => {
  it("does not read a decimal comma as thousands", () => {
    // "1,23" is how OCR renders "1.23" off a screen printing a decimal comma.
    // Stripped and parsed it became 123 and was summed into the balance.
    const accounts = parseOcrBlocks(
      screen(
        row("Savings", "Account"),
        row("可用余额", "1,23", "SGD", "5,000.00"),
      ),
    );
    expect(accounts[0].balances).toEqual([{ currency: "SGD", balance: 5000 }]);
  });

  it("still joins a figure OCR split at its separator", () => {
    const accounts = parseOcrBlocks(
      screen(row("Savings", "Account"), row("SGD", "6,", "672.59")),
    );
    expect(accounts[0].balances).toEqual([
      { currency: "SGD", balance: 6672.59 },
    ]);
  });

  it("reads a space-grouped figure inside one block, not across two", () => {
    // The space separator is ML Kit's, and it only applies within a block.
    expect(
      parseOcrBlocks(
        screen(row("Savings", "Account"), row("SGD", "1 100.00")),
      )[0].balances,
    ).toEqual([{ currency: "SGD", balance: 1100 }]);
    expect(
      parseOcrBlocks(screen(row("360", "Account"), row("360", "100.00")))[0]
        .balances,
    ).toEqual([{ currency: "SGD", balance: 100 }]);
  });
});

describe("a currency header that turns out not to head a table", () => {
  it("still gives its currency to the figures below it", () => {
    // "美元 美元 5,673.53" is one row on the corpus screen and two on a taller
    // one. Split, the header was dropped and the account with it.
    const accounts = parseOcrBlocks(
      screen(row("Global", "Account"), row("美元", "美元"), row("5,673.53")),
    );
    expect(accounts[0].balances).toEqual([
      { currency: "USD", balance: 5673.53 },
    ]);
  });
});

// A twenty-sixth review pass.
describe("a stated currency belongs to the row that states it", () => {
  it("does not carry a stray header's currency down the screen", () => {
    const accounts = parseOcrBlocks(
      screen(
        row("Global", "Savings", "Account"),
        row("美元", "美元"),
        row("5,673.53"),
        row("Statement", "Savings", "Account"),
        row("1,000.00"),
      ),
    );
    expect(accounts[0].balances).toEqual([
      { currency: "USD", balance: 5673.53 },
    ]);
    expect(accounts[1].balances).toEqual([{ currency: "SGD", balance: 1000 }]);
  });
});

describe("rows that only look like card numbers", () => {
  it("reads a balance beside a rule of dashes", () => {
    expect(classifyRow("Savings -------- 1,234.56")).toBe("amountRow");
  });

  it("does not read a footnote marker as a masked card", () => {
    expect(classifyRow("**Terms and conditions apply")).toBe("accountName");
    expect(classifyRow("**** 1234")).toBe("cardNumber");
    expect(classifyRow("•••• •••• ••••")).toBe("cardNumber");
  });
});

describe("a debt stated in the summary is still a debt", () => {
  it("signs a summary-only card balance", () => {
    const accounts = parseOcrBlocks(
      screen(row("总余额", "欠款", "4,766.92", "SGD")),
    );
    expect(accounts[0].balances).toEqual([
      { currency: "SGD", balance: -4766.92 },
    ]);
  });

  it("leaves an ordinary total positive", () => {
    const accounts = parseOcrBlocks(
      screen(row("总资产"), row("44,503.83", "SGD")),
    );
    expect(accounts[0].balances).toEqual([
      { currency: "SGD", balance: 44503.83 },
    ]);
  });

  it("takes the debt figure past a gain printed beside the label", () => {
    const accounts = parseOcrBlocks(
      screen(row("Card"), row("您花了", "+0.88", "4,766.92", "SGD")),
    );
    expect(accounts[0].balances).toEqual([
      { currency: "SGD", balance: -4766.92 },
    ]);
  });
});

describe("a one-decimal figure is money only when nothing better is on the row", () => {
  it("reads a wallet total that has no cents", () => {
    const accounts = parseOcrBlocks(
      screen(row("Bitget", "Wallet"), row("$403.3")),
    );
    expect(accounts[0].balances).toEqual([{ currency: "USD", balance: 403.3 }]);
  });

  it("is not fooled by an icon tag or a date before the currency", () => {
    expect(
      parseOcrBlocks(screen(row("360", "Account"), row("SGD", "403.3")))[0]
        .balances,
    ).toEqual([{ currency: "SGD", balance: 403.3 }]);
  });

  it("leaves a rate out of the balance beside it", () => {
    const accounts = parseOcrBlocks(
      screen(row("Fixed", "Deposit"), row("3.5", "SGD", "50,000.00")),
    );
    expect(accounts[0].balances).toEqual([{ currency: "SGD", balance: 50000 }]);
  });
});

describe("an account the app has no currency for still reaches the form", () => {
  it("survives both filters, not just the first", () => {
    const accounts = parseOcrBlocks(
      screen(row("Savings", "Account"), row("JPY", "1,000.00")),
    );
    expect(accounts).toHaveLength(1);
    expect(accounts[0].accountName).toBe("Savings Account");
    expect(accounts[0].balances).toBeUndefined();
  });
});

// A twenty-seventh review pass.
describe("a number-first account number opens its own account", () => {
  it("does not absorb an untitled number row into the account above", () => {
    const accounts = parseOcrBlocks(
      screen(
        row("一卡通", "601-526-0984-7"),
        row("港元", "HKD", "10,336.81"),
        row("HKD", "26.14"),
        row("682-2-48564-2"),
      ),
    );
    expect(accounts).toHaveLength(2);
    expect(accounts[0].balances).toEqual([
      { currency: "HKD", balance: 10336.81 },
    ]);
    expect(accounts[1].accountLastFourDigits).toBe("5642");
    expect(accounts[1].balances).toEqual([{ currency: "HKD", balance: 26.14 }]);
  });

  it("carries the name and the kind of the row it hands forward", () => {
    // Keeping only the pending balances lost the title — and with it the asset
    // kind, which is classified from the name alone.
    const accounts = parseOcrBlocks(
      screen(
        row("永隆银行"),
        row("保证金证券", "HKD", "26.14"),
        row("682-2-48564-2"),
      ),
    );
    expect(accounts[0].accountName).toBe("保证金证券");
    expect(accounts[0].kind).toBe("investment");
  });
});

describe("an unstorable-only region is a region", () => {
  it("is not overwritten by the next account's title", () => {
    const accounts = parseOcrBlocks(
      screen(
        row("JPY", "0.00"),
        row("Savings", "Account"),
        row("SGD", "1,234.56"),
      ),
    );
    expect(accounts).toHaveLength(2);
    expect(accounts[1].accountName).toBe("Savings Account");
  });

  it("is discarded with everything else by a sub-account count row", () => {
    expect(
      parseOcrBlocks(screen(row("JPY", "0.00"), row("3", "accounts"))),
    ).toEqual([]);
  });
});

describe("a currency names an account only when the screen repeats it", () => {
  it("does not name an account after a two-currency row", () => {
    const accounts = parseOcrBlocks(screen(row("SGD", "HKD", "1,000.00")));
    expect(accounts[0].accountName).toBeUndefined();
  });

  it("still reads a foreign-currency account's own title", () => {
    const accounts = parseOcrBlocks(screen(row("美元", "美元", "5,673.53")));
    expect(accounts[0].accountName).toBe("美元");
  });

  it("gives a card row the currency a header above it stated", () => {
    const accounts = parseOcrBlocks(
      screen(row("美元", "美元"), row("尾号7732", "1,234.56")),
    );
    expect(accounts[0].balances).toEqual([
      { currency: "USD", balance: 1234.56 },
    ]);
  });
});

// A twenty-eighth review pass.
describe("a multi-currency table is an account's balances", () => {
  it("reads one even when no account is open", () => {
    const accounts = parseOcrBlocks(
      screen(
        columns([
          ["SGD", 0.2],
          ["HKD", 0.5],
          ["USD", 0.8],
        ]),
        columns([
          ["100,554.59", 0.2],
          ["2,000.00", 0.5],
          ["300.00", 0.8],
        ]),
      ),
    );
    expect(accounts[0].balances).toEqual([
      { currency: "SGD", balance: 100554.59 },
      { currency: "HKD", balance: 2000 },
      { currency: "USD", balance: 300 },
    ]);
  });
});

describe("a currency code keeps its meaning through OCR noise", () => {
  it("still drops an unstorable figure whose code carries a stray glyph", () => {
    const accounts = parseOcrBlocks(
      screen(row("HKD", "0.00", "JPY、", "3,000.00")),
    );
    expect(accounts[0].balances).toEqual([{ currency: "HKD", balance: 0 }]);
    expect(accounts[0].accountName).toBeUndefined();
  });

  it("still reads a storable code that carries one", () => {
    const accounts = parseOcrBlocks(
      screen(row("Savings", "Account"), row("SGD、", "1,234.56")),
    );
    expect(accounts[0].balances).toEqual([
      { currency: "SGD", balance: 1234.56 },
    ]);
  });
});

describe("an account number sharing its row with another number", () => {
  it.each([
    ["结息期间 2025-2026 622848000123456", "cardNumber"],
    ["客服 400-820-8888 0193855038", "cardNumber"],
    ["结息期间 2025-2026", "accountName"],
  ])("%s → %s", (text, role) => {
    expect(classifyRow(text)).toBe(role);
  });
});

// A twenty-ninth review pass.
describe("a table read past the chrome beside it", () => {
  it("still pairs the columns when a chevron shares the header row", () => {
    const accounts = parseOcrBlocks(
      screen(
        row("DBS", "Multiplier", "Account"),
        columns([
          ["SGD", 0.2],
          ["HKD", 0.5],
          ["USD", 0.8],
          [">", 0.95],
        ]),
        columns([
          ["100.00", 0.2],
          ["200.00", 0.5],
          ["300.00", 0.8],
        ]),
      ),
    );
    expect(accounts[0].balances).toEqual([
      { currency: "SGD", balance: 100 },
      { currency: "HKD", balance: 200 },
      { currency: "USD", balance: 300 },
    ]);
  });
});

describe("a transaction list belongs to no account", () => {
  it("stops at the statement of an account titled only by its number", () => {
    const accounts = parseOcrBlocks(
      screen(
        row("****", "4242"),
        row("SGD", "1,000.00"),
        row("Transaction", "History"),
        row("Coffee", "SGD", "4.50"),
        row("Salary", "SGD", "5,000.00"),
      ),
    );
    expect(accounts).toHaveLength(1);
    expect(accounts[0].balances).toEqual([{ currency: "SGD", balance: 1000 }]);
    expect(accounts[0].accountName).toBeUndefined();
  });

  it("still reads past a tab bar above the first account", () => {
    const accounts = parseOcrBlocks(
      screen(
        row("$1,234.56"),
        row("Transactions", "Cards", "Rewards"),
        row("Savings", "Account"),
        row("SGD", "5,000.00"),
      ),
    );
    expect(accounts.some((a) => a.accountName === "Savings Account")).toBe(
      true,
    );
  });
});

describe("a number beside the account number is not the account number", () => {
  it.each([
    ["客服 400-820-8888 0193855038", "5038"],
    ["客服 13812345678 0193855038", "5038"],
  ])("%s → %s", (text, lastFour) => {
    const accounts = parseOcrBlocks(screen(row(...text.split(" "))));
    expect(accounts[0].accountLastFourDigits).toBe(lastFour);
  });
});

describe("money the recognizer cannot denominate still names its account", () => {
  it("keeps an account whose figure has no currency anywhere", () => {
    const accounts = parseOcrBlocks(
      screen(
        row("Savings", "Account"),
        row("Available", "Balance", "1,234.56"),
      ),
    );
    expect(accounts).toHaveLength(1);
    expect(accounts[0].accountName).toBe("Savings Account");
    expect(accounts[0].balances).toBeUndefined();
  });

  it("keeps a single-account overview whose only total is unstorable", () => {
    const accounts = parseOcrBlocks(
      screen(row("总资产"), row("JPY", "1,234.56")),
    );
    expect(accounts).toHaveLength(1);
    expect(accounts[0].balances).toBeUndefined();
  });
});

// A thirtieth review pass.
describe("a multi-currency table with a column the app cannot use", () => {
  it("reads the columns it can and skips the one it cannot", () => {
    const accounts = parseOcrBlocks(
      screen(
        row("Everyday", "Global", "Account"),
        columns([
          ["SGD", 0.2],
          ["HKD", 0.5],
          ["JPY", 0.8],
        ]),
        columns([
          ["1,000.00", 0.2],
          ["2,000.00", 0.5],
          ["3,000.00", 0.8],
        ]),
      ),
    );
    expect(accounts[0].balances).toEqual([
      { currency: "SGD", balance: 1000 },
      { currency: "HKD", balance: 2000 },
    ]);
  });

  it("reads one whose header carries a label column", () => {
    const accounts = parseOcrBlocks(
      screen(
        row("Everyday", "Global", "Account"),
        columns([
          ["币种", 0.05],
          ["SGD", 0.35],
          ["HKD", 0.6],
        ]),
        columns([
          ["0.00", 0.05],
          ["2,000.00", 0.35],
          ["3,000.00", 0.6],
        ]),
      ),
    );
    expect(accounts[0].balances).toEqual([
      { currency: "SGD", balance: 2000 },
      { currency: "HKD", balance: 3000 },
    ]);
  });

  it("does not open a region for a table of gains", () => {
    const accounts = parseOcrBlocks(
      screen(
        columns([
          ["SGD", 0.3],
          ["HKD", 0.7],
        ]),
        columns([
          ["+1,000.00", 0.3],
          ["+2,000.00", 0.7],
        ]),
        row("Savings", "Account"),
        row("SGD", "5,000.00"),
      ),
    );
    expect(accounts).toHaveLength(1);
    expect(accounts[0].accountName).toBe("Savings Account");
    expect(accounts[0].balances).toEqual([{ currency: "SGD", balance: 5000 }]);
  });
});

describe("an unstorable currency reads the same as a symbol or a code", () => {
  it.each([
    ["symbol", ["€1,234.56"]],
    ["code", ["EUR", "1,234.56"]],
  ])("keeps the account when the figure is a %s", (_label, texts) => {
    const accounts = parseOcrBlocks(
      screen(row("Savings", "Account"), row(...(texts as string[]))),
    );
    expect(accounts).toHaveLength(1);
    expect(accounts[0].accountName).toBe("Savings Account");
  });

  it("still drops an icon fragment", () => {
    const accounts = parseOcrBlocks(
      screen(row("Savings", "Account"), row("iR₩"), row("SGD", "1,000.00")),
    );
    expect(accounts[0].balances).toEqual([{ currency: "SGD", balance: 1000 }]);
  });
});

describe("a summary the app cannot denominate still reports its account", () => {
  it("survives a later label row in the summary block", () => {
    const accounts = parseOcrBlocks(
      screen(row("总资产"), row("JPY", "1,000.00"), row("可用余额")),
    );
    expect(accounts).toHaveLength(1);
  });

  it("survives a titled-but-empty region elsewhere on the screen", () => {
    const accounts = parseOcrBlocks(
      screen(row("总资产"), row("JPY", "1,000.00"), row("Savings", "Account")),
    );
    expect(accounts).toHaveLength(1);
  });
});

// A thirty-first review pass.
describe("a figure this parser cannot read reads as nothing", () => {
  it.each([
    ["a shifted thousands comma", "12,34.56"],
    ["an extra group", "1,23,456.78"],
    ["clipped cents", "1,234."],
  ])("does not take a sound-looking piece out of %s", (_label, text) => {
    const accounts = parseOcrBlocks(
      screen(row("Savings", "Account"), row("SGD", text)),
    );
    expect(accounts[0]?.balances).toBeUndefined();
  });
});

describe("a summary row is never a table header", () => {
  it("does not bank a grand total as the account's balance", () => {
    const accounts = parseOcrBlocks(
      screen(
        row("Savings", "Account"),
        row("Total", "SGD", "HKD"),
        row("1,000.00", "2,000.00"),
      ),
    );
    expect(accounts).toHaveLength(1);
    expect(accounts[0].accountName).toBe("Savings Account");
    expect(accounts[0].balances).toBeUndefined();
  });
});

describe("a total the app cannot denominate still reports its account", () => {
  it("keeps a wallet whose only figure states no currency", () => {
    const accounts = parseOcrBlocks(
      screen(row("Bitget"), row("Total", "assets"), row("44,503.83")),
    );
    expect(accounts).toHaveLength(1);
    expect(accounts[0].balances).toBeUndefined();
  });
});

// A thirty-second review pass.
describe("a title that contains a label word is still a title", () => {
  it("opens its own account", () => {
    const accounts = parseOcrBlocks(
      screen(
        row("Savings", "Account"),
        row("SGD", "1,000.00"),
        row("Zero", "Balance", "Account"),
        row("SGD", "2,000.00"),
      ),
    );
    expect(accounts.map((a) => a.accountName)).toEqual([
      "Savings Account",
      "Zero Balance Account",
    ]);
    expect(accounts[0].balances).toEqual([{ currency: "SGD", balance: 1000 }]);
  });

  it("still treats a row of only label words as a label", () => {
    expect(classifyRow("Available Balance")).toBe("amountRow");
    expect(classifyRow("可用余额")).toBe("amountRow");
  });
});

describe("a table row states balances or it states nothing", () => {
  it("does not bank a credit facility printed across columns", () => {
    const accounts = parseOcrBlocks(
      screen(
        row("Card"),
        columns([
          ["SGD", 0.3],
          ["HKD", 0.7],
        ]),
        columns([
          ["信用额度", 0.05],
          ["10,000.00", 0.3],
          ["5,000.00", 0.7],
        ]),
      ),
    );
    // The limit is not money, so no balance is reported. The card itself is
    // still on screen, so its name survives as a draft to fill in.
    expect(accounts.every((a) => a.balances === undefined)).toBe(true);
  });

  it("signs only the labelled column of a debt row", () => {
    // The same rule the ordinary path applies: the figure the label names is
    // the balance, and everything else on a card row is context (the limit, the
    // credit remaining). Negating every column read a debt and a limit as one
    // debt of both.
    const accounts = parseOcrBlocks(
      screen(
        row("Card"),
        columns([
          ["SGD", 0.3],
          ["HKD", 0.7],
        ]),
        columns([
          ["您花了", 0.05],
          ["1,000.00", 0.3],
          ["2,000.00", 0.7],
        ]),
      ),
    );
    expect(accounts[0].balances).toEqual([{ currency: "SGD", balance: -1000 }]);
  });

  it("reads a table whose columns are headed by symbols", () => {
    const accounts = parseOcrBlocks(
      screen(
        row("Savings", "Account"),
        columns([
          ["$", 0.3],
          ["HK$", 0.7],
        ]),
        columns([
          ["1,000.00", 0.3],
          ["2,000.00", 0.7],
        ]),
      ),
    );
    expect(accounts[0].balances).toEqual([
      { currency: "USD", balance: 1000 },
      { currency: "HKD", balance: 2000 },
    ]);
  });
});

describe("a card row that also names currencies is still a card row", () => {
  it("keeps its last four", () => {
    const accounts = parseOcrBlocks(
      screen(
        row("Savings", "Account"),
        row("尾号7732", "HKD", "USD"),
        row("HKD", "1,000.00"),
      ),
    );
    expect(accounts[0].accountLastFourDigits).toBe("7732");
  });
});

// A thirty-third review pass.
describe("an equivalent total is never a balance, on any row", () => {
  it("does not count it a second time from a card row", () => {
    const accounts = parseOcrBlocks(
      screen(
        row("Everyday", "Global", "Account"),
        row(
          "••••",
          "1234",
          "HKD",
          "500.00",
          "Equivalent",
          "in",
          "SGD",
          "2,009.85",
        ),
      ),
    );
    expect(accounts[0].accountLastFourDigits).toBe("1234");
    expect(accounts[0].balances).toBeUndefined();
  });
});

describe("a product name that contains a label word keeps its name", () => {
  it.each([
    ["BalanceMax", ["BalanceMax", "5,000.00", "SGD"], "BalanceMax"],
    ["净值型理财", ["净值型理财", "1,234.56", "CNY"], "净值型理财"],
  ])("%s", (_label, texts, expected) => {
    const accounts = parseOcrBlocks(screen(row(...(texts as string[]))));
    expect(accounts[0].accountName).toBe(expected);
  });

  it("still reads a fused label token as a label", () => {
    const accounts = parseOcrBlocks(
      screen(
        row("Savings", "Account"),
        row("Available Balance", "1,234.56", "SGD"),
      ),
    );
    expect(accounts[0].accountName).toBe("Savings Account");
  });
});

describe("a screen whose figures could not be read still names its accounts", () => {
  it("reports the title rather than nothing", () => {
    const accounts = parseOcrBlocks(
      screen(row("Statement", "Savings", "Account"), row("SGD", "12,34.56")),
    );
    expect(accounts.map((a) => a.accountName)).toEqual([
      "Statement Savings Account",
    ]);
    expect(accounts[0].balances).toBeUndefined();
  });

  it("drops the junk beside an account that WAS read", () => {
    const accounts = parseOcrBlocks(
      screen(
        row("Total", "SGD", "10,000.00"),
        row("Savings", "Account"),
        row("SGD", "6,000.00"),
        row("存入资金", "PayNow", "Statements"),
      ),
    );
    expect(accounts.map((a) => a.accountName)).toEqual(["Savings Account"]);
  });
});

// A thirty-fourth review pass.
describe("a figure OCR split across blocks", () => {
  it("joins one whose first piece carries the currency", () => {
    const accounts = parseOcrBlocks(
      screen(row("OCBC"), row("360", "Account"), row("S$5,", "000.00")),
    );
    expect(accounts[0].balances).toEqual([{ currency: "SGD", balance: 5000 }]);
  });

  it("joins one whose first piece carries the sign", () => {
    // The sign is the point: unmerged, the trailing half read as a standalone
    // +234.56 — a debt reported as an asset.
    const accounts = parseOcrBlocks(
      screen(row("Card"), row("SGD", "-1,", "234.56")),
    );
    expect(accounts[0].balances).toEqual([
      { currency: "SGD", balance: -1234.56 },
    ]);
  });

  it("joins one split three ways", () => {
    const accounts = parseOcrBlocks(
      screen(row("OCBC"), row("360", "Account"), row("1,", "234,", "567.89")),
    );
    expect(accounts[0].balances).toEqual([
      { currency: "SGD", balance: 1234567.89 },
    ]);
  });

  it("still joins the plain two-piece split", () => {
    const accounts = parseOcrBlocks(
      screen(row("Savings", "Account"), row("SGD", "6,", "672.59")),
    );
    expect(accounts[0].balances).toEqual([
      { currency: "SGD", balance: 6672.59 },
    ]);
  });
});

describe("a summary heading is a summary, product noun or not", () => {
  it.each([
    "Total Balance",
    "Total Portfolio",
    "Total Funds",
    "Total Card Balance",
    "总资产",
  ])("%s", (text) => {
    expect(classifyRow(text)).toBe("summaryRow");
  });

  it("does not add the screen's total to the accounts under it", () => {
    // The account-keyword escape the label branch uses cannot be applied here:
    // the keyword list is generic product nouns, so every heading above would
    // become a title and bank the grand total as a second account. A product
    // genuinely titled "Total …" loses its NAME instead, and its figure still
    // reaches the user through the summary fallback.
    const accounts = parseOcrBlocks(
      screen(
        row("Total", "Card", "Balance"),
        row("SGD", "99,999.00"),
        row("360", "Account"),
        row("SGD", "1,234.56"),
      ),
    );
    expect(accounts.map((a) => a.accountName)).toEqual(["360 Account"]);
    expect(accounts[0].balances).toEqual([
      { currency: "SGD", balance: 1234.56 },
    ]);
  });
});

// A thirty-fifth review pass.
describe("a bare percent sign drops the figure, not the row", () => {
  it("leaves the row's currency alone", () => {
    const accounts = parseOcrBlocks(
      screen(row("Savings", "Account"), row("SGD", "%", "1,234.56")),
    );
    expect(accounts[0].balances).toEqual([
      { currency: "SGD", balance: 1234.56 },
    ]);
  });

  it("still drops a rate split from its sign", () => {
    const accounts = parseOcrBlocks(
      screen(row("Savings", "Account"), row("SGD", "1,234.56", "3.5", "%")),
    );
    expect(accounts[0].balances).toEqual([
      { currency: "SGD", balance: 1234.56 },
    ]);
  });
});

describe("a summary row is not a table's values", () => {
  it("does not bank the screen's total as per-currency balances", () => {
    const accounts = parseOcrBlocks(
      screen(
        row("Savings", "Account"),
        columns([
          ["SGD", 0.3],
          ["HKD", 0.7],
        ]),
        columns([
          ["100.00", 0.3],
          ["200.00", 0.6],
          ["Total", 0.9],
        ]),
      ),
    );
    expect(accounts[0].balances).toBeUndefined();
  });
});

// A thirty-sixth review pass.
describe("a sign OCR split from its figure", () => {
  it("keeps the sign when the figure is split three ways", () => {
    const accounts = parseOcrBlocks(
      screen(row("Live+", "Card"), row("-", "1,", "745.52", "SGD")),
    );
    expect(accounts[0].balances).toEqual([
      { currency: "SGD", balance: -1745.52 },
    ]);
  });

  it("keeps the sign whatever currency the row states", () => {
    for (const symbol of ["$", "S$", "HK$", "CN¥"]) {
      const accounts = parseOcrBlocks(
        screen(row("Card"), row(symbol, "-", "1,234.56")),
      );
      expect(accounts[0].balances?.[0].balance).toBe(-1234.56);
    }
  });

  it("still reads a hyphen between two fields as a separator", () => {
    const accounts = parseOcrBlocks(
      screen(row("Everyday", "Global", "-", "SGD", "1,234.56")),
    );
    expect(accounts[0].balances).toEqual([
      { currency: "SGD", balance: 1234.56 },
    ]);
  });
});

describe("a title that lists its currencies is still a title", () => {
  it("keeps its name", () => {
    const accounts = parseOcrBlocks(
      screen(
        row("Everyday", "Global", "Account", "SGD", "USD"),
        row("SGD", "1,234.56"),
      ),
    );
    expect(accounts[0].accountName).toBe("Everyday Global Account");
  });
});

// A thirty-seventh review pass.
describe("a sign the screen printed before its currency", () => {
  it("folds either way round", () => {
    for (const balanceRow of [
      row("-", "S$", "1,234.56"),
      row("S$", "-", "1,234.56"),
    ]) {
      const accounts = parseOcrBlocks(screen(row("Card"), balanceRow));
      expect(accounts[0].balances).toEqual([
        { currency: "SGD", balance: -1234.56 },
      ]);
    }
  });

  it("reads a typographic minus as a minus", () => {
    // Apple Vision emits U+2212 for a real minus glyph; every sign rule in the
    // engine tests ASCII, so it was dropped as noise and the debt read as an
    // asset.
    const accounts = parseOcrBlocks(
      screen(row("Card"), row("SGD", "−1,745.52")),
    );
    expect(accounts[0].balances).toEqual([
      { currency: "SGD", balance: -1745.52 },
    ]);
  });
});

describe("a multi-currency table with a column missing", () => {
  it("keeps the columns that line up", () => {
    const accounts = parseOcrBlocks(
      screen(
        row("Savings", "Account"),
        columns([
          ["SGD", 0.2],
          ["HKD", 0.5],
          ["USD", 0.8],
        ]),
        columns([
          ["100.00", 0.2],
          ["300.00", 0.8],
        ]),
      ),
    );
    expect(accounts[0].balances).toEqual([
      { currency: "SGD", balance: 100 },
      { currency: "USD", balance: 300 },
    ]);
  });

  it("is still not a table when no column states a figure", () => {
    const accounts = parseOcrBlocks(
      screen(
        row("Savings", "Account"),
        columns([
          ["SGD", 0.2],
          ["HKD", 0.5],
        ]),
        columns([
          ["Available", 0.2],
          ["Pending", 0.5],
        ]),
      ),
    );
    expect(accounts[0].balances).toBeUndefined();
  });
});

// A thirty-eighth review pass.
describe("a table column the app cannot store", () => {
  it("counts toward the table but contributes no balance", () => {
    const accounts = parseOcrBlocks(
      screen(
        row("OCBC"),
        row("360", "Account"),
        columns([
          ["SGD", 0.3],
          ["JPY", 0.7],
        ]),
        columns([
          ["100.00", 0.3],
          ["5,000.00", 0.7],
        ]),
      ),
    );
    expect(accounts[0].balances).toEqual([{ currency: "SGD", balance: 100 }]);
  });

  it("keeps an account whose every column is unstorable", () => {
    const accounts = parseOcrBlocks(
      screen(
        row("Savings", "Account"),
        columns([
          ["JPY", 0.3],
          ["KRW", 0.7],
        ]),
        columns([
          ["5,000.00", 0.3],
          ["600.00", 0.7],
        ]),
      ),
    );
    expect(accounts).toHaveLength(1);
    expect(accounts[0].balances).toBeUndefined();
  });
});

describe("a row that titles an account and heads its columns", () => {
  it("does both", () => {
    const accounts = parseOcrBlocks(
      screen(
        row("永隆银行"),
        columns([
          ["一卡通", 0.1],
          ["HKD", 0.4],
          ["USD", 0.7],
        ]),
        columns([
          ["1,000.00", 0.4],
          ["200.00", 0.7],
        ]),
      ),
    );
    expect(accounts[0].accountName).toBe("一卡通");
    expect(accounts[0].balances).toEqual([
      { currency: "HKD", balance: 1000 },
      { currency: "USD", balance: 200 },
    ]);
  });
});

describe("a label sharing the value row", () => {
  it("does not claim a column from the figure beside it", () => {
    const accounts = parseOcrBlocks(
      screen(
        row("OCBC"),
        row("360", "Account"),
        columns([
          ["SGD", 0.2],
          ["HKD", 0.5],
          ["USD", 0.8],
        ]),
        columns([
          ["Available", 0.19],
          ["100.00", 0.26],
          ["0.00", 0.5],
          ["0.00", 0.8],
        ]),
      ),
    );
    expect(accounts[0].balances).toEqual([
      { currency: "SGD", balance: 100 },
      { currency: "HKD", balance: 0 },
      { currency: "USD", balance: 0 },
    ]);
  });
});

// A thirty-ninth review pass.
describe("a figure with its currency code glued on", () => {
  it("reads every one on the row, not just the first", () => {
    // HSBC prints codes glued ("0.00HKD", "-1,745.52SGD"); the row-level scan
    // reports only the FIRST mention, so the second figure lost its currency,
    // failed the end-anchored shape test, and was offered as the account NAME.
    const accounts = parseOcrBlocks(
      screen(row("Savings", "Account"), row("1,212.52HKD", "500.00USD")),
    );
    expect(accounts[0].accountName).toBe("Savings Account");
    expect(accounts[0].balances).toEqual([
      { currency: "HKD", balance: 1212.52 },
      { currency: "USD", balance: 500 },
    ]);
  });

  it("treats a glued unstorable code as unstorable", () => {
    const accounts = parseOcrBlocks(
      screen(row("Savings", "Account"), row("1,212.52HKD", "0.00JPY")),
    );
    expect(accounts[0].accountName).toBe("Savings Account");
    expect(accounts[0].balances).toEqual([
      { currency: "HKD", balance: 1212.52 },
    ]);
  });
});

describe("a table column takes the figure printed under it", () => {
  it("does not let an earlier column steal it", () => {
    const accounts = parseOcrBlocks(
      screen(
        row("Savings", "Account"),
        columns([
          ["SGD", 0.36],
          ["HKD", 0.44],
        ]),
        columns([["1,000.00", 0.43]]),
      ),
    );
    expect(accounts[0].balances).toEqual([{ currency: "HKD", balance: 1000 }]);
  });
});

describe("a foreign-currency account titled by its own currency", () => {
  it("keeps its name when OCR splits the figure onto the next row", () => {
    const accounts = parseOcrBlocks(
      screen(row("美元", "美元"), row("5,673.53")),
    );
    expect(accounts[0].accountName).toBe("美元");
    expect(accounts[0].balances).toEqual([
      { currency: "USD", balance: 5673.53 },
    ]);
  });
});

// A fortieth review pass.
describe("a table column keeps its own figure", () => {
  it("does not let a day's change consume a column", () => {
    const accounts = parseOcrBlocks(
      screen(
        row("Savings", "Account"),
        columns([
          ["SGD", 0.3],
          ["USD", 0.7],
        ]),
        columns([
          ["+0.88", 0.31],
          ["1,234.56", 0.36],
          ["500.00", 0.7],
        ]),
      ),
    );
    expect(accounts[0].balances).toEqual([
      { currency: "SGD", balance: 1234.56 },
      { currency: "USD", balance: 500 },
    ]);
  });

  it("does not read a rate the classifier rejected", () => {
    const accounts = parseOcrBlocks(
      screen(
        row("Savings", "Account"),
        columns([
          ["SGD", 0.3],
          ["USD", 0.7],
        ]),
        columns([
          ["1,234.56", 0.3],
          ["-0.51", 0.58],
          ["%", 0.66],
        ]),
      ),
    );
    expect(accounts[0].balances).toEqual([
      { currency: "SGD", balance: 1234.56 },
    ]);
  });

  it("negates the debt column, not every column printing that figure", () => {
    const accounts = parseOcrBlocks(
      screen(
        row("Card"),
        columns([
          ["HKD", 0.3],
          ["USD", 0.6],
        ]),
        columns([
          ["已用额度", 0.05],
          ["100.00", 0.3],
          ["100.00", 0.6],
        ]),
      ),
    );
    expect(accounts[0].balances).toEqual([{ currency: "HKD", balance: -100 }]);
  });
});

describe("a minus glued to the currency symbol", () => {
  it("survives however OCR splits the figure", () => {
    for (const balanceRow of [
      row("-S$", "1,745.52"),
      row("-S$", "1,", "745.52"),
      row("-", "S$", "1,", "745.52"),
    ]) {
      const accounts = parseOcrBlocks(screen(row("Card"), balanceRow));
      expect(accounts[0].balances).toEqual([
        { currency: "SGD", balance: -1745.52 },
      ]);
    }
  });
});

describe("a currency-titled account behind a stray glyph", () => {
  it("still takes its name", () => {
    const accounts = parseOcrBlocks(
      screen(row("·", "美元", "美元", "5,673.53")),
    );
    expect(accounts[0].accountName).toBe("美元");
  });
});

// A forty-first review pass.
describe("a value row that carries identity as well as figures", () => {
  it("keeps the card number printed beside its columns", () => {
    const accounts = parseOcrBlocks(
      screen(
        columns([
          ["HKD", 0.4],
          ["USD", 0.8],
        ]),
        columns([
          ["••••", 0.05],
          ["1234", 0.12],
          ["1,000.00", 0.4],
          ["500.00", 0.8],
        ]),
      ),
    );
    expect(accounts[0].accountLastFourDigits).toBe("1234");
    expect(accounts[0].balances).toEqual([
      { currency: "HKD", balance: 1000 },
      { currency: "USD", balance: 500 },
    ]);
  });

  it("keeps the title printed beside them", () => {
    const accounts = parseOcrBlocks(
      screen(
        columns([
          ["HKD", 0.4],
          ["USD", 0.8],
        ]),
        columns([
          ["Savings", 0.05],
          ["1,000.00", 0.4],
          ["500.00", 0.8],
        ]),
      ),
    );
    expect(accounts[0].accountName).toBe("Savings");
  });
});

describe("a header that names a currency the app cannot store", () => {
  it("does not denominate the whole row in the storable one", () => {
    const accounts = parseOcrBlocks(
      screen(
        row("Savings", "Account"),
        columns([
          ["SGD", 0.1],
          ["JPY", 0.9],
        ]),
        columns([
          ["100.00", 0.45],
          ["5,000.00", 0.55],
        ]),
      ),
    );
    expect(accounts[0].balances).toBeUndefined();
  });
});

describe("a balance printed under its label", () => {
  it("keeps a minus split off from the figure", () => {
    for (const label of [
      row("Available", "Balance", "-", "S$", "1,", "745.52"),
      row("可用余额", "-", "S$", "1,745.52"),
    ]) {
      const accounts = parseOcrBlocks(screen(row("Card"), label));
      expect(accounts[0].balances).toEqual([
        { currency: "SGD", balance: -1745.52 },
      ]);
    }
  });
});

// A forty-second review pass.
describe("an account keyword is a word, not a substring", () => {
  it("does not open an account from a disclaimer", () => {
    const accounts = parseOcrBlocks(
      screen(
        row("Savings", "Account"),
        row("SGD", "1,234.56"),
        row("Refund", "policy"),
      ),
    );
    expect(accounts.map((a) => a.accountName)).toEqual(["Savings Account"]);
  });

  it("does not name an account after a card brand", () => {
    const accounts = parseOcrBlocks(
      screen(row("Mastercard", "promotions"), row("SGD", "50.00")),
    );
    expect(accounts[0].accountName).toBeUndefined();
  });
});

describe("an ISO code is a code, not an English word", () => {
  it("keeps a balance beside a word that spells one", () => {
    const accounts = parseOcrBlocks(
      screen(row("Savings", "Account"), row("Try", "SGD", "1,234.56")),
    );
    expect(accounts[0].balances).toEqual([
      { currency: "SGD", balance: 1234.56 },
    ]);
  });

  it("still drops a figure beside a real unstorable code", () => {
    const accounts = parseOcrBlocks(
      screen(row("Savings", "Account"), row("HKD", "1,212.52", "JPY", "0.00")),
    );
    expect(accounts[0].balances).toEqual([
      { currency: "HKD", balance: 1212.52 },
    ]);
  });
});

// A forty-fourth review pass: an English debt label spans OCR blocks.
describe("a debt label that spans several blocks", () => {
  it("takes the figure the label names, not the row's first one", () => {
    // The credit LIMIT is printed first and is not the card's balance. Asked
    // per token, no English marker ever matched (they are all multi-word), so
    // the leftmost figure was taken and the card reported -10,000.
    const accounts = parseOcrBlocks(
      screen(
        row("Credit", "Card"),
        row("Credit", "limit", "S$10,000.00", "Amount", "owed", "S$4,766.92"),
      ),
    );
    expect(accounts[0].balances).toEqual([
      { currency: "SGD", balance: -4766.92 },
    ]);
  });

  it("skips a marker swallowed by a payment-obligation label", () => {
    // "Minimum amount due" contains "amount due" — the debt is the OTHER
    // figure, which is the rule `statesDebt` already applied per row and the
    // index lookup now shares.
    const accounts = parseOcrBlocks(
      screen(
        row("Credit", "Card"),
        row(
          "Minimum",
          "amount",
          "due",
          "S$50.00",
          "Outstanding",
          "balance",
          "S$4,766.92",
        ),
      ),
    );
    expect(accounts[0].balances).toEqual([
      { currency: "SGD", balance: -4766.92 },
    ]);
  });

  it("leaves a row with no debt label positive", () => {
    const accounts = parseOcrBlocks(
      screen(row("Savings"), row("Available", "balance", "S$1,234.56")),
    );
    expect(accounts[0].balances).toEqual([
      { currency: "SGD", balance: 1234.56 },
    ]);
  });
});

// A sub-account row that names its currency in Chinese words, fused to its own
// label. HSBC HK prints exactly this, and only the ISO code the OCR happened to
// fuse onto some of the figures ("0.01USD") kept those rows from being read in
// the institution's home currency.
describe("a row labelled with a currency name", () => {
  it("denominates its figure by the name, not the institution's default", () => {
    const accounts = parseOcrBlocks(
      screen(
        row("汇丰One"),
        row("港元储蓄", "62,612.59"),
        row("美元储蓄", "0.01"),
      ),
    );
    expect(accounts[0].balances).toEqual([
      { currency: "HKD", balance: 62612.59 },
      { currency: "USD", balance: 0.01 },
    ]);
  });

  it("keeps the figure on an institution with no home currency", () => {
    // Undenominated, this money was dropped outright and the account came back
    // holding nothing.
    const accounts = parseOcrBlocks(
      screen(row("Savings", "Account"), row("美元储蓄", "1,212.52")),
    );
    expect(accounts[0].balances).toEqual([
      { currency: "USD", balance: 1212.52 },
    ]);
  });

  it("ignores a currency named at the END of a card's name", () => {
    // "汇丰Pulse银联双币钻石卡-人民币" is a card name, not a CNY sub-account.
    const accounts = parseOcrBlocks(
      screen(
        row("汇丰Pulse银联双币钻石卡-人民币"),
        row("可用余额", "1,000.00"),
      ),
    );
    expect(accounts[0].balances).toEqual([{ currency: "HKD", balance: 1000 }]);
  });
});

// A forty-sixth review pass: a navigation bar between a title and its balance
// must not become the account.
describe("scaffolding between a title and its balance", () => {
  it("keeps the account the screen titled", () => {
    const accounts = parseOcrBlocks(
      screen(
        row("DBS", "Multiplier", "Account"),
        row("Accounts", "Cards", "Transfers"),
        row("SGD", "100,554.59"),
      ),
    );
    expect(accounts).toEqual([
      expect.objectContaining({
        accountName: "DBS Multiplier Account",
        balances: [{ currency: "SGD", balance: 100554.59 }],
      }),
    ]);
  });

  it("keeps it when the bar is the real one this corpus records", () => {
    // Trust's action bar, verbatim from `trust-overview` — the only row in all
    // seventeen samples whose keyword verdict a plural-tolerant pattern flips.
    const accounts = parseOcrBlocks(
      screen(
        row("储蓄户口"),
        row("存入资金", "PayNow", "储蓄罐", "Statements"),
        row("2,845.42"),
      ),
    );
    expect(accounts[0].accountName).toBe("储蓄户口");
  });
});

describe("summed sub-account balances", () => {
  it("carries no binary-float noise into the form", () => {
    // 1,212.52 + 5,673.53 is 6886.049999999999 in IEEE-754, and that is what
    // the balance field pre-filled and the account stored.
    const accounts = parseOcrBlocks(
      screen(
        row("汇丰One"),
        row("港元储蓄", "1,212.52"),
        row("港元往来", "5,673.53"),
      ),
    );
    expect(accounts[0].balances).toEqual([
      { currency: "HKD", balance: 6886.05 },
    ]);
  });
});
