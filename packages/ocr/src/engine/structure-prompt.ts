// The STRUCTURE turn: what the model is asked when the engine does not know
// where the accounts are.
//
// The hybrid's default division — engine reads structure, model annotates
// semantics — is measured and it holds, but only where the engine has an
// `InstitutionConfig` written against the screen. Where it does not, the
// grouping state machine has no case for the layout and fails in the one way
// that matters: `packages/ocr-eval`'s synthetic corpus, twelve screens from
// institutions nothing knows, reads 0/12 with accountName at 15% — and the
// characteristic failure is not a missing field but a fabricated one. Every
// figure on the screen lands in a single region and is SUMMED, so a four-account
// US overview is reported as one account holding the total of all four, and a
// broker's net liquidation is reported as net liquidation plus buying power
// plus maintenance margin. That number reaches net worth.
//
// So on an unknown institution the model is asked the structural question
// instead — and asked it in the only form that cannot make things worse:
//
//   which LINE titles each account, which line carries its number, and which
//   lines carry its balance.
//
// Line numbers, never values. The engine still reads every name, digit and
// figure off the tokens it parsed (`assembleAssignedAccounts`), so a wrong
// answer can misplace a real figure but cannot state one, cannot misspell an
// account and cannot invent a currency. That is a strictly smaller blast radius
// than the rules currently have on these screens, where the invented total is
// produced deterministically and with no model involved at all.
//
// It is also the EASIER question. A 2B model doing the whole extraction scored
// 0–71% per field (see `docs/ocr-redesign.md`); this asks it to select from a
// numbered list of rows the engine has already parsed, with the rows carrying
// money already marked. Selection over a short list is what a small model can
// do; free extraction is what it cannot.
//
// The turn still carries the institution and home-currency questions, because
// they are needed on exactly this screen and asking them separately would be a
// second inference for facts one turn already has in context.
import { z } from "zod";

import {
  HOME_CURRENCY_QUESTION,
  INSTITUTION_QUESTION,
  annotationKindSchema,
  homeCurrencySchema,
  institutionAnswerSchema,
} from "./annotation-fields";

/**
 * The highest line number the grammar can express.
 *
 * The compiled digit range grows with the bound, and 99 keeps it to two digits
 * — the same reasoning that caps region numbers at 63 in the annotation turn.
 * The corpus's densest screen clusters to 26 lines; a screen longer than 99
 * lines has its tail unaddressable, which costs the accounts down there rather
 * than corrupting the ones above.
 */
const MAX_LINE_NUMBER = 99;

/** No screen lists more accounts than this, and an unbounded array is a loop. */
const MAX_ASSIGNED_ACCOUNTS = 24;

/** A multi-currency account states a handful of figures, not a column of them. */
const MAX_BALANCE_LINES = 8;

/** The answer for an account that shows no account number. */
const NO_NUMBER_LINE = 0;

const assignedAccountSchema = z.object({
  /**
   * The line that titles this account.
   *
   * `min(1)`, not `nonnegative()`: the prompt numbers from 1, so 0 could never
   * name a line — and a grammar advertising it as legal is worse than dead,
   * because a model answering 0-based would produce a fully contract-holding
   * answer with every account off by one and nothing to retry.
   */
  name: z.number().int().min(1).max(MAX_LINE_NUMBER),
  /**
   * The line carrying the account number, or 0 when the title row carries it
   * (or there is none).
   *
   * The one field here whose decline value is 0 rather than an empty list: an
   * account has at most one number, and `0` reads as "look at the title row",
   * which is where a number sits when it has no row of its own.
   */
  number: z.number().int().min(NO_NUMBER_LINE).max(MAX_LINE_NUMBER),
  /**
   * The lines whose figures are this account's BALANCE — not its credit limit,
   * its buying power, its margin requirement, its interest rate or its
   * transactions.
   *
   * An array because one account can state several currencies on several rows,
   * and empty because an account genuinely may show no figure. Required rather
   * than defaulted: a default is how a grammar learns the key is skippable, and
   * a skipped `balance` is indistinguishable from "this account has no figure".
   */
  balance: z
    .array(z.number().int().min(1).max(MAX_LINE_NUMBER))
    .max(MAX_BALANCE_LINES),
  /** What kind of account this is, or `unknown`. */
  kind: annotationKindSchema,
});

