// Amount parsing for OCR text rows. Institution screens are noisy: amounts show
// up with currency symbols, thousands separators (`,`/`'`/space), an optional
// negative sign, and sometimes a trailing suffix after a space ("1,234.56
// HKD" or "Available 1,234.56"). `matchAmount` extracts the first well-formed
// money-like number and returns it with the currency the text names (if any).
//
// A row can carry its account name beside the balance ("360 Account $5,000.00"
// on one line). Matching must therefore prefer the number that sits next to a
// stated currency mention (if any) rather than grabbing the row's first digit
// run — that's how the account name's own digits ("360") survive.
//
// Deliberately conservative: when the text looks like a number but the digits
// don't form a sane amount (a date "12/05", a phone number, a card number
// "**** 1234", a negative figure a screenshot never shows as a plain amount),
// we return `ok: false` and the caller treats the row as not an amount. A
// zero balance "0.00" IS a real balance — OCR reads it (including 0) and the
// form layer decides whether to keep it. The parser is heuristic — the UI's
// review/edit loop absorbs the misses.
import type { Currency } from "../contract/currency";
import { currencyMention } from "./currency-mention";
import { escapeRegExp } from "../text";

// A discriminated union, not a struct with an `ok` flag: on failure there is no
// amount and no currency, and modelling that as `{ amount: 0 }` made a rejected
// row look like a legitimate zero balance to anything that forgot to check
// `ok`. Callers branch on `.ok` and narrow for free.
export type ParsedAmount =
  { ok: true; amount: number; currency: Currency | undefined } | { ok: false };

const NOT_AN_AMOUNT: ParsedAmount = { ok: false };

// The numeric blob this parser recognizes: optional sign GLUED to the digits,
// integer group-of-digits separated by `,`/`'`/space (ML Kit word-splitting can
// render "1 100.00"), plus any decimal tail.
//
// The space separator makes "360 100.00" read as 360100 in isolation, which
// looks like an account number fusing with its balance — but it cannot reach a
// balance that way, and the reason is where each caller gets its text. The
// token classifier and the multi-currency pairing both pass ONE OCR block, so a
// space inside the text really is inside the block, which is the ML Kit case.
// Only `classifyRow` passes a whole joined row, and all it decides there is the
// row's ROLE; the figures still come from the per-token pass. Verified
// end-to-end: a row of blocks "360" + "100.00" recognizes a balance of 100, and
// a single block "1 100.00" recognizes 1,100.
//
// The sign may not be separated by whitespace. Spaced, a hyphen is a separator
// between two fields ("Everyday Global - 1,234.56"), and reading it as a sign
// turned a balance into a debt — the same rule `anchoredAmountRegex` states for
// the sign that precedes a currency symbol. Lax on purpose — strictness (exactly 2
// decimals, no dangling fragment) is applied in `toParsed`, which keeps the
// regex readable instead of layering lookarounds onto it. Exported as a string
// so the currency-adjacent search can re-emit it.
const NUMBER_SOURCE = String.raw`-?(?:\d{1,3}(?:[,' ]\d{3})+|\d+)(?:\.\d+)?`;
export const NUMBER_RE = new RegExp(NUMBER_SOURCE);
// `NUMBER_RE` unanchored (it matches any digit run inside the text), so it
// can't tell a whole amount from a dangling fragment the merge step splits off
// a larger figure. This anchored variant matches only a complete, standalone
// amount — the token classifier uses it to decide the previous token already
// forms a full amount and needs no merge.
export const WHOLE_AMOUNT_RE = new RegExp(`^${NUMBER_SOURCE}$`);

// Card-mask characters as they print in masked card numbers ("•••• 4242",
// "**** 1234", "4111 **** **** 1234"). Shared by the amount guard and the row
// classifier so the mask morphology lives in one place.
const MASK_CHARS = "·•*";
// Either a mask run with the card's tail digits beside it ("**** 1234"), or a
// run long enough to be a mask on its own and not followed by a letter
// ("•••• •••• ••••").
//
// The letter guard and the 4-char floor are what keep footnote markers out: a
// disclaimer row beginning "**Terms and conditions apply" was a card-number
// row, and in grouping that both discards any balance on the row and — on a
// number-last institution — ends the account above it.
const MASKED_CARD_RE = new RegExp(
  `[${MASK_CHARS}]{2,}\\s*\\d{2,4}|[${MASK_CHARS}]{4,}(?!\\p{L})`,
  "u",
);

