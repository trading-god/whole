// Account grouping: assembles the classified, clustered lines into tentative
// accounts. The key insight is an institution overview lists each account as a small
// region: an account-name row, an optional card/masked-number row, and
// label/amount pairs. We walk the lines top→bottom, opening an account group
// when we see an account-name line (or a card-number row that isn't the
// continuation of a name group), and attaching label/amount pairs to the open
// group via vertical adjacency.
//
// Amounts are summed per currency and the last four extracted during grouping
// itself. This module is pure and operable on recorded OCR output, so it
// composes with the eval harness.
import {
  carriesUnstorableCurrency,
  isCurrencyCode,
  isUnstorableCurrencyCode,
  normalizeCurrencyToken,
  type Currency,
} from "../contract/currency";
import { isMaskedCard, stripDateFragments } from "./amount";
import { leadingCurrencyName } from "./currency-mention";
import type { InstitutionConfig } from "../institutions/config";
import {
  buildAccountKeywordRegex,
  debtMarkerEndIn,
  endsAccountSection,
  isNonBalanceRow,
  statesDebt,
  stripLabelMarkers,
  subAccountCountMarkers,
} from "./vocabulary";
import {
  LAST_FOUR_LABEL_RE,
  MIN_ACCOUNT_DIGITS,
  NOT_AN_ACCOUNT_NUMBER,
} from "./line-classify";
import type { RowRole } from "./line-classify";
import type { TokenWithRole } from "./token-classify";

// A multi-currency table (an institution shows a "SGD HKD USD" header row aligned
// over "100,554.59 0.00 0.00" value row). Column-aligned parsing needs the
// token x positions, so it lives here (grouping) not in classifyRow: a single
// row classification can't see the two-row column alignment.
const COLUMN_ALIGN_TOLERANCE = 0.08;

// Center-x of a token's normalized box (0..1), used for column alignment.
function centerX(box: TokenWithRole["box"]): number {
  return box.x + box.width / 2;
}

// Whether a token names one of a table's currency columns: a currency the
// classifier resolved, or an ISO code the app cannot store.
//
// Counting the unstorable ones is load-bearing and was learned three times over
// — a "SGD JPY" header read as ONE currency banked the yen figure below it as
// dollars, and a "SGD | JPY" table read as no table at all summed both columns
// into the institution's home currency. `parseMultiCurrencyRow` still drops the
// unstorable COLUMN; what this decides is that the row is a table.
//
// One predicate because all three readers of it must agree on which rows are
// tables: written out separately they already differed, and the header parser's
// stricter copy could see fewer columns than the test that let it run.
function namesCurrency(token: TokenWithRole): boolean {
  return token.role === "currency" || isUnstorableCurrencyCode(token.text);
}

// The one currency a row names, when every currency token on it agrees. A
// two-currency header ("SGD HKD") names no single currency and returns
// undefined — which of its columns a lone figure belongs to is unknowable.
function singleCurrencyOf(line: ClassifiedLine): Currency | undefined {
  const currencies = new Set(
    contentTokens(line)
      .filter(namesCurrency)
      .map((token) => token.currency ?? normalizeCurrencyToken(token.text)),
  );
  if (currencies.size !== 1) {
    return undefined;
  }
  const [only] = [...currencies];
  return only !== undefined && isCurrencyCode(only) ? only : undefined;
}

// Whether this row heads a multi-currency table — "SGD HKD USD", or the same
// with a leading 币种 label, or with a column in a currency the app cannot
// store. Two or more currency columns and no figures: a header states what the
// columns ARE, the row below states what is in them.
//
// Not "every token is a currency". Requiring that, one unstorable ISO code
// (role `accountName`) or one CJK column label (role `unknown`) disabled the
// table, and the value row's three columns were then read as three
// currency-less figures and summed into one balance in the institution's home
// currency — a made-up number, from a table the screen laid out plainly.
function isCurrencyHeaderRow(line: ClassifiedLine): boolean {
  // Only a row that could BE a header. This branch runs BEFORE the role switch
  // and `continue`s, so any row it claims never reaches its own branch — and a
  // row that carries currencies plus something else usually IS that something
  // else. "Total SGD HKD" banked the screen's grand total as an account's
  // balance (and, with the summary branch skipped, let the whole summary block
  // leak in); "尾号7732 HKD USD" cost the account its last four.
  if (line.role !== "accountName" && line.role !== "amountRow") {
    return false;
  }
  // Nor a row that TITLES an account. "Everyday Global Account SGD USD" lists
  // the currencies the account holds; claimed as a header it never reached the
  // accountName branch, so the account lost its name — and with it its kind,
  // which is read off the name alone. A real header ("SGD HKD USD", "币种 SGD
  // HKD") matches no account keyword.
  const toks = contentTokens(line);
  const currencies = toks.filter(namesCurrency);
  return currencies.length >= 2 && !toks.some((t) => t.role === "amount");
}

// The title of a foreign-currency account stated as its own currency, twice —
// "美元 美元", the account's name beside its label. Exactly two content tokens,
// both the same currency: the REPEAT is the evidence, the same requirement the
// one-row rule in `attachAmountFromTokens` makes (a single currency token is
// just a balance row's currency, and naming an account "SGD" pre-fills the form
// with a currency code).
function repeatedCurrencyTitle(line: ClassifiedLine): string | undefined {
  const toks = contentTokens(line);
  return toks.length === 2 ? leadingRepeatedCurrency(toks) : undefined;
}

// The same evidence read off a row that also carries its figure: the first two
// CONTENT tokens are one currency, stated twice.
function leadingRepeatedCurrency(tokens: TokenWithRole[]): string | undefined {
  const toks = tokens.filter(isContentToken);
  return toks[0]?.role === "currency" &&
    toks[1]?.role === "currency" &&
    toks[0].currency === toks[1].currency
    ? toks[0].text
    : undefined;
}

// A row's tokens minus the chrome OCR reads off a tappable row: the trailing
// chevron, a bullet, an icon fragment. Applied to both rows of a multi-currency
// table, because one stray token used to disable the whole table read. The
// engine strips such glyphs off currency codes and off amounts already; the
// table test had no such tolerance.
function contentTokens(line: ClassifiedLine): TokenWithRole[] {
  return line.tokens.filter(isContentToken);
}

function isContentToken(token: TokenWithRole): boolean {
  return (
    token.role !== "navArrow" &&
    token.role !== "noise" &&
    // Punctuation only when the classifier made nothing of it. `$` and `¥` are
    // `\p{S}`, so a symbol-headed column ("$ | HK$" over its figures) was being
    // filtered out as punctuation — the table then had one currency, failed the
    // header test, and its figures were read as currency-less.
    (token.role !== "unknown" || !PUNCTUATION_ONLY_RE.test(token.text))
  );
}

// Pairs a currency-header row's codes with the figures under them, by column.
// Returns null when the rows don't read as a table at all.
//
// What counts as a figure is the classifier's answer, not a second opinion: a
// token it left inert was left inert for a reason, and re-reading it here made
// the table path bank a rate ("1,234.56 -0.51 %") that the ordinary path
// correctly ignores. Same for a "+"-signed figure — a day's change, never a
// holding — which is excluded before pairing, because a gain sitting nearer a
// column than the balance used to CLAIM that column and take the balance down
// with it.
//
// Paired closest-first rather than in header order: an earlier column that
// merely sits within tolerance was stealing the figure printed under a later
// one. A column with no figure under it is simply absent from the pairs; all-
// or-nothing, one missing cell abandoned the whole table and the row's figures
// were then summed into one made-up total.
//
// A column in a currency the app cannot store is COUNTED (two columns make a
// table whether or not both are storable) but contributes no balance —
// reported through `skippedUnstorable`, the same way `balanceAmountsOf` reports
// it, so the account survives when that column held its only money.
function parseMultiCurrencyRow(
  header: ClassifiedLine,
  value: ClassifiedLine,
): {
  balances: { currency: Currency; amount: number; valueIndex: number }[];
  skippedUnstorable: boolean;
  // Which paired column the row's debt label names, as an index into the same
  // `valueIndex` space — computed here, where the token list it indexes is
  // built. The caller used to rebuild that list with its own `contentTokens`
  // call and index into it, which was correct only while the two calls agreed.
  debtValueIndex: number;
} | null {
  // The same columns `isCurrencyHeaderRow` counted — a resolved currency token
  // whose currency the app cannot store is an unstorable column here, which the
  // pairing below already knows how to drop.
  const headerToks = contentTokens(header).filter(namesCurrency);
  const valueToks = contentTokens(value);
  // Two DISTINCT currencies, or it is not a table: "美元 美元" is a
  // foreign-currency account's title beside its own label (see
  // `repeatedCurrencyTitle`), and pairing it as two columns denominated both
  // figures below in that one currency and summed them into a figure the screen
  // never printed. Its currency still reaches those figures — as the header
  // currency, once this returns null.
  const distinctHeaders = new Set(
    headerToks.map(
      (token) => token.currency ?? normalizeCurrencyToken(token.text),
    ),
  );
  if (distinctHeaders.size < 2 || valueToks.length === 0) {
    return null;
  }
  // One answer per value token, computed once: `matchAmount` carries
  // `stripDateFragments`, `stripPercentages` and a currency scan, and the pairs
  // loop below would otherwise ask the same question H×V times on the path
  // `contract/currency.ts` profiles as the parser's hot one.
  const amounts = valueToks.map((token) =>
    token.role === "amount" &&
    token.amount !== undefined &&
    !token.text.trim().startsWith("+")
      ? token.amount
      : undefined,
  );

  const pairs: { header: number; value: number; distance: number }[] = [];
  headerToks.forEach((headerTok, headerIndex) => {
    valueToks.forEach((valueTok, valueIndex) => {
      if (amounts[valueIndex] === undefined) {
        return;
      }
      const distance = Math.abs(centerX(headerTok.box) - centerX(valueTok.box));
      if (distance <= COLUMN_ALIGN_TOLERANCE) {
        pairs.push({ header: headerIndex, value: valueIndex, distance });
      }
    });
  });
  pairs.sort((a, b) => a.distance - b.distance);

  const out: {
    currency: Currency;
    amount: number;
    valueIndex: number;
    header: number;
  }[] = [];
  let skippedUnstorable = false;
  const claimedValues = new Set<number>();
  const claimedHeaders = new Set<number>();
  for (const { header: headerIndex, value: valueIndex } of pairs) {
    if (claimedHeaders.has(headerIndex) || claimedValues.has(valueIndex)) {
      continue;
    }
    claimedHeaders.add(headerIndex);
    claimedValues.add(valueIndex);
    const currency = headerToks[headerIndex].currency;
    if (currency === undefined) {
      // An unstorable column with money under it: there is no balance to
      // report, and the account still has to survive.
      skippedUnstorable = true;
      continue;
    }
    out.push({
      currency,
      amount: amounts[valueIndex] as number,
      valueIndex,
      header: headerIndex,
    });
  }
  // Reported in the order the SCREEN prints the columns, not the order the
  // pairing happened to resolve them in — closest-first is about which figure
  // belongs to which column, not about what the account's balances look like.
  out.sort((a, b) => a.header - b.header);

  // Every column was a gain, or none paired. Not a table read — returning an
  // empty result here told the caller the row WAS a table, so it opened an
  // empty region and consumed the row, and the next real account attached to a
  // group created by a chart delta.
  return out.length > 0 || skippedUnstorable
    ? {
        balances: out,
        skippedUnstorable,
        debtValueIndex: labelledDebtAmountIndex(valueToks),
      }
    : null;
}