// KEY ORDER IS DECISION ORDER. A grammar-constrained decode emits the object's
// keys in the order the schema declares them, so whatever comes first is
// answered with nothing but the screen in context, and whatever comes last is
// answered with the model's own earlier answers in front of it.
//
// `accounts` therefore leads. It is the question this turn exists for, it is
// the one that needs the model's full attention, and the two world-knowledge
// questions after it are easier once the accounts have been worked out — naming
// the institution is simpler having just read its products. Declared the other
// way round (the annotation turn's order, inherited without thinking about it),
// the 2B spent its first tokens deciding a home currency for a screen it had
// not read yet, and answered "none" on a mainland bank overview it then went on
// to parse perfectly.
export const structureSchema = z.object({
  /**
   * One entry per account on the screen, in the order they are printed. An
   * empty array is the answer for a screen holding no accounts at all.
   */
  accounts: z.array(assignedAccountSchema).max(MAX_ASSIGNED_ACCOUNTS),
  institution: institutionAnswerSchema,
  homeCurrency: homeCurrencySchema,
});

/** The JSON Schema the structure turn's grammar is compiled from. */
export function structureJsonSchema(): unknown {
  return z.toJSONSchema(structureSchema, { io: "input" });
}

const SYSTEM_PROMPT = `You read a bank, broker or crypto-exchange screenshot that OCR has already turned into numbered lines. A rules engine has parsed each line but does not know this institution's layout, so it cannot tell which lines belong to which account. That is your job.

Each line is printed as \`NN|mm text\`, where \`NN\` is the line number and \`mm\` are markers the engine put there:
  \`$\` the engine read a money figure on this line
  \`#\` the engine read identifying digits (an account or card number) on this line

Answer three things.

1. The ACCOUNTS on this screen, in the order they are printed. Give LINE NUMBERS only — the engine reads every name, digit and figure off the lines you name, so quoting text cannot help and a wrong number is the only mistake you can make.

   "name"    the line carrying the account's OWN name. Most screens put the name on the same line as its figure, so this is usually a \`$\` line. A heading that sits ABOVE several accounts and groups them — "CHECKING", "SAVINGS", "DEPOSITS", "存款", "SPOT" — is not an account's name; neither is a status bar, an app title, a greeting or a tab bar.
   "number"  the line carrying its account or card number — usually a \`#\` line — or 0 when the name line already carries it or there is none.
   "balance" the lines whose figures are this account's BALANCE. Only \`$\` lines can be balances. Leave out an available credit, a credit limit, buying power, a margin requirement, an interest rate, a transaction, a maturity date, and any screen-wide total — each is a well-formed figure that is not this account's balance, and naming one reports money the user does not have.
   "kind"    "cash" (deposit, checking, wallet), "investment" (securities, funds, wealth products), "crypto" (an exchange or on-chain account), or "unknown".

   A line belongs to at most ONE account.

   Worked example. Given these lines:
     1|   9:41 5G
     2|   Accounts
     3|   CHECKING
     4|$# Everyday Checking （...4821） $3,204.57
     5|   Available balance
     6|   CREDIT CARDS
     7|$# Rewards Card （...1129） -$1,482.36
     8|   Current balance
     9|$  Available credit $8,517.64
    10|$  Total balance $1,722.21
   the answer is:
     {"accounts":[{"name":4,"number":0,"balance":[4],"kind":"cash"},{"name":7,"number":0,"balance":[7],"kind":"cash"}], ...}
   Lines 3 and 6 are headings, line 9 is not a balance, and line 10 is the screen's total — none of them is an account.

2. ${INSTITUTION_QUESTION}

3. ${HOME_CURRENCY_QUESTION}

Report line numbers only. Do not restate a name, a number or an amount.`;

/**
 * Builds the system and user turns for one structure pass.
 *
 * The markers are the one thing the prompt gives away, and they are the
 * engine's own reading rather than a hint: a line it parsed no figure on cannot
 * become a balance however it is assigned (`assembleAssignedAccounts` drops the
 * reference), and a line it read no digits on cannot yield a last four. Marking
 * them tells the model which answers are AVAILABLE rather than which are right.
 *
 * Measured, both of them. Without `$` the model routinely named the caption row
 * under a figure — "Available balance" — and the account came back with no money
 * at all. Without `#`, and without the worked example above, the bundled 2B
 * answered with the section HEADING as the account's name on five of nine
 * synthetic screens ("CHECKING", "DEPOSITS", "存款"), which is the one mistake
 * that costs both the name and the figure: the heading's line carries no
 * figure, so the account came back empty and the real row went unclaimed.
 */
export function buildStructurePrompt(
  lines: readonly { text: string; hasAmount: boolean; hasDigits: boolean }[],
): { system: string; user: string } {
  const rendered = lines
    .slice(0, MAX_LINE_NUMBER)
    .map(
      (line, index) =>
        `${String(index + 1).padStart(2, " ")}|${line.hasAmount ? "$" : " "}${line.hasDigits ? "#" : " "} ${line.text}`,
    )
    .join("\n");
  return {
    system: SYSTEM_PROMPT,
    user: `SCREEN LINES:\n${rendered}`,
  };
}