// A masked card: 2+ mask chars, optionally followed by a short digit run
// ("•••• 4242"), or a fully-masked row ("•••• •••• ••••", common in overview
// UIs that hide the full number). A sub-pattern of `isCardLike`, exported
// separately so the row classifier flags a masked card as a cardNumber row
// even under the amount-like tests.
export function isMaskedCard(text: string): boolean {
  return MASKED_CARD_RE.test(text);
}

// Whether the text is card-shaped: a masked card, or 16 consecutive digits, or
// 4-group-of-4 digits ("4111 1111 1111 1111"). Amounts with thousands
// separators are excluded by the presence of `,`/`'`. Used both to reject
// non-money numbers in `matchAmount` and to classify cardNumber rows.
export function isCardLike(text: string): boolean {
  return (
    isMaskedCard(text) ||
    /\d{16}/.test(text) ||
    /\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b/.test(text)
  );
}

// Removes date-like fragments from an OCR line: a slash date (expiry "08/26",
// full date "12/05/2024") or a hyphenated one in either order — ISO year-first
// ("2025-08-15") and day-first ("15-08-2025"). A date sharing a row with a
// balance must not trip the card/amount guards, and a trailing expiry must not
// blend into a card's last four.
//
// A hyphenated date read as a digit run is 8+ characters of `[\d-]`, which is
// exactly the standalone-account-number shape: a statement-date row was
// classified `cardNumber` and fabricated an account whose last four was the
// year. Both hyphen forms therefore need the year spelled out (19xx/20xx) and
// are fenced off from neighbouring digits and hyphens, so a real account number
// is never mistaken for a date — the SG hyphen format is `275-023637-2` and
// BOCHK's is `012-394-2-033676-3`, neither of which carries a year group.
const DATE_FRAGMENT_RE = new RegExp(
  [
    String.raw`\d{1,2}\/\d{1,2}(?:\/\d{2,4})?`,
    String.raw`(?<![\d-])(?:19|20)\d{2}-\d{1,2}-\d{1,2}(?![\d-])`,
    String.raw`(?<![\d-])\d{1,2}-\d{1,2}-(?:19|20)\d{2}(?![\d-])`,
  ].join("|"),
  "g",
);

export function stripDateFragments(text: string): string {
  return text.replace(DATE_FRAGMENT_RE, " ");
}