// Whether a finished region is an account at all: it has a balance, an account
// number, or money the app could not represent. A group with only a name is a
// row of buttons or tabs that happened to contain an account word — Trust's
// "存入资金 PayNow 储蓄罐 Statements" action bar matched "statement" and became
// an account with nothing in it.
//
// One definition, because two of them disagreed: the summary fallbacks tested
// raw group COUNT, so a titled-but-empty region — which this predicate rejects
// — suppressed the fallback and then got filtered out itself, and the screen
// recognized nothing.
function isAccountLike(group: OcrAccountGroup): boolean {
  return (
    group.lastFour !== undefined ||
    group.balances.length > 0 ||
    group.sawUnstorableBalance
  );
}

// `isAccountLike`, widened by one clause: a region the screen TITLED counts as
// an account for the questions asked BEFORE the final filter — "how many
// accounts does this screen show" and "is there anything left to report". Named
// once because the two callers must agree; spelled out twice, they were exactly
// the pair of definitions whose disagreement `isAccountLike` was extracted to
// end.
function isReportable(group: OcrAccountGroup): boolean {
  return isAccountLike(group) || group.name !== "";
}

export type OcrAccountGroup = {
  name: string;
  lastFour: string | undefined;
  balances: { currency: Currency; amount: number }[];
  // This region showed a balance the app has no currency for — see
  // `OpenGroup.sawUnstorableBalance`. Recognition keeps the account; what to do
  // about the missing figure is the form's call.
  sawUnstorableBalance: boolean;
  // Raw rows that fed this group. Not read by recognition — the kind is
  // classified from the account's NAME alone (see `groupToRecognized`) — but
  // surfaced in the eval trace, where it is the evidence for why a row landed
  // where it did.
  sourceText: string[];
  // 1-based indexes of the source `ClassifiedLine`s that fed this group.
  // Populated for the eval harness's trace; production code ignores it.
  lineNumbers: number[];
};

type ClassifiedLine = {
  text: string;
  role: RowRole;
  // Per-token roles for this line (from `classifyTokens`). The grouping step
  // consumes these directly — filtering by role to assemble account name,
  // balance, and card number — instead of re-splitting the joined text.
  // Required: the parser always produces token roles; the eval harness goes
  // through the same parser entry point.
  tokens: TokenWithRole[];
};

// A balance row whose currency may not have been stated yet — resolved against
// the group's established currency in `finish`, so a leading
// "Available Balance 1,000.00" (no currency marker) isn't dropped just because
// no currency has appeared by the time the row is read.
type PendingBalance = { currency: Currency | undefined; amount: number };

// Opened-group state while scanning lines. Amount rows are queued as pending
// balances and resolved to a currency in `finish` once the group's currency is
// established (see PendingBalance).
type OpenGroup = {
  name: string;
  // The row's name tokens BEFORE `cleanAccountName` truncated them at the last
  // account keyword. Only the repeat-absorb test reads it: truncation is what
  // strips a tab bar off a title ("储蓄户口 付款 更多"), but it also erases a
  // real qualifier, so "Current Account (Personal)" and "Current Account
  // (Joint)" both became "Current Account" — and the second was absorbed into
  // the first, merging two accounts into one summed balance.
  nameSource: string;
  lastFour: string | undefined;
  pending: PendingBalance[];
  // Whether this region showed money in a currency the app cannot store. The
  // figure is dropped — there is nowhere to put it — but the ACCOUNT is real,
  // and dropping it too meant a screen listing one JPY account recognized
  // nothing at all, leaving the user nothing to correct.
  sawUnstorableBalance: boolean;
  sourceText: string[];
  sourceLineNumbers: number[];
};

// The digits of a token that is nothing but a (possibly hyphen-grouped) number:
// "4921-6001-0138-0371" → "4921600101380371", "-0193855038" → "0193855038".
// Working per token rather than over the joined row is what keeps a balance
// sharing the line out of the result — "…-0371 -1,745.52SGD" would otherwise
// fuse into one long run and yield "3711".
function accountDigits(tokenText: string): string | undefined {
  const trimmed = stripDateFragments(tokenText).trim();
  if (!/^[\d-]+$/.test(trimmed)) {
    return undefined;
  }
  // The same exclusions `classifyRow` applies, shared for the same reason
  // `MIN_ACCOUNT_DIGITS` is: a hotline, a mobile number or a year range sharing
  // the row is the account-number SHAPE and not an account number. The row
  // classifier deliberately lets such a row reach the card path so the real
  // number beside it is seen — and then this fallback handed the account the
  // hotline's tail four instead. A wrong last four is worse than none; it feeds
  // account dedupe.
  if (NOT_AN_ACCOUNT_NUMBER.some((re) => re.test(trimmed))) {
    return undefined;
  }
  const digits = trimmed.replace(/-/g, "");
  return digits.length >= MIN_ACCOUNT_DIGITS ? digits : undefined;
}

// A real account name contains at least one letter — in any script, so CJK
// product names ("一卡通") qualify. Digits alone never name an account: the
// trailing "4242" of a masked card row is `unknown` and short enough to escape
// the account-number filter, and treating it as a name would split the card off
// from the account it belongs to.
const NAME_HAS_LETTER_RE = /\p{L}/u;

// A token that is nothing but punctuation or symbols — the "：" of an overflow
// menu, a stray bullet, a bracket OCR'd off an icon. These carry no name and
// must not be joined into one ("一卡通 ：").
const PUNCTUATION_ONLY_RE = /^[\p{P}\p{S}\s]+$/u;

// A token carrying a currency symbol is money, or a fragment OCR'd off card
// artwork ("$59"), never part of an account's name. Filtered by symbol rather
// than by "has no letters", because a name's identifying token often is pure
// digits — the "360" of "360 Account".
const CARRIES_CURRENCY_SYMBOL_RE = /[$¥€£]/;

// A lone letter is OCR debris off a logo — the "D" the Bitget Wallet mark
// leaves in front of its own name — never a word of the name itself.
const SINGLE_LETTER_RE = /^\p{L}$/u;

// Prose, not a name: a disclaimer, a warning, a marketing line. HSBC prints
// "保障您的存款免遭诈骗或未经授权使用。 开立汇丰智安存账户" under its cards,
// which contains the bank's own name and was opening a third account.
// Sentence-ending punctuation is the tell — account names never carry it.
//
// The Latin arm needs the full sentence boundary — a lowercase letter, the
// mark, then a capital starting the next sentence — not a bare "mark followed
// by a space". A period is how English abbreviates, and abbreviating is exactly
// what an account title does: "U.S. Dollar Account" was read as prose, so the
// account never opened and its balance was then discarded as a converted
// total. "Savings Acct. 1234" went the same way.
const SENTENCE_LIKE_RE = /[。！？；]|[a-z][.!?;]\s+[A-Z]/;

// The currency a row states for itself, from its own standalone currency token
// ("SGD 6,672.59"). Amount tokens that carry a fused symbol ("$5,000.00") keep
// their own currency; this is the fallback for the ones that don't.
function lineCurrencyOf(tokens: TokenWithRole[]): Currency | undefined {
  const stated = tokens.find((token) => token.role === "currency")?.currency;
  if (stated) {
    return stated;
  }
  // Then a sub-account row that names its currency in words, fused to its own
  // label — "港元储蓄 62,612.59" (see `leadingCurrencyName`). Such a token is
  // not a currency token: it is a label that BEGINS with a currency name, and
  // the classifier only labels a token whose whole text is one.
  for (const token of tokens) {
    if (token.role === "amount") {
      continue;
    }
    const named = leadingCurrencyName(token.text);
    if (named) {
      return named;
    }
  }
  return undefined;
}

// Whether the figure at `index` is denominated in a currency the app cannot
// store, judged by the token immediately before or after it. Adjacency is the
// point: a code elsewhere on the row belongs to some other figure.
function isUnstorableCurrencyAmount(
  tokens: TokenWithRole[],
  index: number,
  currencyLeads: boolean,
): boolean {
  // One side only, the side the row puts its codes on. Checking both meant a
  // currency-leading row read the code belonging to the NEXT figure as this
  // one's — "HKD 1,212.52 JPY 0.00" dropped the HKD 1,212.52 and the account
  // with it.
  // The figure itself may carry the code ("0.00JPY"), or state it in the
  // neighbouring token on the side the row puts its codes.
  if (carriesUnstorableCurrency(tokens[index].text)) {
    return true;
  }
  const neighbour = tokens[index + (currencyLeads ? -1 : 1)];
  return neighbour !== undefined && isUnstorableCurrencyCode(neighbour.text);
}

