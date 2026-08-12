// Account grouping: assembles the classified, clustered lines into tentative
// accounts. The key insight is a bank overview lists each account as a small
// region: an account-name row, an optional card/masked-number row, and
// label/amount pairs. We walk the lines top→bottom, opening an account group
// when we see an account-name line (or a card-number row that isn't the
// continuation of a name group), and attaching label/amount pairs to the open
// group via vertical adjacency.
//
// Amounts are summed per currency and the last four extracted during grouping
// itself. This module is pure and operable on recorded OCR output, so it
// composes with the eval harness.
import { currencySchema, type Currency } from "./currencies";
import {
  isCardLike,
  matchAmount,
  prefixBeforeAmount,
  stripDateFragments,
  type ParsedAmount,
} from "./ocr-amount";
import { ACCOUNT_KEYWORD_RE, hasLabelMarker } from "./ocr-line-classify";
import type { RowRole } from "./ocr-line-classify";

// A multi-currency table (a bank shows a "SGD HKD USD" header row aligned
// over "100,554.59 0.00 0.00" value row). Column-aligned parsing needs the
// token x positions, so it lives here (grouping) not in classifyRow: a single
// row classification can't see the two-row column alignment.
const COLUMN_ALIGN_TOLERANCE = 0.08;

// Whether a row's tokens are all known ISO currency codes (≥2, each with a
// position) — i.e. this row is a multi-currency header like "SGD HKD USD".
// Reuses `currencySchema` (the single definition of "what is a known currency
// code") instead of re-deriving a parallel lookup map.
function isCurrencyCode(token: string): token is Currency {
  return currencySchema.safeParse(token).success;
}

function isCurrencyHeaderRow(line: ClassifiedLine): boolean {
  const toks = line.tokens ?? [];
  if (toks.length < 2) {
    return false;
  }
  return toks.every((t) => isCurrencyCode(t.text.trim().toUpperCase()));
}

// Pairs a currency-header row's codes with the value amount in the same
// column of a following row, returning per-currency balances. Returns null
// when the value row doesn't align (same token count, x within tolerance).
function parseMultiCurrencyRow(
  header: ClassifiedLine,
  value: ClassifiedLine,
): { currency: Currency; amount: number }[] | null {
  const headerToks = header.tokens ?? [];
  const valueToks = value.tokens ?? [];
  if (headerToks.length !== valueToks.length || headerToks.length === 0) {
    return null;
  }
  const out: { currency: Currency; amount: number }[] = [];
  for (let i = 0; i < headerToks.length; i++) {
    const codeText = headerToks[i].text.trim().toUpperCase();
    if (!isCurrencyCode(codeText)) {
      return null;
    }
    if (Math.abs(headerToks[i].x - valueToks[i].x) > COLUMN_ALIGN_TOLERANCE) {
      return null;
    }
    const parsed = matchAmount(valueToks[i].text);
    if (!parsed.ok) {
      return null;
    }
    out.push({ currency: codeText, amount: parsed.amount });
  }
  return out;
}

export type OcrAccountGroup = {
  name: string;
  lastFour: string | undefined;
  balances: { currency: Currency; amount: number }[];
  // Raw rows that fed this group; joined for detectKind's kind classification.
  sourceText: string[];
  // 1-based indexes of the source `ClassifiedLine`s that fed this group.
  // Populated for the eval harness's trace; production code ignores it.
  lineNumbers: number[];
};

type ClassifiedLine = {
  text: string;
  role: RowRole;
  // Horizontal position of each originating block (0..1, center), preserved
  // for column-aligned multi-currency parsing (header + value rows). Optional
  // so the eval harness can call `groupIntoAccounts` with text-only lines.
  tokens?: { text: string; x: number }[];
};

// A balance row whose currency may not have been stated yet — resolved against
// the group's established currency in `finish`, so a leading
// "Available Balance 1,000.00" (no currency marker) isn't dropped just because
// no currency has appeared by the time the row is read.
type PendingBalance = { currency: Currency | undefined; amount: number };

// Opened-group state while scanning lines. Amount rows are queued as pending
// balances and resolved to a currency in `finish` once the group's currency is
// established (see PendingBalance). `establishedCurrencies` tracks which
// currencies the account actually holds (set as amount rows attach), so a
// trailing amount row whose currency is NOT held (e.g. an "equivalent in SGD"
// total on a CNY/USD card) can be recognized as a converted display, not a
// real balance.
type OpenGroup = {
  name: string;
  lastFour: string | undefined;
  pending: PendingBalance[];
  sourceText: string[];
  sourceLineNumbers: number[];
  establishedCurrencies: Set<Currency>;
};