// A percentage is a rate of change, not money. Institution screens print one
// beside almost every total ("63,714 -327 -0.51%", "-S$28,120.74 (-38.42%)"),
// and reading it as an amount both invents a balance and, once negatives became
// valid balances, silently shifted real ones.
//
// Removing the fragment rather than rejecting the whole row is what keeps the
// figure NEXT to it readable — "63,714 -0.51%" still yields 63,714.
//
// The `%` must be GLUED to the figure. Allowing a space between them let the
// row path swallow a real balance with a stray "%" block clustered to its
// right ("SGD 1,234.56 %" — a column header, a rate glyph), taking the account
// with it. A genuinely split rate is caught one layer down, by the token
// classifier, which can tell a currency-adjacent figure from a rate.
const PERCENT_FRAGMENT_RE = /-?\s*\d[\d,.']*%/g;

export function stripPercentages(text: string): string {
  return text.replace(PERCENT_FRAGMENT_RE, " ");
}

// Finds the well-formed money-like number in `text`. When the row names a
// currency, the number adjacent to that mention wins (currency-anchored) so a
// row like "360 Account $5,000.00" reads the balance, not the name's "360";
// otherwise the first well-formed number wins. Shares its definition of
// "well-formed" with the row classifier via `matchAmount`.
//
// Currency-anchored regexes are keyed by the escaped currency token: the token
// set is small and fixed (ISO codes + symbols), so caching avoids recompiling
// the same pattern on every amount row.
const anchoredAmountCache = new Map<string, RegExp>();
function anchoredAmountRegex(escapedToken: string): RegExp {
  let re = anchoredAmountCache.get(escapedToken);
  if (!re) {
    // The leading-symbol layout prints the sign BEFORE the symbol
    // ("-S$4,766.92"), outside `NUMBER_SOURCE`'s own optional sign — so the
    // minus was dropped and a card's debt was recognized as an asset, which is
    // the one error the whole negative-balance path exists to prevent.
    //
    // The sign has to be glued to the symbol. Spaced, a hyphen is a separator
    // ("Savings - S$1,000.00"), and reading that as a debt would be the same
    // mistake in the other direction.
    re = new RegExp(
      `(?:(-)?${escapedToken}\\s*(${NUMBER_SOURCE}))|(?:(${NUMBER_SOURCE})\\s*${escapedToken})`,
      "i",
    );
    anchoredAmountCache.set(escapedToken, re);
  }
  return re;
}

// Whether `text` has the shape that distinguishes a real money figure from a
// bare integer, when NOTHING on the row names a currency: a thousands separator
// (`,`/`'`) or a two-decimal tail. A bare digit run ("360") is an account
// name's number, not a balance. Shared with the token classifier so "what
// counts as a well-formed amount" lives here once.
//
// Two decimals exactly, not one. With no currency in sight, a one-decimal
// figure is far more often a rate, a tenor, or a quantity than money — an
// "Interest rate 3.5" row was being read as a 3.50 balance and summed into the
// account's real one.
export function hasAmountShape(text: string): boolean {
  return hasGroupedThousands(text) || /\.\d{2}$/.test(text);
}

// A well-formed thousands grouping — the separator doing the job that makes it
// money's tell. Merely CONTAINING a `,` is not: an OCR misread of "1.23" as
// "1,23", or a split-off fragment like "6,", both carry one and neither is a
// figure, so a bare "6" was passing the shape test and landing in a balance.
//
// Anchored to the digit run, not to the whole token, so a fused symbol
// ("$5,000.00") and a trailing OCR glyph ("1,212.52⑦") still read.
const GROUPED_THOUSANDS_RE = /(?:^|[^\d,'])\d{1,3}(?:[,']\d{3})+(?![\d,'])/;

function hasGroupedThousands(text: string): boolean {
  return GROUPED_THOUSANDS_RE.test(text);
}

// The looser shape accepted once the screen names a currency beside the figure.
// One decimal place is then real money: Bitget Wallet renders its total as
// "$403.3", and requiring two rejected the only figure on that screen that
// mattered. The currency is what makes the difference — a rate is not printed
// with a currency symbol glued to it.
export function hasCurrencyAmountShape(text: string): boolean {
  return hasAmountShape(text) || /\.\d$/.test(text);
}

// A magnitude suffix attached to a figure: 亿 (10^8), 万 (10^4), or the Latin
// K/M/B. The parser applies no multiplier, so reading "3.51亿美元" as 3.51 is
// wrong by eight orders of magnitude and "15.8K" as 15.8 by three. Rejecting
// the figure is the honest outcome — a balance that is off by 1000× is worse
// than one the form asks the user to fill in.
//
// Both halves require a DIGIT immediately before the suffix, so ordinary copy
// containing the character ("升百万保障") is untouched.
//
// The Latin half stands down when the next character could make the suffix the
// first letter of a WORD: a letter or digit ("1.5Km", "3Mbps"), or the `&`/`/`
// that join one ("5,000.00 M&A", "1,234.56 B/F"). Anything else — a space, the
// end of the row, or the stray glyph OCR glues on ("$15.8K⑦", and the corpus
// already carries "1,212.52⑦") — is a real magnitude, and reading it unscaled
// would be wrong by three orders of magnitude.
// The CJK suffixes need a word guard the Latin ones get from `(?![a-z0-9])`:
// 万 and 亿 start ordinary words. Glued to the figure ("1.5万元", "3.51亿美元")
// it is always a magnitude; separated by a space it only counts when the next
// character isn't Han, so "5,000.00 万事达卡" (Mastercard) keeps its balance.
const MAGNITUDE_SUFFIX = String.raw`(?:[亿億万萬]|\s*(?:[亿億万萬](?!\p{Script=Han})|[KMB](?![a-z0-9&/])))`;

// Whether the figure `raw` — the one this parser actually selected — carries a
// magnitude suffix in `text`.
//
// Tested against the SELECTED number, not the whole row. Row-wide, any
// unrelated suffixed token discarded the real balance beside it: a fixed
// deposit printing its tenor ("Time Deposit 12M SGD 50,000.00") lost the
// 50,000.00 and the account with it.
// Cached like `anchoredAmountRegex` above, and for the same reason: this runs
// once per row in `classifyRow` and again per token in `classifyTokens`, so a
// 200-block screenshot was compiling hundreds of throwaway patterns on the path
// `contract/currency.ts` measures as the parser's hot one. The figure text
// repeats across those calls, so the cache hits.
// Bounded, unlike `anchoredAmountCache` and `productPatternCache`: those are
// keyed by fixed vocabularies (currency tokens, configured product names) and
// cannot grow, while this one is keyed by arbitrary OCR figure text. Unbounded
// it retained a compiled pattern per distinct figure for the life of the app
// process. The hits that matter are within one screenshot — the same figure is
// asked about once per row and again per token — so a small window keeps the
// saving without the leak.
const MAGNITUDE_CACHE_LIMIT = 256;
const magnitudeCache = new Map<string, RegExp>();

function isMagnitudeScaled(text: string, raw: string): boolean {
  let re = magnitudeCache.get(raw);
  if (!re) {
    re = new RegExp(`${escapeRegExp(raw)}${MAGNITUDE_SUFFIX}`, "iu");
    if (magnitudeCache.size >= MAGNITUDE_CACHE_LIMIT) {
      magnitudeCache.clear();
    }
    magnitudeCache.set(raw, re);
  }
  return re.test(text);
}

// The first figure in `text` that is shaped like money — a thousands separator
// or a two-decimal tail. Scanning rather than testing the first run is what
// lets a real balance survive a stray figure earlier on its row.
const NUMBER_RE_GLOBAL = new RegExp(NUMBER_SOURCE, "g");

function firstShapedNumber(text: string): string | undefined {
  NUMBER_RE_GLOBAL.lastIndex = 0;
  for (
    let match = NUMBER_RE_GLOBAL.exec(text);
    match !== null;
    match = NUMBER_RE_GLOBAL.exec(text)
  ) {
    if (hasAmountShape(match[0]) && !isFragmentOfALongerFigure(match, text)) {
      return match[0];
    }
  }
  return undefined;
}

// Whether a well-formed match is really a PIECE of a malformed figure beside
// it. Scanning for the first sound figure is what lets a balance survive card
// artwork on its row ("$59 1,234.56"), but the same scan happily pulled a sound
// figure out of an unsound one: "12,34.56" yielded 34.56 and "1,23,456.78"
// yielded 23,456.78, each silently dropping a leading digit group, and "1,234."
// yielded 1234 — the clipped cents `toParsed` rejects by name. A figure glued
// to a digit or a separator on either side is not the figure; the row states
// something this parser cannot read, and reading nothing is the honest answer.
function isFragmentOfALongerFigure(
  match: RegExpExecArray,
  text: string,
): boolean {
  const before = text[match.index - 1];
  const after = text[match.index + match[0].length];
  return (
    (before !== undefined && /[\d,'.]/.test(before)) ||
    (after !== undefined && /[\d,'.]/.test(after))
  );
}

export function matchAmount(text: string): ParsedAmount {
  const cleaned = stripPercentages(stripDateFragments(text));
  const mention = currencyMention(cleaned);
  let raw: string | undefined;
  // The figure exactly as it appears in `cleaned`. `raw` may carry a sign that
  // sits on the far side of the currency symbol ("-¥1.5万"), and the magnitude
  // search below looks for the figure IN the text — handed the synthesized
  // "-1.5" it found nothing, so a signed scaled figure slipped through the
  // guard and read as -1.5 instead of -15,000.
  let figureInText: string | undefined;
  if (mention) {
    const ocrToken = escapeRegExp(mention.token);
    // `(number) <sym>` or `<sym> (number)` — the number is captured alone so
    // `toParsed` never sees the currency token. Anchored to the mention index
    // within a small window so a far-away account-number doesn't shadow the
    // balance ("360 Account $5,000.00" still reads 5,000).
    const windowStart = Math.max(0, mention.index - 30);
    const windowEnd = Math.min(cleaned.length, mention.index + 30);
    const windowed = cleaned.slice(windowStart, windowEnd);
    const m = windowed.match(anchoredAmountRegex(ocrToken));
    // Groups: 1 = a sign glued before the symbol, 2 = the figure after it,
    // 3 = the figure before a trailing symbol.
    figureInText = m ? (m[2] ?? m[3]) : undefined;
    raw = m ? (m[2] === undefined ? m[3] : `${m[1] ?? ""}${m[2]}`) : undefined;
    // A currency symbol is a strong signal, but not strong enough to turn a
    // bare integer into a balance. OCR reads fragments of card artwork as
    // "$59", and a real balance is written with a thousands separator or a
    // two-decimal tail even when it's a round number.
    if (raw && !hasCurrencyAmountShape(raw)) {
      raw = undefined;
      figureInText = undefined;
    }
  }
  if (!raw) {
    // The first WELL-FORMED figure, not the first digit run. Taking the first
    // run and then rejecting it for shape threw the row away over a number that
    // was never a candidate: "$59 1,234.56" — card artwork clustered onto a
    // balance row — re-picked the "59" the currency-anchored branch had just
    // rejected and reported no amount at all.
    raw = firstShapedNumber(cleaned);
    figureInText = raw;
    // The fallback grabs the first digit run, which may be an account name's
    // own number ("360 Account"). Require thousands grouping or a 2-decimal
    // shape so a bare integer doesn't masquerade as a balance — the anchored
    // match above already handled currency-paired amounts.
    //
    // Only `,`/`'` count as "thousands grouping" here, NOT the literal space
    // separator: ML-Kit word-splitting renders "1 100.00" (with a decimal tail)
    // but a space-joined bare integer ("360 360 Account") is an account name's
    // digits, not a balance — treating space as grouping would merge "360 360"
    // into 360360 and misclassify a name row as an amount.
  }
  if (!raw || isMagnitudeScaled(cleaned, figureInText ?? raw)) {
    return NOT_AN_AMOUNT;
  }
  return toParsed(raw, mention?.currency);
}

export function toParsed(
  token: string,
  currency: Currency | undefined,
): ParsedAmount {
  // A separator has to be separating thousands. Stripping every `,`/`'`/space
  // and calling `Number` on the rest turned "1,23" — how OCR renders "1.23" off
  // a screen printing a decimal comma — into 123, and the fragment "6," into 6.
  // Both are silently 10-100x wrong, which is worse than reading nothing.
  const written = /\d[\d,' ]*/.exec(token)?.[0] ?? "";
  if (/[,' ]/.test(written) && !/^\d{1,3}(?:[,' ]\d{3})+$/.test(written)) {
    return NOT_AN_AMOUNT;
  }
  const rawNumber = token.replace(/[,' ]/g, "");
  // Up to two decimal places. Two is the usual money format, but one is real:
  // Bitget Wallet renders its total as "$403.3", and requiring exactly two
  // rejected the only figure on the screen that mattered. Three or more is not
  // a currency amount (it's a crypto quantity or a rate) — reject rather than
  // truncate.
  // One or two decimal places when a dot is present. Zero — "1,234." — is OCR
  // that clipped the cents, and reading it as a whole number turns a lost digit
  // into a confident wrong figure.
  const dot = rawNumber.indexOf(".");
  if (dot !== -1) {
    const decimals = rawNumber.length - dot - 1;
    if (decimals < 1 || decimals > 2) {
      return NOT_AN_AMOUNT;
    }
  }
  const amount = Number(rawNumber);
  // A zero balance is a real balance — "0.00" (an empty sub-account) must be
  // recognized, not dropped. Whether a zero-balance account is worth carrying
  // into the form is the FORM layer's decision (`deriveValidBalances`), not
  // the OCR layer's: OCR's job is to read the balance correctly (including 0),
  // the form's job is to decide what to keep.
  //
  // A NEGATIVE balance is real too. Every credit-card account states its
  // balance as a debt — "-4,766.92 SGD" on an OCBC 365 card, "-1,745.52 SGD" on
  // an HSBC Live+ — so rejecting negatives (as this once did, on the theory
  // that "a screenshot never shows a plain negative amount") silently dropped
  // the balance of every card account.
  if (!Number.isFinite(amount) || isCardLike(token)) {
    return NOT_AN_AMOUNT;
  }
  return { ok: true, amount, currency };
}
