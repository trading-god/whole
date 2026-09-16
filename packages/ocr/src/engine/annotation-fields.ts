// The three questions every model turn asks, whichever turn it is.
//
// Recognition runs one of two turns depending on what the engine already knows.
// A configured institution gets the ANNOTATION turn (`annotate-prompt.ts`): the
// engine grouped the screen and the model labels the regions. An institution
// nothing knows gets the STRUCTURE turn (`structure-prompt.ts`): the engine
// cannot be trusted to have found the regions at all, so the model assigns the
// lines and the engine reads the values.
//
// What the two share is everything that is not about structure — the
// institution's name, the screen's home currency, an account's kind — because
// those are world knowledge about the institution either way. They live here so
// the two schemas cannot drift into asking the same question two ways, which
// would leave two prompts, two grammars and two sets of decline values to keep
// in step.
//
// The SCHEMAS and decline values are shared unconditionally. Of the WORDINGS,
// `INSTITUTION_QUESTION` is used by both prompts verbatim;
// `HOME_CURRENCY_QUESTION` is currently the structure turn's only — the
// annotation prompt keeps its own, older wording because that is what its
// 17/17 was measured on, and `annotate-prompt.ts` says so where it diverges.
// Closing that gap is an eval run, not an edit.
//
// EVERY FIELD IS REQUIRED, with a decline value rather than optionality. That
// is a measurement, not a preference: as optional fields the bundled Gemma 4
// E2B simply never emitted them (see "Every annotation field is required" in
// the package README). A new field here should be required with a way to
// decline, never optional.
import { z } from "zod";

import { assetKindSchema } from "../contract/asset-kind";
import { knownAssetCurrencies } from "../contract/currency";

/** The answer for a venue with no home currency — a broker, an exchange. */
export const NO_HOME_CURRENCY = "none";

/** The answer for an account whose kind the model could not tell. */
export const UNKNOWN_KIND = "unknown";

/** The answer for a screen the model could not place. */
export const UNPLACEABLE_INSTITUTION = "unknown";

/** Long enough for any institution's name, short enough to bound the grammar. */
const MAX_INSTITUTION_NAME_LENGTH = 64;

/** A handful of candidate readings is plausible; a longer list is a loop. */
const MAX_INSTITUTION_ALTERNATES = 4;

/**
 * What this institution's app means by a bare figure, or `none`.
 *
 * A closed enum, so the compiled grammar makes an unstorable currency
 * undecodable rather than merely rejected. The app could not store a "JPY"
 * answer anyway, and a retry spent on one would be a retry spent on nothing.
 */
export const homeCurrencySchema = z.enum([
  ...knownAssetCurrencies,
  NO_HOME_CURRENCY,
] as const);

/** An account's kind, or the way to decline. */
export const annotationKindSchema = z.enum([
  ...assetKindSchema.options,
  UNKNOWN_KIND,
] as const);

/**
 * Which institution this screen belongs to. `displayName: "unknown"` is how the
 * model declines.
 */
export const institutionAnswerSchema = z.object({
  // `min(1)` with no `.trim()`: the grammar compiled from this schema
  // (minLength: 1) accepts any single character, and a grammar-legal answer
  // cannot be a retryable violation. A whitespace-only name means "could not
  // name it" — `resolveInstitutionAnswer` reads it as absent, the same as the
  // sentinel.
  //
  // Bounded, for the same reason a line number is: an unbounded string compiles
  // to an unbounded grammar rule, and a 2B quant that falls into a repetition
  // loop then runs to the output ceiling mid-string. The answer is unparseable
  // JSON, and all three attempts go the same way.
  displayName: z.string().min(1).max(MAX_INSTITUTION_NAME_LENGTH),
  alternates: z
    .array(z.string().min(1).max(MAX_INSTITUTION_NAME_LENGTH))
    .max(MAX_INSTITUTION_ALTERNATES)
    .optional(),
});

/** What the model called the institution, once the declines are filtered out. */
export type RecognizedInstitution = {
  displayName: string;
  alternates?: string[];
};

/**
 * The institution answer as the app should read it.
 *
 * Two ways to say "could not place it", both read as absent rather than
 * retried — asking again would put the same question to the same model.
 * `unknown` is the one the prompt asks for; a grammar-legal whitespace-only
 * name is the one the schema cannot forbid (see the note above).
 */
export function resolveInstitutionAnswer(
  institution: z.infer<typeof institutionAnswerSchema>,
): RecognizedInstitution | undefined {
  const declined = institution.displayName.trim().toLowerCase();
  if (declined === "" || declined === UNPLACEABLE_INSTITUTION) {
    return undefined;
  }
  return {
    displayName: institution.displayName,
    alternates: institution.alternates?.filter(
      (alternate) => alternate.trim() !== "",
    ),
  };
}

/** The shared wording of the institution question, used by both prompts. */
export const INSTITUTION_QUESTION = `The INSTITUTION (a bank, a broker, or a crypto exchange) this screen belongs to. The brand name may not appear anywhere on the screen; infer it from product names, account-number format, vocabulary and marketing copy — those identify an institution as reliably as a logo. This answer is required: give the institution's name, or exactly "unknown" if you cannot place the screen. If two fit, name the likelier and list the other as an alternate.`;

/**
 * The wording of the home-currency question, used by the STRUCTURE prompt.
 * `annotate-prompt.ts` keeps an older wording of its own — see the note there.
 *
 * It deliberately UNCOUPLES this answer from the institution one. The wording
 * used to say a screen you could not place has no home currency, and that cost
 * exactly the screens it was meant to protect: the bundled 2B read a mainland
 * bank's overview perfectly — every account, every line number, every kind —
 * declined to name the bank because no brand appears on it, and then answered
 * `none`, which drops every bare figure on the screen. The account came back
 * with a name and no money.
 *
 * It is also kept SHORT, which is not a style preference. The first rewrite
 * spelled the reasoning out over three paragraphs and the 2B's structure
 * answer degraded with it — it dropped an account and both number lines from a
 * screen it had previously read completely. A small model's instruction budget
 * is finite and this is the least important of the three questions.
 */
export const HOME_CURRENCY_QUESTION = `The screen's HOME CURRENCY — what this app means by a figure that names no currency. Answer ${knownAssetCurrencies.join(", ")}, or "none". Answer "none" only for a venue holding many currencies (a broker, a crypto exchange, a multi-currency wallet), because there the base currency is the owner's setting and guessing reports money the user does not have. Otherwise answer the currency, inferred from the screen's own language and vocabulary even when you could not name the institution: 可用余额 / 尾号 is a mainland bank and prints CNY, 可用結餘 / 戶口 a Hong Kong one and prints HKD.`;
