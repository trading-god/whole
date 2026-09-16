// What a synthetic screen IS: one declaration that produces both the rendered
// screenshot and the gold it must be recognized as.
//
// The real corpus under `samples/` is 17 device captures of the author's own
// accounts, all in SG/HK/CN. It cannot grow past the institutions one person
// banks with, and `packages/ocr-eval/README.md` records the gap that leaves as
// an accepted risk: "'Universal' has no evidence behind it yet." This module is
// the substitute evidence — screens the engine has never seen, in layouts it was
// never written against.
//
// The load-bearing property is that a spec is the SOURCE of both halves. A real
// sample's gold is a human reading a screenshot and writing down what it says,
// which is why `test:ocr:golden` admits a sample only after that reading is done
// by eye; two of seventeen golds were wrong the one time an LLM wrote them. Here
// the truth comes first and the pixels are derived from it, so the gold cannot
// be a misreading of the screen — it is what the screen was built to say.
//
// What that buys is layout coverage, and it is honest about what it does not
// buy: a spec is one person's model of how a bank app lays out a screen, so a
// sample here is evidence that the engine handles a LAYOUT FAMILY, never
// evidence about any named institution's real UI. Nothing here is a claim about
// what Chase or DBS actually renders.
import { CURRENCY_SYMBOLS, knownAssetCurrencies } from "@whole/ocr";
import type { AssetKind, Currency, RecognizedAccount } from "@whole/ocr";

/** One currency's figure on an account, and what the gold requires of it. */
export type SpecBalance = {
  currency: Currency;
  balance: number;
  /**
   * The currency token the screen actually prints, when it is not what the
   * screen's `amountStyle` would produce on its own.
   *
   * Two jobs, and they are the same job seen from either side. An ISO code the
   * app has no `Currency` for ("JPY") makes the figure UNSTORABLE: it is
   * rendered, the account keeps it on screen, and `goldFor` leaves it out of the
   * gold because `groupToRecognized` cannot express it. A code the app does
   * know ("USD" on an otherwise bare screen) simply overrides the style, so one
   * row can name its currency where the rest of the screen names none — which
   * is how a domestic app prints its one foreign-currency account.
   */
  printedAs?: string;
};

/**
 * One account on a synthetic screen.
 *
 * The split that matters is between what the screen SHOWS and what the gold
 * REQUIRES. `name`, `lastFour`, `balances` and `kind` are the truth; `caption`
 * and `details` are the furniture every real account screen carries around a
 * figure — "Available balance", "Available credit $8,517.64", "Matures Sep 30,
 * 2026" — and the engine must read past them rather than banking them. They
 * exist here precisely because they are the things a layout-naive parser
 * mistakes for money.
 */
export type SpecAccount = {
  /** The account's name, as the screen prints it and as the gold requires it. */
  name: string;
  /** The identifying digits, or absent for an account that shows no number. */
  lastFour?: string;
  /** Defaults to `cash`, matching the engine's own fallback. */
  kind?: AssetKind;
  balances: SpecBalance[];
  /** A caption under the figure. Never gold. */
  caption?: string;
  /** Label/value rows beside the account that are NOT its balance. Never gold. */
  details?: { label: string; value: string }[];
  /**
   * How the account number is printed, overriding the layout's default
   * `(...1234)`. A morphology is exactly the kind of thing that varies between
   * institutions and breaks a tail-four rule, so it is per-account.
   */
  numberText?: string;
};

/** A titled block of accounts — "CHECKING", "储蓄账户", or untitled. */
export type SpecSection = {
  title?: string;
  accounts: SpecAccount[];
};

/** How a figure is written. The engine has to read all of these as money. */
export type AmountStyle =
  /** `$3,204.57` — symbol tight against the digits. */
  | "symbol-prefix"
  /** `USD 3,204.57` — ISO code, spaced. */
  | "code-prefix"
  /** `3,204.57 USD` — code after the figure, as many EU and broker screens do. */
  | "code-suffix"
  /**
   * `76,007.05` — no currency anywhere on screen.
   *
   * The case a domestic app produces, and the one the annotation turn's
   * `homeCurrency` question exists for: the engine drops a figure it cannot
   * denominate, so a bare screen is worth nothing without it.
   */
  | "bare";

/** How a debt is written. Both conventions appear on real cards. */
export type NegativeStyle =
  /** `-$1,482.36` — sign outside the symbol. */
  | "minus-outside"
  /** `$-1,482.36` — sign inside. */
  | "minus-inside"
  /** `$1,482.36 DR` — a trailing debit marker, no sign at all. */
  | "dr-suffix"
  /** `欠款 1,482.36` — the figure labelled as owed. */
  | "owed-label";

/** Which HTML template renders this screen. */
export type LayoutId =
  /** Section headers over rows that carry name AND figure on one line. */
  | "sectioned-list"
  /** One card per account: name on top, figure beneath. */
  | "stacked-cards"
  /** A currency header row over a figures row. */
  | "currency-table"
  /** A broker's portfolio header — net liquidation, margin, positions. */
  | "broker-portfolio"
  /** An exchange's asset list — token, quantity, converted value. */
  | "exchange-assets"
  /** One account's own page, with the transaction list under it. */
  | "account-detail"
  /** A neobank's single big balance with the currency chips beneath. */
  | "neobank-wallet";