// Which amount on a debt row is the debt: the first figure after the token
// carrying the debt label, or — when the label spans tokens and no single one
// holds it — the row's first figure.
function labelledDebtAmountIndex(tokens: TokenWithRole[]): number {
  // A "+"-signed figure is a gain, never the debt — and picking it cost the row
  // every figure it had: the gain is dropped by the sign guard in
  // `balanceAmountsOf`, and the real debt beside it is dropped for not being
  // the chosen index. "您花了 +0.88 4,766.92 SGD" left the card with no balance.
  const isAmount = (token: TokenWithRole) =>
    token.role === "amount" &&
    token.amount !== undefined &&
    !token.text.trim().startsWith("+");
  // Located in the ROW's text, then mapped back to a token: the label spans
  // tokens (see `debtMarkerEndIn`), so asking each token in isolation found the
  // CJK markers only and never the English ones.
  let cursor = 0;
  const starts = tokens.map((token) => {
    const start = cursor;
    cursor += token.text.length + 1;
    return start;
  });
  const markerEnd = debtMarkerEndIn(
    tokens
      .map((token) => token.text)
      .join(" ")
      .toLowerCase(),
  );
  const afterMarker = tokens.findIndex(
    (token, i) => starts[i] >= markerEnd && isAmount(token),
  );
  // Falls back to the row's FIRST figure when no amount follows the label —
  // the label may span tokens ("您 花了"), or trail the figures entirely
  // ("4,766.92 SGD 欠款"). Returning -1 there skipped every amount on the row
  // and took the account with them.
  return afterMarker !== -1 ? afterMarker : tokens.findIndex(isAmount);
}

// Whether the row prints each currency BEFORE its figure. True when a currency
// token precedes the first amount token; false for the trailing layout, and for
// a row with no currency at all (where neither answer matters).
function leadsWithCurrency(tokens: TokenWithRole[]): boolean {
  // An unstorable code counts for the layout question even though the
  // classifier never labels it `currency`: a row that prints only "JPY 0.00"
  // has no supported currency token, and reading it as trailing looked for the
  // code on the wrong side.
  const firstCurrency = tokens.findIndex(namesCurrency);
  const firstAmount = tokens.findIndex((t) => t.role === "amount");
  return (
    firstCurrency !== -1 && (firstAmount === -1 || firstCurrency < firstAmount)
  );
}

// The currency token that belongs to the amount at `index`, scanning in the
// direction the row's layout implies.
function adjacentCurrency(
  tokens: TokenWithRole[],
  index: number,
  currencyLeads: boolean,
): Currency | undefined {
  const step = currencyLeads ? -1 : 1;
  for (let i = index + step; i >= 0 && i < tokens.length; i += step) {
    const token = tokens[i];
    if (token.role === "currency" && token.currency) {
      return token.currency;
    }
    // Another amount in between ends the search: that figure owns whatever
    // currency lies beyond it.
    if (token.role === "amount") {
      return undefined;
    }
  }
  return undefined;
}

// The tokens on a row that could form an account name: name words plus the
// `unknown` tokens the grouping step has always collected alongside them (a
// CJK product name like "一卡通" lands as `unknown`), minus any account or card
// number sharing the row — those are the account's identity, not its name.
function nameTokensOf(tokens: TokenWithRole[]): TokenWithRole[] {
  // Shape alone: what a token looks like, before its role is considered.
  const wellShaped = (token: TokenWithRole) =>
    !accountDigits(token.text) &&
    !LAST_FOUR_LABEL_RE.test(token.text) &&
    !PUNCTUATION_ONLY_RE.test(token.text) &&
    // A currency code the engine can't store still labels money, not an
    // account: "1,212.52 HKD 0.00 JPY" was naming the account "JPY".
    !carriesUnstorableCurrency(token.text) &&
    !CARRIES_CURRENCY_SYMBOL_RE.test(token.text) &&
    !SINGLE_LETTER_RE.test(token.text.trim());

  const isName = tokens.map(
    (token) =>
      (token.role === "accountName" || token.role === "unknown") &&
      wellShaped(token),
  );
  // A label token BETWEEN two name words is part of the name, not a field
  // label. "Balance" is both — it labels a value ("Available Balance $5,000")
  // and it names products ("Zero Balance Account", "Cash Balance Account") —
  // and the token classifier can only see the word, so it always calls it a
  // label. Position is what tells them apart: a real label heads or trails its
  // value, so only a label with name words on BOTH sides is a name word.
  // Dropping it silently deleted one word from the middle of an account name.
  const first = isName.indexOf(true);
  const last = isName.lastIndexOf(true);

  return tokens.filter(
    (token, index) =>
      isName[index] ||
      (token.role === "label" &&
        wellShaped(token) &&
        index > first &&
        index < last),
  );
}

// The account name a row's tokens yield, or undefined when they don't name an
// account. One thing disqualifies a candidate, and it was a bug before it was a
// rule: a name with no letter at all is OCR debris (the circled "②" BOCHK
// renders beside a row is `unknown` and escapes the punctuation filter, being a
// Number to Unicode).
//
// A pure field label ("Available Balance") needs no check of its own — every
// token of it carries a label marker, so `nameTokensOf` keeps none of them and
// the candidate comes back empty.
//
// Shared by the card-row path and the amount-row path so the "what can be a
// name" rule has one definition — the filter above and these two checks were
// tuned together, one screenshot regression at a time, and drifted apart the
// moment they existed twice.
// Returns the cleaned name and the untruncated source both callers need, so the
// row's name tokens are collected once — `nameTokensOf` runs `accountDigits`
// (and with it `stripDateFragments`), the last-four pattern and the unstorable
// -code lookup over every token, and the amount path was paying for all of it
// twice per naming hit.
function accountNameFromTokens(
  tokens: TokenWithRole[],
  keywordRegex: RegExp,
  iconTags: string[],
): { name: string; source: string } | undefined {
  const nameTokens = nameTokensOf(tokens);
  const candidate = cleanAccountName(nameTokens, keywordRegex, iconTags);
  return NAME_HAS_LETTER_RE.test(candidate)
    ? { name: candidate, source: nameTokens.map((t) => t.text).join(" ") }
    : undefined;
}

// Extracts an account's last four from a card-number row, in descending order
// of how much the screen tells us:
//
//  1. A masked card ("**** 1234") — only the digits adjacent to the mask are
//     the card's, so a balance sharing the row can't contaminate them.
//  2. An explicit last-four label ("尾号7732") — the screen already said it.
//  3. The longest account-number-like token on the row, tail four.
//
// Date-like fragments are stripped first so a trailing expiry doesn't blend in
// ("**** 1234 08/26" → "1234", not "0826").
//
// Step 3 takes the tail of the WHOLE digit run. For institutions that print a
// trailing check digit (BOCHK's "012-394-2-033676-3", where a person reads the
// account as 3676, not 6763) that is the wrong four — the correct reading is
// institution-specific and belongs in `InstitutionConfig`, not in this shared
// rule. Rather than guess a segmentation that suits one bank and breaks
// another, this returns the mechanical tail and the eval records the mismatch.
function lastFourFromLine(
  line: ClassifiedLine,
  accountNumberLastFour: RegExp | undefined,
): string | undefined {
  const rowText = stripDateFragments(line.text);

  // Falls THROUGH when the mask carries fewer than four digits rather than
  // giving up: a single "·" is a bullet as often as a mask, and OCR emits one
  // next to an ordinary account number often enough that returning early here
  // cost the row its last four entirely — and, on a number-last institution,
  // let the next account's balance leak into this region.
  const masked = rowText.match(/[·•*]+\s*(\d{4,})/);
  if (masked) {
    return masked[1].slice(-4);
  }

  const labelled = rowText.match(LAST_FOUR_LABEL_RE);
  if (labelled) {
    return labelled[1];
  }

  // An institution whose number carries a check digit reads its identifying
  // digits from a capture group instead of the mechanical tail.
  if (accountNumberLastFour) {
    for (const token of line.tokens) {
      const match = accountNumberLastFour.exec(token.text.trim());
      if (match?.[1] && match[1].length >= 4) {
        return match[1].slice(-4);
      }
    }
  }

  let longest = "";
  for (const token of line.tokens) {
    const digits = accountDigits(token.text);
    if (digits && digits.length > longest.length) {
      longest = digits;
    }
  }
  return longest ? longest.slice(-4) : undefined;
}

// Whether `next` is a card row introducing an account other than the open one:
// a card number whose last four differs from the one already recorded. A card
// that merely repeats its own title has an amount row below it, not a second
// number.
function titlesAnotherCard(
  next: ClassifiedLine | undefined,
  open: OpenGroup,
  lastFourOf: (line: ClassifiedLine) => string | undefined,
): boolean {
  if (next?.role !== "cardNumber") {
    return false;
  }
  const lastFour = lastFourOf(next);
  return lastFour !== undefined && lastFour !== open.lastFour;
}

// Records a source row against the open group: its text and its 1-based line
// index, both for the eval trace. Centralized so every case that attaches a row
// stays in lockstep, instead of repeating the pair of pushes. The text also
// makes the group count as having content (see `groupHasContent`), which is
// what keeps a region that so far has only attached rows from being dropped.
function attachSource(
  open: OpenGroup | null,
  line: ClassifiedLine,
  lineIndex: number,
): void {
  open?.sourceText.push(line.text);
  open?.sourceLineNumbers.push(lineIndex + 1);
}

