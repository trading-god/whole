// Amount parsing for OCR text rows. Bank screens are noisy: amounts show up
// with currency symbols, thousands separators (`,`/`'`/space), optional CR/DR or
// a negative sign, and sometimes a trailing suffix after a space ("1,234.56
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
import type { Currency } from "./currencies";
import { currencyMention } from "./ocr-currency";

export type ParsedAmount = {
  amount: number;
  currency: Currency | undefined;
  ok: boolean;
};

// The numeric blob this parser recognizes: optional sign, integer group-of-
// digits separated by `,`/`'`/space (ML Kit word-splitting can render
// "1 100.00"), plus any decimal tail. Lax on purpose — strictness (exactly 2
// decimals, no dangling fragment) is applied in `toParsed`, which keeps the
// regex readable instead of layering lookarounds onto it. Exported as a string
// so the currency-adjacent search can re-emit it.
const NUMBER_SOURCE = String.raw`(?:-\s*)?(?:\d{1,3}(?:[,' ]\d{3})+|\d+)(?:\.\d+)?`;
const NUMBER_RE = new RegExp(NUMBER_SOURCE);
const NUMBER_GLOBAL_RE = new RegExp(NUMBER_SOURCE, "g");

// Card-mask characters as they print in masked card numbers ("•••• 4242",
// "**** 1234", "4111 **** **** 1234"). Shared by the amount guard and the row
// classifier so the mask morphology lives in one place.
const MASK_CHARS = "·•*";
const MASKED_CARD_RE = new RegExp(`[${MASK_CHARS}]{2,}(?:\\s*\\d{2,4})?`);

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

// Removes date-like fragments (expiry "08/26", full date "12/05/2024") from an
// OCR line. A date sharing a row with a balance must not trip the card/amount
// guards, and a trailing expiry must not blend into a card's last four.
export function stripDateFragments(text: string): string {
  return text.replace(/\d{1,2}\/\d{1,2}(?:\/\d{2,4})?/g, " ");
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
    re = new RegExp(
      `(?:${escapedToken}\\s*(${NUMBER_SOURCE}))|(?:(${NUMBER_SOURCE})\\s*${escapedToken})`,
      "i",
    );
    anchoredAmountCache.set(escapedToken, re);
  }
  return re;
}

export function matchAmount(text: string): ParsedAmount {
  const cleaned = stripDateFragments(text);
  const mention = currencyMention(cleaned);
  let raw: string | undefined;
  if (mention) {
    const ocrToken = mention.token.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
    // `(number) <sym>` or `<sym> (number)` — the number is captured alone so
    // `toParsed` never sees the currency token. Anchored to the mention index
    // within a small window so a far-away account-number doesn't shadow the
    // balance ("360 Account $5,000.00" still reads 5,000).
    const windowStart = Math.max(0, mention.index - 30);
    const windowEnd = Math.min(cleaned.length, mention.index + 30);
    const windowed = cleaned.slice(windowStart, windowEnd);
    const m = windowed.match(anchoredAmountRegex(ocrToken));
    raw = m ? (m[1] ?? m[2]) : undefined;
  }
  if (!raw) {
    raw = cleaned.match(NUMBER_RE)?.[0];
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
    if (raw && !/[,'']/.test(raw) && !/\.\d{2}$/.test(raw)) {
      return { amount: 0, currency: undefined, ok: false };
    }
  }
  if (!raw) {
    return { amount: 0, currency: undefined, ok: false };
  }
  return toParsed(raw, mention?.currency);
}

function toParsed(token: string, currency: Currency | undefined): ParsedAmount {
  const rawNumber = token.replace(/[,' ]/g, "");
  // Strict fraction: exactly 0 or 2 decimal places. A longer fractional tail
  // ("1,234.567") is not a well-formed amount — reject rather than truncate,
  // and a bare integer followed by a dot ("1,234. -") never appears here.
  const dot = rawNumber.indexOf(".");
  if (dot !== -1 && rawNumber.length - dot - 1 !== 2) {
    return { amount: 0, currency: undefined, ok: false };
  }
  const amount = Number(rawNumber);
  // A zero balance is a real balance — "0.00" (an empty sub-account) must be
  // recognized, not dropped. Whether a zero-balance account is worth carrying
  // into the form is the FORM layer's decision (`deriveValidBalances`), not
  // the OCR layer's: OCR's job is to read the balance correctly (including 0),
  // the form's job is to decide what to keep. Only a negative figure (which
  // a screenshot never shows as a plain amount) and a card-like string are
  // rejected here.
  if (!Number.isFinite(amount) || amount < 0 || isCardLike(token)) {
    return { amount: 0, currency: undefined, ok: false };
  }
  return { amount, currency, ok: true };
}

// The trimmed text that precedes the currency-anchored amount in `text` — the
// part that isn't the number — used by the grouping step to recover an account
// name from a name+amount line ("360 Account $5,000.00" → "360 Account").
// Returns "" when the amount starts the row or there's no currency mention.
export function prefixBeforeAmount(text: string): string {
  const cleaned = stripDateFragments(text);
  const mention = currencyMention(cleaned);
  if (!mention) {
    return "";
  }
  // Currency-before-number ("$5,000.00", "SGD 1,234.56"): prefix is everything
  // before the token. Number-before-currency ("360 Account 5,000.00 SGD"):
  // prefix is everything before the LAST number before the token (the amount —
  // the name may itself carry digits, so we find the trailing amount, not the
  // first digit run).
  const afterToken = cleaned.slice(mention.index + mention.token.length);
  if (/^\s*\d/.test(afterToken)) {
    return cleaned.slice(0, mention.index).trim();
  }
  const beforeToken = cleaned.slice(0, mention.index);
  const beforeNumbers = [...beforeToken.matchAll(NUMBER_GLOBAL_RE)];
  const last = beforeNumbers[beforeNumbers.length - 1];
  if (!last || last.index === undefined) {
    return "";
  }
  return beforeToken.slice(0, last.index).trim();
}