// Extracts a last-four from card-number text: keep only digits and take the
// tail 4. Date-like fragments ("08/26", "12/05/2024") are removed first so a
// trailing (or leading) expiry doesn't blend into the card's last four
// ("**** 1234 08/26" → "1234", not "0826"). Returns undefined when fewer than
// 4 digits remain.
function lastFourFromCardText(text: string): string | undefined {
  const cardPart = stripDateFragments(text);
  // Only the digit run adjacent to the mask chars is the card's last four —
  // a balance sharing the line ("**** 1234 $5,000.00") would otherwise
  // contaminate it with the amount's digits.
  const match = cardPart.match(/[·•*]+\s*(\d+)/);
  if (!match) {
    return undefined;
  }
  const digits = match[1];
  return digits.length >= 4 ? digits.slice(-4) : undefined;
}

// Whether a row is a converted/aggregate total display — "Available in 3
// currencies ( SGD 100,554.59" (a multi-currency account's whole balance
// restated in the base currency) or "Equivalent in SGD 2,009.85" (a
// foreign-currency card's converted total). These aggregate the whole account
// into one display number: the amount is a summary, not a per-currency
// holding, so it must not be added to balances (it would double-count the
// same holding a currency table or per-currency rows already report). It also
// does NOT end the account region — it's an attached display inside the open
// account, unlike a real summary block ("Total") which discards following
// rows. The "currencies" arm is anchored to "in <digits> currencies" so a
// real balance row like "Currencies Held: SGD 1,234.56" is NOT swallowed.
const EQUIVALENT_TOTAL_RE = /\b(?:equivalent|in\s+\d+\s+currencies)\b/i;

// Whether the row is a converted/aggregate total written in a currency the
// account does NOT hold: on a CNY/USD card, a trailing "2,009.85 SGD" is the
// total restated in SGD (each holding converted), not a real SGD balance.
// Only kicks in once the account has established ≥1 held currency, only for a
// currency outside that set, and never for a sub-account row that carries the
// chevron ">" (a real per-currency row is tappable — "0.00 USD >" is a current
// USD sub-account, not a conversion). A single-currency account's own balance
// (360's only "6,672.59 SGD") is never affected.
function isConvertedTotalAmount(
  group: Pick<OpenGroup, "establishedCurrencies">,
  amount: { currency: Currency | undefined },
  text: string,
): boolean {
  return (
    group.establishedCurrencies.size > 0 &&
    amount.currency !== undefined &&
    !group.establishedCurrencies.has(amount.currency) &&
    // A tappable sub-account row is a holding, not a conversion total.
    !/>\s*$/.test(text.trim())
  );
}

// Records a source row against the open group: its text (for detectKind) and
// its 1-based line index (for the eval trace). Centralized so every case that
// attaches a row stays in lockstep, instead of repeating the pair of pushes.
function attachSource(
  open: OpenGroup | null,
  line: ClassifiedLine,
  lineIndex: number,
): void {
  open?.sourceText.push(line.text);
  open?.sourceLineNumbers.push(lineIndex + 1);
}

// Groups classified lines into tentative accounts.
//
// Region boundaries: an account is a small visual region on a bank screen — a
// real account name plus its attached rows (account number, balance). Screen
// scaffolding that OCR classifies as accountName (nav tabs like "Overview Bank
// & Earn Manage", shortcut icons, block headers) is NOT a new region. So the
// grouping step treats an accountName line as a NEW region only when it looks
// like a real account name (contains an account word such as "Account"/"Savings"
// /"Card"); otherwise it's scaffolding attached to the open region, which keeps
// an account's balance from being split across scaffolding rows.
function isRealAccountName(text: string): boolean {
  return ACCOUNT_KEYWORD_RE.test(text);
}