// Assembles classified lines into tentative accounts.
//
// One top→bottom pass over the rows with a single open region (`open`). A row
// that names an account opens a region; the rows below attach to it — a card
// number gives it a last four, an amount row queues a balance — until something
// ends it and `closeOpen` emits it. What ends a region is institution-shaped:
// usually the next account's title, but a number-last layout ends on the
// account number and a number-first layout starts on it.
//
// Two things are deliberately NOT accounts and are handled by suppression
// rather than by opening a region: a summary row (its figure is held aside in
// `summaryAmounts` and used only if the screen states no balance of its own),
// and everything below an account-section-end heading, where the figures are
// postings rather than balances.
export function groupIntoAccounts(
  lines: ClassifiedLine[],
  // Required, and passed in by `parser.ts` from `resolveInstitutionConfig`
  // (whose "unknown" answer IS `DEFAULT_CONFIG`). Defaulting to that constant
  // here meant `engine/` imported a VALUE from `institutions/` while
  // `institutions/config.ts` imports one back from `engine/vocabulary.ts` — a
  // cycle, and the reverse of the layering `src/index.ts` documents. The type
  // import stays: it erases, so it creates no such edge.
  institutionConfig: InstitutionConfig,
): OcrAccountGroup[] {
  // Institution-specific rules resolved once per parse: the keyword regex
  // (shared defaults + this institution's product keywords) and the
  // equivalent-total pattern.
  //
  // An "equivalent total" row — "Available in 3 currencies ( SGD 100,554.59",
  // "Equivalent in SGD 2,009.85" — restates the whole account as one display
  // number, so its amount must not be added to balances (it would double-count
  // what the per-currency rows already report). It does NOT end the region: it
  // is an attached display inside the open account, unlike a real summary row
  // ("Total"), which discards what follows. `DEFAULT_CONFIG` carries the shared
  // pattern (the display appears across SG bank multi-currency UIs); an
  // institution may override it, and `undefined` skips the check entirely.
  const keywordRegex = buildAccountKeywordRegex(
    institutionConfig.accountKeywords,
  );
  const equivalentTotalRe = institutionConfig.equivalentTotalPattern;
  // An "equivalent total" restates the whole account as one display figure, so
  // it contributes no balance — asked here by every path that reads figures off
  // a row. Two of them did not ask, and an equivalent printed on a card row
  // ("•••• 1234 HKD 500.00 Equivalent in SGD 2,009.85") counted the account's
  // whole value a second time, as a second currency.
  const isEquivalentTotalRow = (row: ClassifiedLine) =>
    equivalentTotalRe?.test(row.text) ?? false;
  const iconTags = institutionConfig.iconTags ?? [];
  const defaultCurrency = institutionConfig.defaultCurrency;

  const groups: OcrAccountGroup[] = [];
  let open: OpenGroup | null = null;
  // Ends the open region: emit it if it accumulated anything worth keeping,
  // then clear it. Every boundary in the state machine below funnels through
  // here, so "what closing an account means" — including the
  // `defaultCurrency` the finished group is denominated in — is decided once.
  // The row read just above a number-first institution's account-number row,
  // held for the account that row opens: its balance, and the name and flags
  // `attachAmountFromTokens` recognized on it. Set and consumed by adjacent
  // rows — the producer only fills it after checking the next row IS that
  // number row, and the number row's own branch empties it.
  let carried: OpenGroup | null = null;
  // Whether an IDENTIFIED account has been emitted — one carrying a name or an
  // account number. Monotonic, so it is recorded where it changes rather than
  // re-derived by scanning every group on every input line.
  //
  // Identity, not a name: a card-detail screen prints a masked number, its
  // balance, and then the statement, and requiring a name left the section-end
  // guard disarmed — every posting under "Transaction History" was summed into
  // the card's balance and the account took a posting's name. Money alone is
  // still not enough (a stray figure above a tab bar opens a nameless region,
  // and counting that stopped the scan before the real account).
  let hasEmittedIdentifiedAccount = false;
  const closeOpen = () => {
    if (open && groupHasContent(open)) {
      const finished = finish(open, defaultCurrency);
      hasEmittedIdentifiedAccount ||=
        finished.name !== "" || finished.lastFour !== undefined;
      groups.push(finished);
    }
    open = null;
  };
  // True while skipping rows that belong to a summary (e.g. "Total" followed by
  // its amount on the next line) — those rows must not attach to the previous
  // account. Cleared by the next accountName.
  let discarding = false;
  // Amounts printed inside a summary block, held aside instead of attached.
  //
  // A multi-account overview repeats each account's balance on its own row, so
  // the summary is redundant and must not be counted. But a SINGLE-account
  // overview — a crypto exchange, a payment app, a bank's one-account home —
  // states the balance only in the summary: OKX shows 总资产估值 44,503.83 and
  // then only per-wallet splits, Alipay shows 5,203.47 and then only
  // categories. Discarding it outright loses the one figure that matters.
  //
  // So it is captured but not attached, and used at the end only if the screen
  // produced no balances of its own.
  const summaryAmounts: PendingBalance[] = [];
  let summaryCaptured = false;
  // A summary figure dropped for being in a currency the app cannot store. On a
  // single-account wallet or exchange screen the summary is the ONLY balance
  // path, so losing it lost the account — while the per-account path keeps such
  // a region on purpose.
  let summarySkipped = false;
  // Rows seen inside the summary block, carried onto the fallback account so
  // the eval trace shows what the summary figure was surrounded by — Alipay's
  // total says nothing on its own, but the 稳健理财 / 基金 rows under it are
  // what a reader uses to judge the reading.
  const summarySourceText: string[] = [];
  // A detected multi-currency header row ("SGD HKD USD") awaiting its
  // column-aligned value row on the next line. Null unless one is pending.
  // One answer per row, computed on first use. A card row is asked this up to
  // three times per parse — the amount row's lookahead, `titlesAnotherCard`,
  // and the card branch itself — and each answer costs `stripDateFragments`
  // over the whole row plus `accountDigits` (which strips again) over every
  // token. Memoizing also guarantees the lookahead and the branch can never
  // disagree about whether a row states a last four.
  const lastFourCache = new Map<ClassifiedLine, string | undefined>();
  const lastFourOf = (line: ClassifiedLine): string | undefined => {
    if (!lastFourCache.has(line)) {
      lastFourCache.set(
        line,
        lastFourFromLine(line, institutionConfig.accountNumberLastFour),
      );
    }
    return lastFourCache.get(line);
  };
  let pendingCurrencyHeader: ClassifiedLine | null = null;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    // A currency stated by a header row that turned out not to head a table,
    // for the figures on THIS row — the row directly below the header, which is
    // the row being processed when it gets set. Declared here so that lifetime
    // is structural: hoisted out of the loop and reset at the top, it once
    // became the currency of every later unmarked figure on the screen,
    // pre-empting both the group's own resolution and the institution's home
    // currency.
    let headerCurrency: Currency | undefined;
    let isSubAccountCountRow = false;
    if (discarding) {
      summarySourceText.push(line.text);
    }
    // "7个账户" announces that the figures above were this region's total and
    // the detail follows. Drop what was collected so the total isn't counted
    // alongside the parts that make it up.
    // Checked before the row can open anything: "3 accounts" satisfies the
    // account-keyword test too, so on the English arm it went on to open a
    // group literally named "3 accounts". The Chinese arm ("3个账户") never did,
    // which is how one marker list came to behave two different ways.
    if (subAccountCountMarkers.some((re) => re.test(line.text.trim()))) {
      isSubAccountCountRow = true;
      if (open) {
        // Every part of "what this region collected". Leaving the flag set kept
        // an otherwise-empty region alive past the reset that was meant to
        // discard its contents, and a figure already handed forward would have
        // been unshifted into the NEXT account.
        open.pending = [];
        open.sawUnstorableBalance = false;
        carried = null;
      }
    }
    // Below one of these headings the screen has stopped listing accounts.
    // Stop reading entirely rather than trying to tell a posting or a cash-flow
    // figure from a balance by shape — they look identical.
    //
    // Only once the account list has actually started, though. This heading
    // ENDS a section, so it cannot precede one: a top tab bar reading
    // "Transactions Cards Rewards" leads its row like a real heading does, and
    // stopping there killed recognition for the whole screenshot before a
    // single account was read.
    //
    // "Started" means a NAMED account. A stray figure above the tab bar opens a
    // nameless placeholder region, and counting that as a start put the guard
    // right back where it was — the tab bar stopped the scan and the real
    // account below was never read.
    const lowerLine = line.text.toLowerCase();
    if (
      (open?.name || open?.lastFour || hasEmittedIdentifiedAccount) &&
      endsAccountSection(lowerLine)
    ) {
      break;
    }

    // If the previous line was a currency header, try to consume THIS line as
    // its aligned value row (e.g. "100,554.59 0.00 0.00"). Column-aligned
    // pairing is the multi-currency table read — it wins over treating the
    // value row as a name/amount on its own.
    if (pendingCurrencyHeader) {
      const header = pendingCurrencyHeader;
      pendingCurrencyHeader = null;
      // The value row's figures are balances only if the row is stating
      // balances. This branch pushes straight into `open.pending`, so every
      // guard the ordinary path applies has to be repeated here or the table
      // simply doesn't have it: a "Credit 10,000.00 5,000.00" row banked a
      // credit facility as money, and an "Equivalent …" row double-counted what
      // the per-currency rows already reported.
      const tableStatesDebt = statesDebt(lowerLine);
      const tableIsBalances =
        // Not a summary row: its figures are the screen's total, to be held
        // aside and used only as a fallback. Claimed as a table's values, they
        // were pushed straight into the account AND the discard run the summary
        // branch starts never began.
        line.role !== "summaryRow" &&
        !isNonBalanceRow(lowerLine) &&
        !isEquivalentTotalRow(line);
      const parsed =
        discarding || !tableIsBalances
          ? null
          : parseMultiCurrencyRow(header, line);
      if (parsed) {
        // Opens a region when none is: the table IS an account's balances, and
        // the branches for every other kind of row already open one. Requiring
        // an open group threw the header away — a table printed before any
        // account opens, or right after a number-last institution closed one,
        // then summed all three columns into a single currency.
        open ??= createGroup("");
        // On a row that states a debt, only the LABELLED column is the balance
        // and it is negative — the same rule `balanceAmountsOf` applies, rather
        // than a second one here: "您花了 4,766.92 信用额度 10,000.00" spread
        // across columns is a debt and a limit, not two debts, and negating
        // every column read it as -14,766.92.
        // Matched by column, not by text: comparing TEXT negated every column
        // printing the same figure as the debt.
        for (const { currency, amount, valueIndex } of parsed.balances) {
          if (tableStatesDebt && valueIndex !== parsed.debtValueIndex) {
            continue;
          }
          open.pending.push({
            currency,
            amount: tableStatesDebt ? -Math.abs(amount) : amount,
          });
        }
        open.sawUnstorableBalance ||= parsed.skippedUnstorable;
        // The row may carry identity as well as figures — a masked card number
        // beside its columns, or the account's own title. Consuming the row
        // outright skipped the branches that read those, so the account came
        // back with the right balances, no last four (which feeds dedupe) and
        // no name (and so no kind, which is read off the name).
        if (open.lastFour === undefined) {
          open.lastFour = lastFourOf(line);
        }
        if (!open.name) {
          const titled = accountNameFromTokens(
            line.tokens,
            keywordRegex,
            iconTags,
          );
          if (titled) {
            open.name = titled.name;
            open.nameSource = titled.source;
          }
        }
        attachSource(open, line, lineIndex);
        continue;
      }
      // The columns didn't line up, so this is not a table — but the header row
      // still SAID something, and dropping it silently threw that away. When it
      // names one currency ("美元 美元", a foreign-currency account's title and
      // its label, which the corpus prints on one row and a taller screen can
      // split across two), that currency belongs to the figures below it.
      headerCurrency = singleCurrencyOf(header);
    }

    // A currency header row ("SGD HKD USD") is not a name — it opens a
    // multi-currency table awaiting its aligned value row. Don't open a new
    // account for it; remember it and let the next line be consumed above.
    if (isCurrencyHeaderRow(line)) {
      pendingCurrencyHeader = line;
      // A row can be BOTH: "一卡通 HKD USD" titles the account and heads its
      // columns. Consuming it outright cost the account its name (and its kind,
      // read off that name); ignoring the header cost the columns their
      // currencies. So it is remembered as a header AND allowed to fall through
      // to the accountName branch, which opens the account and records the row.
      //
      // Asked with the PARSE's keyword regex, not the shared defaults: an
      // institution's own product names live there, and the English arm of this
      // rule was already guarded — the two halves disagreed.
      // A row that is one currency stated TWICE names a foreign-currency
      // account — its title beside its own label ("美元 美元"), the shape
      // `attachAmountFromTokens` already reads when the figure shares the row.
      // Split onto two rows, the header branch claimed it and the account lost
      // its name; the currency it states is kept either way.
      const repeated = repeatedCurrencyTitle(line);
      if (repeated) {
        open ??= createGroup("");
        if (!open.name) {
          open.name = repeated;
          open.nameSource = repeated;
        }
      }
      if (!keywordRegex.test(stripLabelMarkers(lowerLine))) {
        // Recorded now: the row belongs to the region whatever the next row
        // turns out to be, and it was reaching neither branch below.
        attachSource(open, line, lineIndex);
        continue;
      }
    }

    switch (line.role) {
      case "accountName": {
        // A sub-account count row is not a name, whatever it matched. It has
        // already done its job above (dropping the region's total); letting it
        // through here opened an account called "3 accounts".
        if (isSubAccountCountRow) {
          attachSource(open, line, lineIndex);
          break;
        }
        // Only a REAL account name ends a summary discard run. Scaffolding that
        // OCR happened to classify as a name — chart period tabs ("1日 1周
        // 1年"), nav labels, greetings — used to clear it too, which let a
        // summary block's own figures leak in as balances: OKX prints its
        // portfolio chart directly under 总资产估值, and its axis labels
        // (S$52,417.55, S$27,012.77) were being read as holdings.
        //
        // Same test the "open a region" branch below uses, prose guard
        // included. Clearing on the keyword alone let a disclaimer that happens
        // to contain one ("Please read the terms. Open an account today.")
        // re-enable attachment without opening an account, so the chart axis
        // labels under it landed on the previous account after all — the exact
        // leak this guard exists to stop.
        if (keywordRegex.test(line.text) && !SENTENCE_LIKE_RE.test(line.text)) {
          discarding = false;
        }
        // A real account name closes the previous region and opens a new one.
        // Scaffolding that OCR classified as accountName (nav tabs, shortcut
        // labels, greeting text) stays attached to the open region instead of
        // splitting the account apart — that's what keeps "DBS Multiplier
        // Account" from being decoupled from its balance by the "Overview Bank
        // & Earn Manage" nav row above the balance.
        const nameTokens = nameTokensOf(line.tokens);
        const nameSource = nameTokens.map((token) => token.text).join(" ");
        const nameRowCandidate = cleanAccountName(
          nameTokens,
          keywordRegex,
          iconTags,
        );
        // A card repeats its own title on the detail row inside it — HSBC SG
        // prints "Everyday Global Account" as the card header and again as the
        // currency-balance row beneath. That repeat is not a second account, so
        // absorb it (balance included) instead of opening a new region.
        //
        // Compared BEFORE truncation: two sibling accounts differing only after
        // the account keyword truncate to the same name, and comparing those
        // merged them into one account holding the sum of both.
        //
        // And only when this row isn't titling a card of its own. A screen
        // listing two "Savings Account" cards puts each one's number under its
        // title, so a card row with a DIFFERENT last four right below means a
        // new account — absorbing it merged the two, adding the second card's
        // balance to the first and discarding its last four.
        if (
          open &&
          open.name &&
          nameSource === open.nameSource &&
          keywordRegex.test(line.text) &&
          !titlesAnotherCard(lines[lineIndex + 1], open, lastFourOf)
        ) {
          // The same two guards its sibling branches carry, so "what a row's
          // figures mean" does not depend on which branch read the row: a
          // credit facility contributes nothing, a stated debt is negated, and
          // a row with no currency of its own falls back to a header above it.
          const repeatStatesDebt = statesDebt(lowerLine);
          if (
            (!isNonBalanceRow(lowerLine) || repeatStatesDebt) &&
            !isEquivalentTotalRow(line)
          ) {
            attachAmountFromTokens(
              open,
              line.tokens,
              keywordRegex,
              iconTags,
              lineCurrencyOf(line.tokens) ?? headerCurrency,
              repeatStatesDebt,
            );
          }
          attachSource(open, line, lineIndex);
          break;
        }
        if (keywordRegex.test(line.text) && !SENTENCE_LIKE_RE.test(line.text)) {
          // An open region that is only scaffolding — rows attached above this
          // title with no identity and no money of their own — is dropped
          // rather than emitted. One that DOES carry identity or money is a
          // real account whose title the screen never printed (an untitled card
          // above a named one), and overwriting `open` silently deleted it
          // along with its last four and its balance.
          if (
            open &&
            (open.name || open.pending.length > 0 || open.sawUnstorableBalance)
          ) {
            closeOpen();
          }
          if (open && open.lastFour !== undefined) {
            open.name = nameRowCandidate;
            open.nameSource = nameSource;
            attachSource(open, line, lineIndex);
            break;
          }
          open = createGroup(nameRowCandidate, nameSource);
          attachSource(open, line, lineIndex);
        } else if (open) {
          // Scaffolding accountName with an open region: keep it as source
          // context so the real account's rows below aren't mis-assigned.
          attachSource(open, line, lineIndex);
        }
        // Scaffolding with NO open region: do nothing. A greeting ("欢迎") or
        // nav tab alone never opens a spurious account — the real account opens
        // when a row with an account keyword ("Account"/"Savings") arrives.
        break;
      }
      case "cardNumber": {
        // The guard is "can we read a last four off this row", not "does the
        // row look like a credit card". `classifyRow` routes hyphen-joined
        // account numbers here too, and those are not card-shaped — gating on
        // `isCardLike` meant every non-masked account number fell through and
        // its last four was never extracted.
        const lastFour = lastFourOf(line);
        if (!lastFour) {
          if (!discarding) {
            attachSource(open, line, lineIndex);
            // A number-last institution ends its account ON this row whether or
            // not the digits came through. Skipping the close because the last
            // four was unreadable let the NEXT account's balance land in this
            // one — three BOCHK accounts collapsed to two, and the merged one
            // reported the sum under the wrong last four.
            if (institutionConfig.accountNumberEndsAccount) {
              closeOpen();
            }
          }
          break;
        }
        // A card row often carries a name beside its number ("一卡通
        // 601-526-0984-7"). That name is used two ways, and the difference
        // matters:
        //
        // - It can RESTART a discarded run. A "总资产" summary sets
        //   `discarding`, and only an accountName row used to clear it — so on
        //   a screen whose accounts are titled only on their card rows, the
        //   summary swallowed every account below it.
        // - It does NOT close an already-named account. A named card row inside
        //   an open account is usually an attached card ("借记卡 4218-…" under
        //   a 360 Account), not a new account, so treating it as a boundary
        //   splits one account into two.
        const nameCandidate = accountNameFromTokens(
          line.tokens,
          keywordRegex,
          iconTags,
        );

        if (discarding) {
          // A bare card row inside a summary block stays discarded; only one
          // that names an account starts a new region.
          if (!nameCandidate) {
            break;
          }
          discarding = false;
        }
        // On a number-first layout a number row starts a new account, so close
        // whatever is open before it.
        //
        // `carried` counts as much as a name here: the row above already
        // decided this number row opens the next account (that is the only
        // condition under which it hands its figure forward). Closing only on a
        // name left an UNNAMED number row absorbed into the previous account —
        // along with the carried balance and its own last four, which is
        // exactly the inflation the hand-off exists to prevent.
        if (
          (nameCandidate || carried) &&
          institutionConfig.accountNumberStartsAccount
        ) {
          closeOpen();
        }
        // A MASKED card row whose number differs from the open account's is the
        // NEXT account, not a second number on this one. Absorbed, the second
        // card's balance was added to the first and its own number thrown away
        // — two cards in a list came back as one account holding both balances.
        //
        // Masked specifically, and the corpus is what narrows it: an OCBC
        // account prints its own number and then an attached card in FULL
        // ("借记卡 4218-0803-2297-3829" under a 360 Account). Closing on that
        // split both OCBC samples into one account too many. A list of cards
        // masks each one; a full number printed under a titled account is an
        // attachment.
        if (
          open?.lastFour !== undefined &&
          open.lastFour !== lastFour &&
          isMaskedCard(line.text)
        ) {
          closeOpen();
        }
        // If a card-number row starts a region (no open name group yet), open
        // one; if it follows a name group, it belongs to that account.
        if (!open) {
          open = createGroup("");
        }
        if (!open.lastFour) {
          open.lastFour = lastFour;
        }
        if (!open.name && nameCandidate) {
          open.name = nameCandidate.name;
          // Recorded alongside the name so the repeat-absorb test below can
          // compare untruncated sources: an HSBC SG card is titled on its
          // NUMBER row and repeats that title on the balance row beneath.
          open.nameSource = nameCandidate.source;
        }
        // The row above this number row, on a number-first layout: its figure
        // leads the pending list because that is where it was read, and its
        // NAME is this account's name when the number row states none. Keeping
        // only the pending balances threw away the title the row carried
        // ("保证金证券 HKD 26.14") — and with the name went the asset kind, since
        // that is classified from the name alone.
        if (carried) {
          open.pending.unshift(...carried.pending);
          if (!open.name && carried.name) {
            open.name = carried.name;
            open.nameSource = carried.nameSource;
          }
          open.sawUnstorableBalance ||= carried.sawUnstorableBalance;
          carried = null;
        }
        // A card row can carry the balance too, not just the identity: a
        // zh-Hans card list prints "储蓄卡 尾号7732 12,345.67" on one line. The
        // row reaches this branch rather than `amountRow` because the last-four
        // test runs first, so without this the money on it was dropped. The
        // same guards the amount path applies hold here, debt override
        // included: a card list prints "尾号7732 信用额度 10,000.00 已用额度
        // 4,766.92" on one row, and suppressing it for the credit limit alone
        // left the account with its last four and no balance.
        const cardStatesDebt = statesDebt(lowerLine);
        if (
          (!isNonBalanceRow(lowerLine) || cardStatesDebt) &&
          !isEquivalentTotalRow(line)
        ) {
          attachAmountFromTokens(
            open,
            line.tokens,
            keywordRegex,
            iconTags,
            lineCurrencyOf(line.tokens) ?? headerCurrency,
            cardStatesDebt,
          );
        }
        attachSource(open, line, lineIndex);
        // On a number-last layout the account number is the last row of its
        // region, so close here — otherwise the next account's balance, which
        // arrives before its own number, lands in this one.
        if (institutionConfig.accountNumberEndsAccount) {
          closeOpen();
        }
        break;
      }
      case "amountRow": {
        // A wealth app lists its accounts AS amount rows — Alipay's 稳健理财
        // carries the category name and its balance on one line — so a named
        // amount row ends a summary discard run, just as a named card row does.
        if (
          discarding &&
          keywordRegex.test(line.text) &&
          !SENTENCE_LIKE_RE.test(line.text)
        ) {
          discarding = false;
        }
        if (discarding) {
          // The first amount row after a summary marker is the summary's own
          // figure ("总资产估值" then "44,503.83 SGD"). Later rows in the same
          // block are chart axis labels and period comparisons, which are not
          // balances at all — so only the first is kept.
          //
          // "First" means the first row that could BE a balance. A change row
          // ("今日变动 -0.11") sits between the total and its figure on every
          // wallet screen, and claiming the slot with it left the account with
          // no balance at all — the same non-balance guard the per-account path
          // applies is what keeps the slot for the real total.
          if (
            !summaryCaptured &&
            !isNonBalanceRow(lowerLine) &&
            // An "Equivalent in SGD 2,009.85" restates money already counted;
            // claiming the one summary slot with it meant the real total on the
            // next row was never read. Asked here as everywhere else.
            !isEquivalentTotalRow(line)
          ) {
            // Claimed only once a figure was actually captured. Set up front,
            // the slot was taken by a row that then contributed nothing — a
            // bare "+0.88" gain line is not a non-balance MARKER, so it passed
            // the guard above and was emptied by the "+" rule below, and the
            // real total on the next row was never read.
            const summary = captureSummaryAmounts(
              line,
              summaryAmounts,
              headerCurrency,
            );
            summaryCaptured = summary.captured;
            summarySkipped ||= summary.skippedUnstorable;
          }
          break;
        }
        if (!open) {
          open = createGroup("");
        }
        // An equivalent/aggregate total row ("Available in 3 currencies ( SGD
        // 100,554.59", "Equivalent in SGD 2,009.85") is a display summary, not
        // a per-currency holding — don't add it to balances (it would
        // double-count the currency table), but keep it attached to the open
        // account so it never splits the region.
        const lineCurrency = lineCurrencyOf(line.tokens) ?? headerCurrency;
        // Only a row that SAYS it is an equivalent total is treated as one.
        //
        // There used to be a second, unmarked path: a non-zero figure in a
        // currency the account hadn't established yet was guessed to be a
        // conversion. It had no support in the corpus — removing it changes no
        // sample and no test — and it lost real money twice, because "a
        // currency not seen yet" describes an ordinary per-currency holding
        // just as well as a conversion. A multi-currency list lost every row
        // after the first, and narrowing it to the institution's home currency
        // only moved the loss to whichever holding happened to be listed after
        // a foreign one.
        //
        // An unmarked conversion row is genuinely indistinguishable from a
        // holding; guessing costs a real balance, and reporting one the screen
        // shows is the safer error. If a screenshot ever needs this back, it
        // should come with that sample and a structural rule — the conversion
        // is the region's LAST figure — rather than a currency guess.
        if (isEquivalentTotalRow(line)) {
          attachSource(open, line, lineIndex);
          break;
        }
        // On a number-first layout the account's total is printed just ABOVE
        // its number row ("… HKD 26.14" then "保证金证券 682-2-48564-2"), so
        // that figure belongs to the account about to open, not the one still
        // closing. Attaching it here inflated the previous account by exactly
        // the next one's balance.
        //
        // Held rather than dropped: the figure IS that account's balance, and
        // the number row below hands it on. Dropping it left the account with
        // its number and no money, which only went unnoticed because the one
        // screenshot of this layout repeats the figure below the number row.
        //
        // Every rule below applies to it first. Held BEFORE they ran, the row
        // skipped them all: a credit limit above a number row was banked as
        // that account's balance, and a debt row lost its sign — the two
        // failures the guards exist to prevent, reintroduced by handing the
        // figure on ahead of them.

        // A credit facility (limit, available credit, statement due) is not a
        // balance — attach the row for context but take no figure from it.
        //
        // Unless the row names a debt MORE specifically. A card screen clusters
        // both onto one line ("信用额度 10,000.00 已用额度 4,766.92"), and
        // suppressing it left the account with no balance at all; the debt path
        // below already takes only the labelled figure and leaves the limit.
        //
        // Containment, not precedence — see `statesDebt`.
        const isDebtRow = statesDebt(lowerLine);
        if (isNonBalanceRow(lowerLine) && !isDebtRow) {
          attachSource(open, line, lineIndex);
          break;
        }
        // The number-first hand-off, once the row is known to state a balance.
        if (institutionConfig.accountNumberStartsAccount) {
          const next = lines[lineIndex + 1];
          if (next?.role === "cardNumber" && lastFourOf(next)) {
            const held = createGroup("");
            attachAmountFromTokens(
              held,
              line.tokens,
              keywordRegex,
              iconTags,
              lineCurrency,
              isDebtRow,
            );
            carried = held;
            attachSource(open, line, lineIndex);
            break;
          }
        }
        attachAmountFromTokens(
          open,
          line.tokens,
          keywordRegex,
          iconTags,
          lineCurrency,
          // "You spent 4,766.92" means a balance of -4,766.92.
          isDebtRow,
        );
        attachSource(open, line, lineIndex);
        break;
      }
      case "summaryRow": {
        // A summary row aggregates the whole account, never an account itself.
        // Close the open group so a following summary amount doesn't leak into
        // it, then discard rows until the next accountName.
        closeOpen();
        // The top-of-loop guard records this row once `discarding` is set, so
        // setting it here is the only push a summary row needs — pushing again
        // put a second summary row into the trace twice, which is evidence for
        // a row the screen printed once.
        if (!discarding) {
          summarySourceText.push(line.text);
        }
        discarding = true;
        // The marker and its figure often share one clustered row
        // ("净清算价值 63,714", "总余额 74,987.99 HKD"). Filling `summaryAmounts`
        // only from FOLLOWING rows lost that figure, and with it the only
        // balance on a single-account overview.
        //
        // No non-balance gate here, unlike the amount rows below: this row
        // carries the summary marker itself, so its figures ARE the total plus
        // whatever is printed beside it, and the biggest-by-magnitude pick in
        // the fallback already tells those apart. Gating it meant a wallet that
        // clusters "总资产估值 44,503.83 今日变动 -0.11" lost the total and let a
        // chart axis label claim the slot instead.
        if (!summaryCaptured) {
          const summary = captureSummaryAmounts(
            line,
            summaryAmounts,
            headerCurrency,
          );
          summaryCaptured = summary.captured;
          summarySkipped ||= summary.skippedUnstorable;
        }
        break;
      }
      case "noise": {
        // Never an account; ignore entirely (doesn't end a discard run, since a
        // noise row between a summary and its amount shouldn't re-enable
        // attaching).
        break;
      }
    }
  }

  closeOpen();

  // The regions that showed an account at all: a title, a number, or money.
  //
  // This is what the summary fallback below counts, and it is deliberately
  // neither of the two obvious sets. `groups` includes regions kept alive by
  // their attached rows alone (see `groupHasContent`) — counting those said
  // "several accounts" for a screen showing one, and suppressed its only
  // balance. The final filter below is narrower still, and counting THAT let a
  // screen with two titled-but-empty regions collect the grand total onto a
  // phantom account.
  const identified = groups.filter(isReportable);

  // Fall back to the summary figure when the screen stated no balance of its
  // own — the single-account-overview case described at `summaryAmounts`.
  //
  // The summary row often carries more than one figure ("我的资产 +0.88
  // 5,203.47" pairs the total with yesterday's gain; a card summary pairs the
  // balance with the amount due), and the account's balance is the biggest of
  // them. Taking the first would read the gain, not the balance.
  //
  // Biggest by MAGNITUDE, not by signed value: a card's total is a debt, so a
  // signed comparison let any positive figure printed beside it — a credit, a
  // day's gain — win over the balance itself.
  // At most one group, too: the fallback exists for a SINGLE-account overview
  // that states its balance only in the summary. On a multi-account screen
  // where extraction happened to fail for every account, assigning the screen's
  // grand total to `groups[0]` invents a per-account figure — worse than
  // reporting none, because the user has no way to see it is the whole screen's
  // money sitting on one account.
  if (
    summaryAmounts.length > 0 &&
    identified.length <= 1 &&
    identified.every((g) => g.balances.length === 0)
  ) {
    const largest = summaryAmounts.reduce((a, b) =>
      Math.abs(b.amount) > Math.abs(a.amount) ? b : a,
    );
    const currency = largest.currency ?? defaultCurrency;
    // No currency anywhere and no institution to fall back on — a crypto
    // exchange's "Total assets 44,503.83" on a config-less institution. The
    // figure cannot be reported, but the ACCOUNT can, exactly as the
    // per-account path does through `finish`'s `undenominated`. Dropping it
    // here returned nothing at all for a screen showing a total in plain sight.
    const balance = currency ? { currency, amount: largest.amount } : undefined;
    if (identified.length > 0) {
      if (balance) {
        identified[0].balances = [balance];
      } else {
        identified[0].sawUnstorableBalance = true;
      }
    } else {
      groups.push({
        name: "",
        lastFour: undefined,
        balances: balance ? [balance] : [],
        sawUnstorableBalance: balance === undefined,
        sourceText: summarySourceText,
        lineNumbers: [],
      });
    }
  }

  // The screen showed its only figure in a currency the app cannot store. There
  // is no balance to report, but the account is real — the same call the
  // per-account path makes, applied to the one path a single-account wallet or
  // exchange screen actually uses.
  // Only when the screen yields nothing else — including nothing the
  // last-resort rule below would report. Pushed beside a named region, this
  // nameless group satisfied `isAccountLike`, so the primary filter returned it
  // ALONE and every account the screen actually titled was dropped.
  if (summarySkipped && !groups.some(isReportable)) {
    groups.push({
      name: "",
      lastFour: undefined,
      balances: [],
      sawUnstorableBalance: true,
      sourceText: summarySourceText,
      lineNumbers: [],
    });
  }

  // See `isAccountLike`: recognition reports an account it could not fully
  // read, minus the figure it cannot represent, rather than deleting it — "the
  // form filters, the recognizer does not" (AGENTS.md). What the form does with
  // one that carries nothing else is the form's call (`isWorthDrafting`).
  const accounts = groups.filter(isAccountLike);
  if (accounts.length > 0) {
    return accounts;
  }
  // Nothing carried a figure or a number, and the screen still showed titles.
  // Reporting them beats reporting nothing: an account whose figure this parser
  // could not read is still an account, and the user gets a named draft to fill
  // in — "recognize everything visible; the form filters, the recognizer does
  // not" (AGENTS.md). The cost is that a screenshot of nothing BUT a button bar
  // yields a draft named after the buttons; the form's `isWorthDrafting` sees
  // the same thing the recognizer did, and the user deletes one row.
  //
  // This is also why the filter above can stay strict. It only has to be right
  // when a real account WAS read — which is exactly when a button bar that
  // matched an account keyword would otherwise ride along beside it.
  return groups.filter((group) => group.name !== "");
}

