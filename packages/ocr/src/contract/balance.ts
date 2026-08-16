// The persisted per-currency balance shape for a stored account. Kept as a
// pure zod module (no React Native / Expo imports) so the on-device OCR
// recognition contract (`recognized-account.ts`) and the Node eval harness can
// import it without pulling in the RN bundler.
//
// `currency` uses `currencySchema` (the explicit supported-currency list), and
// `balance` is a plain number — this is the smallest unit the recognizer and
// the storage layer must agree on. `asset-repository` re-exports this so the
// runtime storage module and the pure recognition contract share one source of
// truth without the recognition side depending on the storage module.
import { z } from "zod";

import { currencySchema } from "./currency";

export const accountBalanceSchema = z.object({
  currency: currencySchema,
  balance: z.number(),
});

export type AccountBalance = z.infer<typeof accountBalanceSchema>;

// A balance as typed into a form: grouping separators stripped, then parsed as
// a number. Lives beside `accountBalanceSchema` so "what is a valid balance"
// has one definition whether it arrives from a keyboard or from the recognizer.
//
// Both zero and NEGATIVE values are valid balances. Zero is an empty
// sub-account. Negative is a debt: a credit card's balance is what you owe, and
// net worth is assets minus liabilities, so it has to reach the total in order
// to be subtracted from it. While this rejected negatives, the recognizer read
// a card's -4,766.92 correctly and the form silently dropped the row.
//
// An empty entry is not a balance of zero. `Number("")` is 0, so without the
// emptiness check a blank field would parse as a real zero balance — callers
// happen to filter blanks first, but the schema shouldn't depend on that.
// `z.number()` rejects NaN, so a non-numeric entry (or a lone "-") is invalid.
// The shapes a person types, and nothing else: an optional sign, digits either
// plain or grouped in threes, an optional decimal tail.
//
// Stripping every separator and trusting `Number` accepted a great deal more
// than that — "1,23" became 123, "12,34.56" became 1234.56, "1 2 3" became 123,
// "0x10" became 16 and "1e3" became 1000. The engine's own `toParsed` rejects
// exactly those, by name, as "silently 10-100x wrong, which is worse than
// reading nothing"; a schema that claims one definition "whether it arrives
// from a keyboard or from the recognizer" has to reject them too. It matters
// more since the balance field moved to a keyboard with a comma on it.
//
// The decimal tail is NOT capped at two places here, unlike the recognizer's:
// what a person types is what they mean, and the display formats it.
const TYPED_BALANCE_RE = /^-?(?:\d{1,3}(?:[,\s]\d{3})+|\d+)(?:\.\d+)?$/;

// A entry that is on its way to being valid: the lone "-" of a debt, a trailing
// separator or decimal point, a group still being typed. Not a balance — the
// save gate rejects it like any other — but not something to complain about
// either, because the user is mid-keystroke. "-4766.92" passes through "-",
// "-4", … "-4766." on the way in, and marking each of those as an error made
// the message flash under the field while a perfectly good figure was typed.
// Judged by whether it can still BECOME valid — the entry plus a digit or
// three. A permissive pattern was not enough: "1,2,3" and "1 2 3" matched it
// and were therefore never reported, so the field stayed silent while Save
// stayed grey, which is the symptom the message exists to explain.
const PARTIAL_COMPLETIONS = ["", "0", "00", "000"];

export function isPartialBalanceEntry(value: string): boolean {
  const trimmed = value.trim();
  // A lone "-" IS in progress: it is the first keystroke of every negative
  // balance, and calling it wrong flashed the message under the field the
  // instant a user started typing "-4766.92". What must not stay silent is a
  // row LEFT holding it — that disables Save — and the caller answers that with
  // `editing`, which is false the moment focus leaves the field.
  if (trimmed.length === 0) {
    return false;
  }
  return PARTIAL_COMPLETIONS.some((completion) =>
    TYPED_BALANCE_RE.test(trimmed + completion),
  );
}

export const balanceInputSchema = z
  .string()
  .transform((value) => value.trim())
  .refine((value) => TYPED_BALANCE_RE.test(value))
  .transform((value) => Number(value.replace(/[,\s]/g, "")))
  .pipe(z.number());
