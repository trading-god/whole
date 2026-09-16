// The synthetic corpus: one spec per layout family × market the real corpus
// cannot reach.
//
// Institution names and product vocabulary are real, and deliberately so: the
// annotation turn's whole premise is that a model knows what "Total Checking"
// or "朝朝宝" implies about a screen, and a corpus of invented banks could not
// test that. What is NOT real is the layout — each screen is a model of a
// family (name-and-figure on one row, a currency table, a broker's metric
// shelf), not a reproduction of any company's actual UI, and nothing here
// renders a logo, a typeface or a colour anybody owns. See `spec.ts` for the
// argument, and `packages/ocr-eval/README.md` for what a score over this corpus
// is and is not evidence of.
//
// Coverage is by FAMILY, not by brand count. Adding a fifteenth US bank that
// lays its screen out like the first one measures nothing; adding the first
// screen that prints its figures with no currency at all measures the whole
// home-currency question.
import type { ScreenSpec } from "./spec";

const SPECS: ScreenSpec[] = [
  // The failure that motivated this corpus. Four accounts, each on one row with
  // its figure — and a product genuinely named "Total Checking", which the
  // summary-row rule claims before it can ever open an account.
  {
    slug: "us-chase-overview",
    institution: { name: "Chase" },
    market: "US retail",
    layout: "sectioned-list",
    amountStyle: "symbol-prefix",
    negativeStyle: "minus-outside",
    header: { title: "Good morning, Jack", subtitle: "Wednesday, March 12" },
    sections: [
      {
        title: "CHECKING",
        accounts: [
          {
            name: "Total Checking",
            lastFour: "4821",
            balances: [{ currency: "USD", balance: 3204.57 }],
            caption: "Available balance",
          },
        ],
      },
      {
        title: "SAVINGS",
        accounts: [
          {
            name: "Premier Savings",
            lastFour: "9033",
            balances: [{ currency: "USD", balance: 18750 }],
            caption: "Available balance",
          },
          {
            name: "Certificate of Deposit",
            lastFour: "2207",
            balances: [{ currency: "USD", balance: 25000 }],
            caption: "Matures Sep 30, 2026",
          },
        ],
      },
      {
        title: "CREDIT CARDS",
        accounts: [
          {
            name: "Sapphire Reserve",
            lastFour: "1129",
            balances: [{ currency: "USD", balance: -1482.36 }],
            caption: "Current balance",
            details: [{ label: "Available credit", value: "$8,517.64" }],
          },
        ],
      },
    ],
    tabs: ["Accounts", "Pay & transfer", "Plan & track", "Explore"],
  },

  // The same family with a screen-level total above it, which is the row a
  // parser most often banks as an account — and a debit marker instead of a
  // sign, so the card's debt survives only if `debtMarkers` reads "DR".
  {
    slug: "us-bofa-summary",
    institution: { name: "Bank of America" },
    market: "US retail",
    layout: "sectioned-list",
    amountStyle: "symbol-prefix",
    negativeStyle: "dr-suffix",
    header: { title: "Accounts" },
    summary: { label: "Total balance", value: 46281.19, currency: "USD" },
    sections: [
      {
        title: "DEPOSITS",
        accounts: [
          {
            name: "Advantage Plus Banking",
            lastFour: "7714",
            balances: [{ currency: "USD", balance: 12043.88 }],
            caption: "Available balance",
          },
          {
            name: "Advantage Savings",
            lastFour: "5590",
            balances: [{ currency: "USD", balance: 36130.4 }],
            caption: "Available balance",
          },
        ],
      },
      {
        title: "CREDIT CARDS",
        accounts: [
          {
            name: "Customized Cash Rewards",
            lastFour: "3388",
            balances: [{ currency: "USD", balance: -1893.09 }],
            caption: "Current balance",
            details: [{ label: "Total credit limit", value: "$15,000.00" }],
          },
        ],
      },
    ],
    tabs: ["Accounts", "Transfer", "Deals", "Menu"],
  },

  // A domestic app that names no currency anywhere. Everything the engine can
  // read here is denominated by inference or not at all, which is the single
  // largest thing a missing institution config costs.
  {
    slug: "cn-icbc-overview",
    institution: { name: "中国工商银行", printed: false },
    market: "CN retail",
    layout: "stacked-cards",
    script: "cjk",
    amountStyle: "bare",
    header: { title: "我的账户" },
    sections: [
      {
        title: "储蓄账户",
        accounts: [
          {
            name: "灵通快线",
            lastFour: "6612",
            numberText: "尾号 6612",
            balances: [{ currency: "CNY", balance: 82415.3 }],
            caption: "可用余额",
          },
          {
            name: "定活通",
            lastFour: "4408",
            numberText: "尾号 4408",
            balances: [{ currency: "CNY", balance: 150000 }],
            caption: "可用余额",
          },
        ],
      },
      {
        title: "投资理财",
        accounts: [
          {
            name: "如意人生",
            kind: "investment",
            balances: [{ currency: "CNY", balance: 63280.77 }],
            caption: "持仓市值",
          },
        ],
      },
    ],
    tabs: ["首页", "转账", "理财", "我的"],
  },

  // A credit card stated as an amount OWED rather than as a negative. The sign
  // is load-bearing all the way to the net-worth total, and nothing on this
  // screen carries a minus.
  {
    slug: "cn-cmb-card-owed",
    institution: { name: "招商银行信用卡", printed: false },
    market: "CN credit card",
    layout: "stacked-cards",
    script: "cjk",
    amountStyle: "bare",
    negativeStyle: "owed-label",
    header: { title: "我的卡片" },
    sections: [
      {
        accounts: [
          {
            name: "经典白金卡",
            lastFour: "8802",
            numberText: "尾号 8802",
            balances: [{ currency: "CNY", balance: -12874.55 }],
            caption: "本期应还",
            details: [
              { label: "可用额度", value: "37,125.45" },
              { label: "账单日", value: "每月 5 日" },
            ],
          },
        ],
      },
    ],
    tabs: ["首页", "账单", "分期", "我的"],
  },

  // A currency table with a column the app cannot store. The header names the
  // columns and the row beneath states what is in them, so the only thing that
  // says which figure is which currency is column alignment.
  {
    slug: "hk-scb-multicurrency",
    institution: { name: "Standard Chartered Hong Kong" },
    market: "HK retail",
    layout: "currency-table",
    amountStyle: "symbol-prefix",
    sections: [
      {
        title: "SAVINGS",
        accounts: [
          {
            name: "Integrated Savings",
            lastFour: "3071",
            numberText: "360-1-227 3071",
            caption: "Available",
            balances: [
              { currency: "HKD", balance: 214880.65 },
              { currency: "USD", balance: 9420.11 },
              { currency: "CNY", balance: 0 },
              { currency: "HKD", balance: 51200, printedAs: "JPY" },
            ],
          },
        ],
      },
    ],
    tabs: ["Home", "Transfer", "Invest", "More"],
  },

  // A broker. The metric shelf beneath the net figure is a column of perfectly
  // well-formed money that is not a balance — buying power, maintenance margin,
  // day P/L — and the account's base currency is a user setting rather than a
  // fact about the institution, which is why the prompt offers "none".
  {
    slug: "us-ibkr-portfolio",
    institution: { name: "Interactive Brokers" },
    market: "US broker",
    layout: "broker-portfolio",
    amountStyle: "symbol-prefix",
    negativeStyle: "minus-outside",
    header: { title: "Portfolio" },
    sections: [
      {
        accounts: [
          {
            name: "IBKR Margin Account",
            lastFour: "4417",
            numberText: "U4417xx",
            kind: "investment",
            caption: "Net liquidation value",
            balances: [{ currency: "USD", balance: 238914.62 }],
            details: [
              { label: "Buying power", value: "$412,330.18" },
              { label: "Maintenance margin", value: "$61,204.95" },
              { label: "Day P&L", value: "-$3,187.44" },
              { label: "Cash", value: "$18,220.07" },
            ],
          },
        ],
      },
    ],
    tabs: ["Home", "Watchlist", "Trade", "Account"],
  },

  // A crypto exchange. Quantities are bare numbers in units that are not
  // currencies, printed in the column money occupies, with the converted value
  // beside them — the only figure the app can store.
  {
    slug: "crypto-binance-assets",
    institution: { name: "Binance" },
    market: "Crypto exchange",
    layout: "exchange-assets",
    amountStyle: "symbol-prefix",
    header: { title: "Assets" },
    summary: { label: "Estimated balance", value: 41728.9, currency: "USD" },
    sections: [
      {
        title: "SPOT",
        accounts: [
          {
            name: "BTC",
            kind: "crypto",
            balances: [{ currency: "USD", balance: 32140.55 }],
            caption: "0.36412 BTC",
          },
          {
            name: "ETH",
            kind: "crypto",
            balances: [{ currency: "USD", balance: 7104.2 }],
            caption: "2.4188 ETH",
          },
          {
            name: "USDT",
            kind: "crypto",
            balances: [{ currency: "USD", balance: 2484.15 }],
            caption: "2,484.15 USDT",
          },
        ],
      },
    ],
    tabs: ["Home", "Markets", "Trade", "Futures", "Wallets"],
  },

  // One account's own page. Every row under the balance is a well-formed amount
  // with a date beside it, and none of them is a balance.
  {
    slug: "sg-dbs-account-detail",
    institution: { name: "DBS" },
    market: "SG retail",
    layout: "account-detail",
    amountStyle: "symbol-prefix",
    negativeStyle: "minus-outside",
    sections: [
      {
        title: "RECENT TRANSACTIONS",
        accounts: [
          {
            name: "My Account",
            lastFour: "6210",
            numberText: "004-6-006210",
            caption: "Available balance",
            balances: [{ currency: "SGD", balance: 27411.09 }],
          },
        ],
      },
    ],
    notes: [
      "14 Mar  NETS QR Payment|-32.80",
      "13 Mar  Salary GIRO|+6,250.00",
      "12 Mar  FAST Transfer to Ong|-1,500.00",
      "11 Mar  Interest Credit|+18.44",
    ],
    tabs: ["Home", "Pay & Transfer", "Invest", "More"],
  },

  // A neobank: one big balance whose only label is the app's own name, with the
  // other currencies as rows beneath it.
  {
    slug: "sg-wise-wallet",
    institution: { name: "Wise" },
    market: "Multi-currency neobank",
    layout: "neobank-wallet",
    amountStyle: "code-suffix",
    sections: [
      {
        title: "OTHER BALANCES",
        accounts: [
          {
            name: "Singapore dollars",
            caption: "Total balance",
            balances: [{ currency: "SGD", balance: 14280.33 }],
          },
          {
            name: "US dollars",
            balances: [{ currency: "USD", balance: 6120.5 }],
            caption: "Available",
          },
          {
            name: "Hong Kong dollars",
            balances: [{ currency: "HKD", balance: 9830 }],
            caption: "Available",
          },
        ],
      },
    ],
    tabs: ["Home", "Send", "Card", "Recipients", "Account"],
  },

  // An ISO code after the figure, and a section of investments beside the cash —
  // the mixed-kind screen, where the kind has to come from the product rather
  // than from one institution-wide default.
  {
    slug: "sg-ocbc-mixed",
    institution: { name: "OCBC" },
    market: "SG retail",
    layout: "sectioned-list",
    amountStyle: "code-prefix",
    negativeStyle: "minus-outside",
    header: { title: "Your finances" },
    sections: [
      {
        title: "DEPOSITS",
        accounts: [
          {
            name: "Everyday Global Account",
            lastFour: "5512",
            balances: [{ currency: "SGD", balance: 8840.12 }],
            caption: "Available balance",
          },
        ],
      },
      {
        title: "INVESTMENTS",
        accounts: [
          {
            name: "Unit Trusts",
            kind: "investment",
            balances: [{ currency: "SGD", balance: 42117.88 }],
            caption: "Market value",
          },
          {
            name: "Singapore Savings Bonds",
            kind: "investment",
            balances: [{ currency: "SGD", balance: 20000 }],
            caption: "Face value",
          },
        ],
      },
    ],
    tabs: ["Home", "Transfer", "Pay", "Apply", "More"],
  },

  // Every figure in a currency the app cannot store. The accounts are still
  // real and must still be reported — the engine keeps a group that showed
  // money it has no currency for — but no balance may be invented for them.
  {
    slug: "eu-n26-unstorable",
    institution: { name: "N26" },
    market: "EU neobank",
    layout: "stacked-cards",
    amountStyle: "code-suffix",
    header: { title: "Accounts" },
    sections: [
      {
        accounts: [
          {
            name: "Main Account",
            lastFour: "2140",
            balances: [{ currency: "USD", balance: 4820.55, printedAs: "EUR" }],
            caption: "Available balance",
          },
          {
            name: "Savings Space",
            lastFour: "7765",
            balances: [{ currency: "USD", balance: 12000, printedAs: "EUR" }],
            caption: "Available balance",
          },
        ],
      },
    ],
    tabs: ["Home", "Spaces", "Card", "Explore"],
  },

  // A Hong Kong screen with its brand absent, its figures bare, and its account
  // numbers in the hyphen-grouped morphology that must not read as money.
  {
    slug: "hk-hangseng-bare",
    institution: { name: "Hang Seng Bank", printed: false },
    market: "HK retail",
    layout: "stacked-cards",
    script: "cjk",
    amountStyle: "bare",
    header: { title: "戶口一覽" },
    sections: [
      {
        title: "存款",
        accounts: [
          {
            name: "綜合戶口",
            lastFour: "8841",
            numberText: "024-388-8841",
            balances: [{ currency: "HKD", balance: 168240.77 }],
            caption: "可用結餘",
          },
          {
            name: "外幣儲蓄",
            lastFour: "8842",
            numberText: "024-388-8842",
            balances: [{ currency: "USD", balance: 12400.5, printedAs: "USD" }],
            caption: "可用結餘",
          },
        ],
      },
    ],
    tabs: ["主頁", "轉賬", "投資", "更多"],
  },
];

/** Every synthetic screen, by slug order. */
export const SYNTHETIC_SPECS: readonly ScreenSpec[] = [...SPECS].sort((a, b) =>
  a.slug.localeCompare(b.slug),
);

/** One spec by slug, for `--sample <slug>`. */
export function specBySlug(slug: string): ScreenSpec | undefined {
  return SYNTHETIC_SPECS.find((spec) => spec.slug === slug);
}