// The balance figures one row states, and whether any were dropped for being in
// a currency the app cannot store.
//
// The single definition of "which figures on this row are money", shared by the
// per-account path and the summary path. They ran the same four rules as two
// copies and had already drifted once — the unstorable guard had to be
// back-ported to the summary path after a JPY total was reported as ¥1,000 CNY,
// and the currency-adjacency rule had never made it across at all.
//
// `isDebt` is the row saying its figure is money OWED. Then only the labelled
// figure counts and it counts negative: everything else on a card row is
// context (the limit, the credit remaining, the minimum due). Taking every
// figure read "您花了 4,766.92 SGD 剩余额度 10,000.00 SGD" as -14,766.92 with
// all of them negated, and as +5,233.08 with only the debt negated.
function balanceAmountsOf(
  tokens: TokenWithRole[],
  lineCurrency: Currency | undefined,
  isDebt = false,
): { balances: PendingBalance[]; skippedUnstorable: boolean } {
  // Which currency token belongs to which amount depends on the row's layout,
  // and the row states it: a currency BEFORE the first figure means the codes
  // lead ("USD 100.00 SGD 200.00"), otherwise they trail ("1,212.52 HKD
  // 5,673.53 USD"). Pairing every amount with the row's first currency read
  // either row as one made-up currency and one made-up total.
  const currencyLeads = leadsWithCurrency(tokens);
  const debtAmountIndex = isDebt ? labelledDebtAmountIndex(tokens) : -1;
  const balances: PendingBalance[] = [];
  let skippedUnstorable = false;
  tokens.forEach((token, index) => {
    if (token.role !== "amount" || token.amount === undefined) {
      return;
    }
    // Everything the row will not contribute is dropped FIRST, so it cannot
    // raise the unstorable flag below: on a debt row every figure but the
    // labelled one is the card's context, and a JPY figure among them was
    // setting a flag that keeps an otherwise-empty region alive.
    if (isDebt && index !== debtAmountIndex) {
      return;
    }
    // An explicitly signed "+" figure is a gain or an inflow, never a balance:
    // "稳健理财 5,203.47 +0.88" pairs the holding with yesterday's return.
    if (token.text.trim().startsWith("+")) {
      return;
    }
    // A figure printed in a currency the app cannot store contributes nothing:
    // left currency-less it would inherit the account's own.
    if (
      token.currency === undefined &&
      isUnstorableCurrencyAmount(tokens, index, currencyLeads)
    ) {
      skippedUnstorable = true;
      return;
    }
    balances.push({
      currency:
        token.currency ??
        adjacentCurrency(tokens, index, currencyLeads) ??
        lineCurrency,
      amount: isDebt ? -Math.abs(token.amount) : token.amount,
    });
  });
  return { balances, skippedUnstorable };
}

