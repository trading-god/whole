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
import type { Currency } from "./currencies";
import {
  isCardLike,
  matchAmount,
  prefixBeforeAmount,
  stripDateFragments,
} from "./ocr-amount";
import { hasLabelMarker } from "./ocr-line-classify";
import type { RowRole } from "./ocr-line-classify";

export type OcrAccountGroup = {
  name: string;
  lastFour: string | undefined;
  balances: { currency: Currency; amount: number }[];
  // Raw rows that fed this group; joined for detectKind's kind classification.
  sourceText: string[];
};

type ClassifiedLine = {
  text: string;
  role: RowRole;
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
  lastFour: string | undefined;
  pending: PendingBalance[];
  sourceText: string[];
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

// Groups classified lines into tentative accounts.
export function groupIntoAccounts(lines: ClassifiedLine[]): OcrAccountGroup[] {
  const groups: OcrAccountGroup[] = [];
  let open: OpenGroup | null = null;
  // True while skipping rows that belong to a summary (e.g. "Total" followed by
  // its amount on the next line) — those rows must not attach to the previous
  // account. Cleared by the next accountName.
  let discarding = false;

  for (const line of lines) {
    switch (line.role) {
      case "accountName": {
        discarding = false;
        if (open && !open.name && (open.lastFour || open.pending.length > 0)) {
          // Card-number/amount rows opened this group before its name arrived
          // — attach the name rather than closing a nameless group and losing
          // the pairing (e.g. "**** 1234" then "Checking" → one account).
          open.name = line.text;
        } else {
          if (open && groupHasContent(open)) {
            groups.push(finish(open));
          }
          open = createGroup(line.text);
        }
        open.sourceText.push(line.text);
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
          open?.sourceText.push(line.text);
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
        open.sourceText.push(line.text);
        break;
      }
      case "amountRow": {
        if (discarding) {
          break;
        }
        if (!open) {
          open = createGroup("");
        }
        attachAmount(open, line.text);
        open.sourceText.push(line.text);
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
  };
}

// Attaches one text row to the open group: if it parses as an amount, queue it
// (its currency is resolved later in `finish`); otherwise ignore it. A label
// row ("Available Balance") that doesn't parse is NOT promoted to the name —
// that used to spawn a spurious account named after the label. A name+amount
// row ("360 Account $5,000.00") recovers its leading name as the group's name
// when the group is still unnamed, unless the prefix is just a field label.
function attachAmount(group: OpenGroup, text: string): void {
  const parsed = matchAmount(text);
  if (!parsed.ok) {
    return;
  }
  group.pending.push({ currency: parsed.currency, amount: parsed.amount });
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
    name: group.name,
    lastFour: group.lastFour,
    balances: [...balances.entries()].map(([currency, amount]) => ({
      currency,
      amount,
    })),
    sourceText: group.sourceText,
  };
}