export type ScreenSpec = {
  /** Corpus directory name. `<region>-<institution>-<screen>`. */
  slug: string;
  /**
   * The institution's display name, and whether the screen prints it.
   *
   * `printed: false` is the interesting case and a common one: the OCBC and CMB
   * captures in the real corpus carry no brand anywhere on screen, which is what
   * the annotation turn's institution question is for.
   */
  institution: { name: string; printed?: boolean };
  /** Documentation only — which market this layout was modelled on. */
  market: string;
  layout: LayoutId;
  /** Drives the font stack and the digit/label spacing. Not a translation. */
  script?: "latin" | "cjk";
  amountStyle: AmountStyle;
  negativeStyle?: NegativeStyle;
  /** The status-bar clock, so a screen carries the same chrome a capture does. */
  clock?: string;
  header?: { title: string; subtitle?: string };
  /** A screen-level total the engine must NOT bank as an account. */
  summary?: { label: string; value: number; currency: Currency };
  sections: SpecSection[];
  /** Tab-bar labels — the row that reads as one long line of nav vocabulary. */
  tabs?: string[];
  /** Layout-specific extras, read by one template each. */
  notes?: string[];
};

/** Every account on a screen, in the order it is printed. */
function specAccounts(spec: ScreenSpec): SpecAccount[] {
  return spec.sections.flatMap((section) => section.accounts);
}

/**
 * The gold this screen must be recognized as.
 *
 * Derived, never written: that is the whole point of a spec. Two rules decide
 * what a gold does NOT require, and both are the engine's own contract rather
 * than a concession:
 *
 * - a figure printed in a currency the app cannot store is dropped, because
 *   `groupToRecognized` cannot express it. The account still appears — it is
 *   real, only its figure is unrepresentable.
 * - `institutionId` is omitted entirely. Detection answers "unknown" for every
 *   institution here (none has an `InstitutionConfig`, which is the point), and
 *   a gold demanding "unknown" would assert nothing today and fail the day one
 *   of them earns a config.
 */
export function goldFor(spec: ScreenSpec): RecognizedAccount[] {
  return specAccounts(spec).map((account) => {
    const storable = account.balances.filter(isStorable);
    const gold: RecognizedAccount = {
      accountName: account.name,
      kind: account.kind ?? "cash",
    };
    if (account.lastFour !== undefined) {
      gold.accountLastFourDigits = account.lastFour;
    }
    if (storable.length > 0) {
      gold.balances = storable.map(({ currency, balance }) => ({
        currency,
        balance,
      }));
    }
    return gold;
  });
}

// What a screen PRINTS, which is the contract's table with one deliberate
// divergence: the contract writes CNY as `CN¥` to disambiguate it from JPY in
// the app's own UI, while a mainland bank's screen prints a bare `¥`. Spread
// from the contract rather than restated, so a currency added there starts
// printing its real symbol here instead of falling through to the code.
const SYMBOLS: Record<string, string> = { ...CURRENCY_SYMBOLS, CNY: "¥" };

/** Thousands-grouped, two decimals, ASCII — the shape every template starts from. */
export function groupDigits(value: number): string {
  return Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Whether the app could store this figure at all.
 *
 * Derived from the printed code rather than declared, so a spec cannot claim a
 * gold the contract could not hold: a row printed "JPY" is unstorable because
 * `Currency` has no JPY, and saying so twice would be two things to keep in
 * step.
 */
function isStorable(balance: SpecBalance): boolean {
  return (
    balance.printedAs === undefined ||
    (knownAssetCurrencies as readonly string[]).includes(balance.printedAs)
  );
}

/**
 * Renders one figure the way this screen writes money.
 *
 * The sign is applied by `negativeStyle` rather than by the number formatter,
 * because where a bank puts the minus is a layout decision — and `debtMarkers`
 * in `@whole/ocr` covers both conventions precisely because both exist.
 */
export function formatAmount(spec: ScreenSpec, balance: SpecBalance): string {
  const code = balance.printedAs ?? balance.currency;
  const digits = groupDigits(balance.balance);
  const negative = balance.balance < 0;
  // A row that names its own code is never bare, whatever the screen's style:
  // `printedAs` is the spec saying this row prints its currency, and a bare
  // rendering would throw away the very thing it was set to state.
  const style =
    spec.amountStyle === "bare" && balance.printedAs !== undefined
      ? "code-prefix"
      : spec.amountStyle;
  const body =
    style === "bare"
      ? digits
      : style === "code-prefix"
        ? `${code} ${digits}`
        : style === "code-suffix"
          ? `${digits} ${code}`
          : `${SYMBOLS[code] ?? `${code} `}${digits}`;
  if (!negative) {
    return body;
  }
  switch (spec.negativeStyle ?? "minus-outside") {
    case "minus-outside":
      return `-${body}`;
    case "minus-inside":
      return style === "symbol-prefix"
        ? `${SYMBOLS[code] ?? code}-${digits}`
        : `-${body}`;
    case "dr-suffix":
      return `${body} DR`;
    case "owed-label":
      return `欠款 ${body}`;
  }
}

/** How an account's number is printed when its spec does not say. */
export function accountNumberText(account: SpecAccount): string | undefined {
  if (account.numberText !== undefined) {
    return account.numberText;
  }
  return account.lastFour === undefined
    ? undefined
    : `(...${account.lastFour})`;
}