// Collects a row's balance figures into the summary slot, returning whether any
// were found.
function captureSummaryAmounts(
  line: ClassifiedLine,
  into: PendingBalance[],
  headerCurrency?: Currency,
): { captured: boolean; skippedUnstorable: boolean } {
  // The debt rule applies here too. A card app that states its only balance in
  // the summary ("总余额 欠款 4,766.92 SGD") reported +4,766.92 — the sign
  // inversion the whole negative-balance path exists to prevent, and worth 2x
  // the account in net worth. Both per-account paths already ask this question;
  // the summary path was the one that never did.
  const { balances, skippedUnstorable } = balanceAmountsOf(
    line.tokens,
    // The header above it, when the row states no currency of its own — the
    // same fallback every per-account path applies. Without it a wallet's total
    // under a currency header was denominated by the institution's home
    // currency instead of the one the screen stated.
    lineCurrencyOf(line.tokens) ?? headerCurrency,
    statesDebt(line.text.toLowerCase()),
  );
  into.push(...balances);
  return { captured: balances.length > 0, skippedUnstorable };
}

function createGroup(name: string, nameSource = name): OpenGroup {
  return {
    name,
    nameSource,
    lastFour: undefined,
    pending: [],
    sawUnstorableBalance: false,
    sourceText: [],
    sourceLineNumbers: [],
  };
}