export function groupIntoAccounts(lines: ClassifiedLine[]): OcrAccountGroup[] {
  const groups: OcrAccountGroup[] = [];
  let open: OpenGroup | null = null;
  // True while skipping rows that belong to a summary (e.g. "Total" followed by
  // its amount on the next line) — those rows must not attach to the previous
  // account. Cleared by the next accountName.
  let discarding = false;
  // A detected multi-currency header row ("SGD HKD USD") awaiting its
  // column-aligned value row on the next line. Null unless one is pending.
  let pendingCurrencyHeader: ClassifiedLine | null = null;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];

    // If the previous line was a currency header, try to consume THIS line as
    // its aligned value row (e.g. "100,554.59 0.00 0.00"). Column-aligned
    // pairing is the multi-currency table read — it wins over treating the
    // value row as a name/amount on its own.
    if (pendingCurrencyHeader) {
      const header = pendingCurrencyHeader;
      pendingCurrencyHeader = null;
      if (open) {
        const parsed = parseMultiCurrencyRow(header, line);
        if (parsed) {
          for (const { currency, amount } of parsed) {
            open.pending.push({ currency, amount });
            // Track held currencies so a trailing converted-total row in a
            // currency the table does NOT hold is recognized as a display
            // (see isConvertedTotalAmount) — same as attachAmount does for
            // single-currency amount rows.
            open.establishedCurrencies.add(currency);
          }
          attachSource(open, line, lineIndex);
          continue;
        }
      }
    }

    // A currency header row ("SGD HKD USD") is not a name — it opens a
    // multi-currency table awaiting its aligned value row. Don't open a new
    // account for it; remember it and let the next line be consumed above.
    if (isCurrencyHeaderRow(line)) {
      pendingCurrencyHeader = line;
      continue;
    }

    switch (line.role) {
      case "accountName": {
        discarding = false;
        // A real account name closes the previous region and opens a new one.
        // Scaffolding that OCR classified as accountName (nav tabs, shortcut
        // labels) stays attached to the open region instead of splitting the
        // account apart — that's what keeps "DBS Multiplier Account" from
        // being decoupled from its balance by the "Overview Bank & Earn
        // Manage" nav row above the balance.
        if (isRealAccountName(line.text)) {
          if (open && open.name && groupHasContent(open)) {
            groups.push(finish(open));
          }
          open = createGroup(line.text);
          attachSource(open, line, lineIndex);
        } else {
          // Scaffolding accountName: don't close the open region; keep it as
          // source context so the real account's rows below aren't mis-assigned.
          if (!open) {
            open = createGroup(line.text);
          }
          attachSource(open, line, lineIndex);
        }
        break;
      }
      case "cardNumber": {
        if (discarding) {
          break;
        }
        // A classifier-flagged card number always carries a last four — but be
        // conservative about a row that slips through classification without
        // card shape ("1,234.56" has 6 digits and can't yield a last four).
        if (!isCardLike(line.text)) {
          attachSource(open, line, lineIndex);
          break;
        }
        // If a card-number row starts a region (no open name group yet), open
        // one; if it follows a name group, it belongs to that account.
        if (!open) {
          open = createGroup("");
        }
        const lastFour = lastFourFromCardText(line.text);
        if (lastFour && !open.lastFour) {
          open.lastFour = lastFour;
        }
        attachSource(open, line, lineIndex);
        break;
      }
      case "amountRow": {
        if (discarding) {
          break;
        }
        if (!open) {
          open = createGroup("");
        }
        // An equivalent/aggregate total row ("Available in 3 currencies ( SGD
        // 100,554.59", "Equivalent in SGD 2,009.85") is a display summary, not
        // a per-currency holding — don't add it to balances (it would
        // double-count the currency table), but keep it attached to the open
        // account so it never splits the region. `parsedAmount` is reused for
        // `attachAmount` below so the row's amount is parsed once, not twice.
        const parsedAmount = matchAmount(line.text);
        if (
          EQUIVALENT_TOTAL_RE.test(line.text) ||
          (parsedAmount.ok &&
            isConvertedTotalAmount(open, parsedAmount, line.text))
        ) {
          attachSource(open, line, lineIndex);
          break;
        }
        attachAmount(open, line.text, parsedAmount);
        attachSource(open, line, lineIndex);
        break;
      }
      case "summaryRow": {
        // A summary row aggregates the whole account, never an account itself.
        // Close the open group so a following summary amount doesn't leak into
        // it, then discard rows until the next accountName.
        if (open && groupHasContent(open)) {
          groups.push(finish(open));
        }
        open = null;
        discarding = true;
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

  if (open && groupHasContent(open)) {
    groups.push(finish(open));
  }

  // Drop groups that wound up with no name and no last four and no balance —
  // pure noise that slipped through classification.
  return groups.filter((g) => g.name || g.lastFour || g.balances.length > 0);
}

function createGroup(name: string): OpenGroup {
  return {
    name,
    lastFour: undefined,
    pending: [],
    sourceText: [],
    sourceLineNumbers: [],
    establishedCurrencies: new Set<Currency>(),
  };
}

// Attaches one text row to the open group: if it parses as an amount, queue it
// (its currency is resolved later in `finish`) and record the currency as held
// by this account; otherwise ignore it. A label row ("Available Balance") that
// doesn't parse is NOT promoted to the name — that used to spawn a spurious
// account named after the label. A name+amount row ("360 Account $5,000.00")
// recovers its leading name as the group's name when the group is still
// unnamed, unless the prefix is just a field label. The caller passes the
// already-parsed amount so the row's amount is matched once, not twice.
function attachAmount(
  group: OpenGroup,
  text: string,
  parsed: ParsedAmount,
): void {
  if (!parsed.ok) {
    return;
  }
  group.pending.push({ currency: parsed.currency, amount: parsed.amount });
  if (parsed.currency) {
    group.establishedCurrencies.add(parsed.currency);
  }
  if (!group.name) {
    const prefix = prefixBeforeAmount(text);
    if (prefix && !hasLabelMarker(prefix.toLowerCase())) {
      group.name = prefix;
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

// Cleans a raw account-name row into the account's real display name. Bank
// overview rows carry OCR/card-apparatus noise that should not be part of the
// stored name:
// - A trailing navigation chevron / arrow: "360 Account >" → "360 Account".
// - A leading icon tag that duplicates or prefixes the real name: the beige
//   circle icon renders as a word before the name. "360 360 Account" is the
//   icon "360" + the real name "360 Account" (same leading token); "GSA
//   Global Savings Account" is the icon label "GSA" + the real name. When the
//   remaining words after the first token already form a complete account
//   name (contain "Account"/"Savings" etc.), the first token is icon noise.
// Conservative: only strips a trailing arrow or a single leading token when
// the rest is clearly still a full account name — real single-token account
// names ("Savings", "Cash") are never split.
const TRAILING_ARROW_RE = /\s*[>›»]\s*$/;
// `cleanAccountName` decides whether the "rest" after a candidate icon tag is
// itself a full account name. It reuses the shared account-keyword regex,
// plus `360` — a brand product token (DBS 360) that reads as a complete name
// on its own ("360 360 Account" → rest "360 Account"; "360 Account" → rest
// "Account") but is NOT a generic account keyword, so it stays out of the
// shared regex used by region-boundary / noise classification.
const NAME_REST_WORD_RE = new RegExp(`(360|${ACCOUNT_KEYWORD_RE.source})`, "i");

export function cleanAccountName(raw: string): string {
  let name = raw.trim().replace(TRAILING_ARROW_RE, "");
  // Icon-tag strip: split "360 360 Account" / "GSA Global Savings Account".
  // Strip the first token only when it's clearly icon apparatus, NOT the
  // account's own identifying name:
  // - The first token repeats the next token exactly ("360 360 Account").
  // - OR the rest is a MULTI-WORD full name and the first token is a short
  //   (<=3) icon label ("GSA Global Savings Account", "STS Statement ...",
  //   a leading "<" nav arrow). This can over-strip a real ≤3-char bank
  //   prefix ("DBS Multiplier Account") when no leading icon precedes it;
  //   the deeper fix is layout-based icon detection, kept as a known
  //   limitation for now.
  // A single-word rest ("360 Account" → rest "Account") is NOT stripped, so
  // "360" is kept as the identifier — otherwise every "<X> Account" name
  // would lose its distinguishing X.
  const firstSpace = name.indexOf(" ");
  if (firstSpace > 0) {
    const first = name.slice(0, firstSpace);
    const rest = name.slice(firstSpace + 1).trim();
    if (!NAME_REST_WORD_RE.test(rest)) {
      return name;
    }
    const restIsMultiWord = rest.includes(" ");
    const firstRepeatsRest =
      first.toLowerCase() === rest.split(" ")[0].toLowerCase();
    if ((restIsMultiWord && first.length <= 3) || firstRepeatsRest) {
      name = rest;
    }
  }
  return name.trim();
}

function finish(group: OpenGroup): OcrAccountGroup {
  // Resolve currency-less amounts to the group's first explicitly-stated
  // currency, so a leading currency-less balance folds into the currency a
  // later row establishes instead of being silently dropped.
  const establishedCurrency = group.pending.find((p) => p.currency)?.currency;
  const balances = new Map<Currency, number>();
  for (const { currency, amount } of group.pending) {
    const resolved = currency ?? establishedCurrency;
    if (resolved) {
      balances.set(resolved, (balances.get(resolved) ?? 0) + amount);
    }
  }
  return {
    name: cleanAccountName(group.name),
    lastFour: group.lastFour,
    balances: [...balances.entries()].map(([currency, amount]) => ({
      currency,
      amount,
    })),
    sourceText: group.sourceText,
    lineNumbers: group.sourceLineNumbers,
  };
}