// Attaches one row's amount tokens to the open group: queue each as a pending
// balance (currency resolved later in `finish`) and record currencies the
// account holds. Consumes the token-level roles directly — amount tokens carry
// their pre-parsed `amount` — so the row's amount is never re-parsed.
//
// Currency pairing: an amount token's `currency` is only set when the currency
// symbol was fused into the token ("$5,000.00"). When currency is a separate
// token on the same line ("6,672.59 SGD"), the amount token has no currency —
// pair it with the line's `currency` token (there is at most one per row in
// institution overviews). A group that is still unnamed after the amount row recovers
// its name from the row's `accountName` tokens (a name+amount row like "360
// Account $5,000.00" has both roles on one line), unless the name prefix is
// just a field label.
function attachAmountFromTokens(
  group: OpenGroup,
  tokens: TokenWithRole[],
  keywordRegex: RegExp,
  iconTags: string[],
  lineCurrency: Currency | undefined,
  isDebt = false,
): void {
  const { balances, skippedUnstorable } = balanceAmountsOf(
    tokens,
    lineCurrency,
    isDebt,
  );
  group.pending.push(...balances);
  // Remembered, so an account whose ONLY money is in a currency the app cannot
  // store still reaches the form.
  group.sawUnstorableBalance ||= skippedUnstorable;
  if (!group.name) {
    const candidate = accountNameFromTokens(tokens, keywordRegex, iconTags);
    if (candidate) {
      group.name = candidate.name;
      // Recorded with the name, like every other naming site. Left at "", the
      // repeat-absorb guard compared the next title row against an empty string
      // and never fired — so a card titled on its own balance row and repeated
      // below became two accounts holding the same money twice. (An empty
      // `nameSource` is also a false positive waiting to happen: any row whose
      // name tokens are all filtered out compares equal to it.)
      group.nameSource = candidate.source;
    } else {
      // A foreign-currency account is named after its currency, so the row
      // reads "美元 美元 5,673.53" — the account's title, the currency label,
      // and the balance, with the title indistinguishable from the label except
      // by position. The REPEAT is the evidence, which is why two leading
      // currency tokens are required: a single one is just a balance row's
      // currency ("SGD 1,234.56" under an untitled card was being named "SGD",
      // pre-filling the form's account name with a currency code).
      //
      // Read past the row's chrome, like its twin on the header path: a bullet
      // OCR'd at the start of the row is not the first token, and testing raw
      // positions cost the account its name — and with it its kind.
      const leading = leadingRepeatedCurrency(tokens);
      if (leading) {
        group.name = leading;
        group.nameSource = leading;
      }
    }
  }
}

// Whether an open group has accumulated any content worth keeping (a name, a
// card last-four, a queued amount, or any attached row text).
function groupHasContent(group: OpenGroup): boolean {
  return (
    group.name !== "" ||
    group.lastFour !== undefined ||
    group.pending.length > 0 ||
    group.sourceText.length > 0
  );
}

// Cleans a set of account-name tokens into the account's real display name.
// Institution overview rows carry OCR/card-apparatus noise that should not be part of
// the stored name:
// - Trailing navigation chevrons / arrows: skipped (navArrow tokens are never
//   `accountName`, so they're already excluded by the caller's filter).
// - A leading icon tag that duplicates or prefixes the real name: the beige
//   circle icon renders as a word before the name. "360 360 Account" is the
//   icon "360" + the real name "360 Account" (same leading token); "GSA
//   Global Savings Account" is the icon label "GSA" + the real name. When the
//   remaining tokens after the first already form a complete account name
//   (contain an account keyword), the first token is icon noise.
// Conservative: only strips a single leading token when the rest is clearly
// still a full account name — real single-token account names ("Savings",
// "Cash") are never split.
//
// `iconTags` and `keywordRegex` are institution-specific: the icon tags are the
// detected institution's (e.g. OCBC's "360"/"GSA"/"STS"), and the keyword regex
// is the shared defaults plus the institution's product keywords. Both come from the
// `InstitutionConfig` passed to `groupIntoAccounts`.
export function cleanAccountName(
  nameTokens: TokenWithRole[],
  keywordRegex: RegExp,
  iconTags: string[],
): string {
  let texts = nameTokens.map((t) => t.text);
  if (texts.length === 0) {
    return "";
  }
  // Card artwork can leave MORE than one fragment in front of the name — the
  // same OCBC card reads "200RO 355 OCBC 365 Credit Card" on one Vision
  // version — so stripping runs until the leading token is real.
  for (;;) {
    // Icon-tag strip: drop the first token when it's clearly icon apparatus, NOT
    // the account's own identifying name:
    // - The first token is one of the institution's icon tags ("360"/"GSA"/"STS") AND
    //   the rest already forms a full account name (has a keyword).
    // - OR the first token repeats the next token exactly ("360 360 Account").
    // A single-token rest is NOT stripped, so "360" is kept as the identifier —
    // otherwise every "<X> Account" name would lose its distinguishing X.
    if (texts.length <= 1) {
      break;
    }
    const first = texts[0];
    const rest = texts.slice(1);
    const firstIsIconTag = iconTags.some(
      (tag) => first.toLowerCase() === tag.toLowerCase(),
    );
    // A leading token mixing several digits with letters is OCR lifted off the
    // card's artwork, not part of the name — "200RO OCBC 365 Credit Card" is a
    // fragment of the card design followed by the real name. Requiring two
    // digits AND a letter AND four characters keeps the identifying tokens of
    // real names ("360", "GSA") out of it.
    const firstIsArtworkNoise =
      first.length >= 4 &&
      (first.match(/\d/g) ?? []).length >= 2 &&
      /\p{L}/u.test(first) &&
      !keywordRegex.test(first);
    // A purely numeric leading token in front of an already-complete name is
    // also card artwork — the same OCBC card reads as "200RO …" on one Vision
    // version and "355 …" on another. `rest.length > 1` is what protects a real
    // identifier: the "360" of "360 Account" has a single-token rest and stays.
    const firstIsStrayNumber = /^\d+$/.test(first) && rest.length > 1;
    const restHasKeyword = rest.some((t) => keywordRegex.test(t));
    // An immediate repeat of the next token is the icon rendering the name's
    // first word ("360 360 Account"), so the first copy goes — with no length
    // guard, because a doubled token is never the name: ["Savings", "Savings"]
    // is one word OCR'd twice, not a two-word title. (The `rest.length > 1`
    // guard belongs to the icon-TAG clause below, where a single-token rest is
    // the account's own identifier — the "360" of "360 Account".)
    const firstRepeatsRest = first.toLowerCase() === rest[0].toLowerCase();
    if (
      (firstIsIconTag && restHasKeyword && rest.length > 1) ||
      firstRepeatsRest ||
      ((firstIsArtworkNoise || firstIsStrayNumber) && restHasKeyword)
    ) {
      texts = rest;
      continue;
    }
    break;
  }
  // An account's name ends at its last account word. Tab bars and button rows
  // run together with the title on one OCR line — "储蓄户口 付款 更多" is the
  // account followed by two other tabs — and everything after the account word
  // belongs to the chrome, not the name.
  //
  // Names whose words are all outside the keyword list ("美元", "一卡通") have
  // no such anchor and are kept whole.
  let lastKeyword = -1;
  for (let i = 0; i < texts.length; i++) {
    if (keywordRegex.test(texts[i])) {
      lastKeyword = i;
    }
  }
  const kept = lastKeyword === -1 ? texts : texts.slice(0, lastKeyword + 1);
  return kept.join(" ").trim();
}

function finish(
  group: OpenGroup,
  defaultCurrency: Currency | undefined,
): OcrAccountGroup {
  // Resolve currency-less amounts in order of evidence: the row's own currency,
  // then the nearest currency stated ABOVE it in this account, then the
  // institution's home currency, and only then a currency stated below. That
  // third step is what recognizes a domestic bank's screen at all — China
  // Merchants prints "76,007.05" with no currency marker anywhere — while never
  // overriding something the screen did say.
  //
  // Direction matters, and reading forward first was wrong: HSBC HK prints
  // "可用余额 1,000.00" (HKD, unmarked) and then a 美元 sub-account below it.
  // Taking the first currency stated ANYWHERE in the region denominated the
  // account's HKD balance in USD and then summed the two into one figure.
  // Looking backwards has no such failure mode: a currency printed above a
  // figure is the one the screen has established for it.
  const currencyAbove = (index: number): Currency | undefined => {
    for (let i = index - 1; i >= 0; i--) {
      const currency = group.pending[i].currency;
      if (currency) {
        return currency;
      }
    }
    return undefined;
  };
  // The last resort: a currency this account states only BELOW the figure. It
  // exists for a region that leads with an unmarked "Available Balance
  // 1,000.00" and names its currency afterwards, on an institution with no home
  // currency to fall back on.
  const currencyBelow = group.pending.find((p) => p.currency)?.currency;
  const balances = new Map<Currency, number>();
  // The same figure restated is one holding, not several. An overview screen
  // shows the same money at several levels of detail — Alipay prints 5,203.47
  // as the total, again as 稳健理财, and again as 基金 — so summing every
  // occurrence tripled the balance. Counting a given (currency, amount) once
  // reads the screen the way a person does.
  //
  // The cost is real and known: two genuinely distinct sub-accounts holding the
  // same non-zero figure in the same currency merge into one, so an account
  // with 港元储蓄 1,000.00 and 港元往来 1,000.00 reads as 1,000.00. (Equal ZERO
  // holdings are unaffected — 0 + 0 = 0 either way — which is the common case
  // for empty sub-accounts.)
  //
  // It is kept because no structural rule separates the two, and this has been
  // measured rather than assumed:
  //
  //   - Removing the dedupe regresses `alipay-overview` to 10,406.94, so it is
  //     load-bearing, not a leftover.
  //   - Deduping only UNLABELLED repeats (the obvious fix — a bare figure
  //     repeating one already seen) does not work: Alipay's repeats carry
  //     labels too, 稳健理财 and 基金, two categorizations of one pot. That is
  //     the same shape as HSBC's two sub-accounts.
  //   - Deduping per source line does not work either: every repeat is on its
  //     own line in both screens.
  //
  // Separating them needs a signal the layout doesn't carry — which pot a
  // labelled figure belongs to. Reporting a balance that is too LOW is the
  // safer of the two errors here, and the draft is editable.
  const counted = new Set<string>();
  // A figure the screen showed and nothing could denominate. Same consequence
  // as one in a currency the app cannot store — there is no balance to report —
  // so it is remembered the same way, and the account survives for the user to
  // complete. Dropped silently, a named account on any institution without a
  // `defaultCurrency` (which is every one not yet in `institutions/config.ts`)
  // disappeared entirely.
  let undenominated = false;
  for (const [index, { currency, amount }] of group.pending.entries()) {
    const resolved =
      currency ?? currencyAbove(index) ?? defaultCurrency ?? currencyBelow;
    if (!resolved) {
      undenominated = true;
      continue;
    }
    const key = `${resolved}:${amount}`;
    if (counted.has(key)) {
      continue;
    }
    counted.add(key);
    // Rounded, because SUMMING is where binary floats show: HSBC One's
    // 港元储蓄 1,212.52 + 港元往来 5,673.53 is 6886.049999999999 in IEEE-754,
    // and that is what the balance field pre-filled and the account stored —
    // straight into net-worth history. Six decimals, not two: it is well past
    // the precision any of these currencies prints, so it erases the artifact
    // without touching a figure the screen actually stated.
    const sum = (balances.get(resolved) ?? 0) + amount;
    balances.set(resolved, Math.round(sum * 1e6) / 1e6);
  }
  return {
    name: group.name.trim(),
    lastFour: group.lastFour,
    balances: [...balances.entries()].map(([currency, amount]) => ({
      currency,
      amount,
    })),
    sawUnstorableBalance: group.sawUnstorableBalance || undenominated,
    sourceText: group.sourceText,
    lineNumbers: group.sourceLineNumbers,
  };
}
