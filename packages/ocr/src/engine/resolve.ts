// Turns the model's answer — a set of BLOCK INDICES — into recognized accounts.
//
// This module is where the design's central claim is actually enforced. The
// model never returns a number, a name, or an account number: it returns
// positions in the block list it was shown. Every figure the app records is
// then read out of the block at that position, by the same amount parser the
// rule engine always used.
//
// The consequence is worth stating plainly: a hallucinated balance is not
// merely unlikely here, it is UNREPRESENTABLE. The worst a model can do is
// point at the wrong block — a misattribution, which a person can see in the
// draft, rather than a fabrication, which nobody can.
//
// The layer's second job is to be lossy in one direction only. A field whose
// index points nowhere, or whose block turns out to hold a label rather than a
// figure, is DROPPED — never guessed at, never defaulted. What survives is what
// the screen actually said.
import { z } from "zod";

import { assetKindSchema, lastFourDigitsSchema } from "../contract/asset-kind";
import type { OcrTextBlock } from "../contract/block";
import { currencySchema } from "../contract/currency";
import type { AccountBalance } from "../contract/balance";
import type { RecognizedAccount } from "../contract/recognized-account";

import { matchAmount } from "./amount";
import { currencyMention } from "./currency-mention";

// A position in the block list. Anything that is not a whole non-negative
// number is not an index, and rejecting that here means the resolver below
// never has to consider it.
const blockIndexSchema = z.number().int().nonnegative();

const balanceSelectionSchema = z.object({
  amountBlock: blockIndexSchema,
  /** The block naming the currency, when the screen prints one. */
  currencyBlock: blockIndexSchema.optional(),
  /**
   * The currency when the screen names none.
   *
   * The only place the model states a value rather than pointing at one, and it
   * exists because a domestic bank prints its home currency nowhere — a China
   * Merchants overview reads "76,007.05" with no symbol anywhere on screen.
   * There is no block to point at, so leaving this out would mean dropping the
   * balance of every such account.
   *
   * It is safe because the field is a closed enum: the model cannot invent a
   * currency, only choose the wrong one of four, and a wrong choice is visible
   * in the draft and correctable there.
   */
  currency: currencySchema.optional(),
  /**
   * Whether the screen presented this figure as money OWED.
   *
   * A card's balance is what you owe, and net worth is assets minus
   * liabilities, so the sign has to survive in order to be subtracted. Issuers
   * print it two ways: already signed ("-1,745.52SGD"), or as what was SPENT
   * beside a label saying so ("您花了 4,766.92"). Pure indices cannot express
   * the second — the minus is in the LABEL, not in the figure — so the model
   * reports what the label said and the resolver applies it.
   *
   * A card printing a bare positive with no such label is genuinely ambiguous
   * (debt, or an overpayment credit), so the model is expected to leave this
   * off there and let the user fix the sign in the draft.
   */
  isDebt: z.boolean().optional(),
});

const accountSelectionSchema = z.object({
  /** Blocks whose text, joined, is the account's name. */
  nameBlocks: z.array(blockIndexSchema).default([]),
  /** The block holding the account or card number. */
  lastFourBlock: blockIndexSchema.optional(),
  /**
   * The four identifying digits, when they are not simply the block's tail.
   *
   * BOCHK prints a trailing check digit — "012-394-2-033676-3" is account
   * 033676, which a person reads as 3676, not the mechanical 6763. The
   * per-institution rule that knew this is gone with the rest of the config, so
   * the model may state the digits instead.
   *
   * It still cannot invent them: the resolver requires them to appear in the
   * block the model pointed at, which keeps the provenance guarantee intact for
   * the one field where a value rather than an index is allowed.
   */
  lastFour: lastFourDigitsSchema.optional(),
  balances: z.array(balanceSelectionSchema).default([]),
  /**
   * Inferred rather than read, so it is free text — but a CLOSED enum, because
   * the asset kind is not a descriptive label: it decides what the composition
   * bar excludes and what net worth subtracts. Opening it would let a model
   * invent categories in the ledger model.
   */
  kind: assetKindSchema.optional(),
});

const institutionSelectionSchema = z.object({
  /**
   * Free text, deliberately. The authority on an institution's name is the
   * screenshot — or the product names on it — and requiring the name to
   * pre-exist in an i18n catalog is exactly the coupling this redesign removes.
   * It touches no figure, so a wrong one costs a correction, not a wrong total.
   */
  displayName: z.string().trim().min(1),
  /**
   * Other institutions the evidence fits.
   *
   * Some screens are genuinely ambiguous — "一卡通" is China Merchants Bank's
   * product name, and Wing Lung is its subsidiary and inherited it — and
   * offering the choice beats leaving the field blank.
   */
  alternates: z.array(z.string().trim().min(1)).optional(),
});

export const recognitionSelectionSchema = z.object({
  accounts: z.array(accountSelectionSchema),
  institution: institutionSelectionSchema.optional(),
});

export type RecognitionSelection = z.infer<typeof recognitionSelectionSchema>;

export type RecognizedInstitution = z.infer<typeof institutionSelectionSchema>;

export type ResolvedRecognition = {
  accounts: RecognizedAccount[];
  institution?: RecognizedInstitution;
};

function textAt(blocks: OcrTextBlock[], index: number): string | undefined {
  return blocks[index]?.text;
}

function resolveName(
  blocks: OcrTextBlock[],
  indices: number[],
): string | undefined {
  const parts = indices
    .map((index) => textAt(blocks, index))
    .filter((text): text is string => text !== undefined)
    .map((text) => text.trim())
    .filter((text) => text.length > 0);

  return parts.length > 0 ? parts.join(" ") : undefined;
}

// The four identifying digits of the account number.
//
// Two rules, in order. If the model stated them, they are used — but only after
// checking they are IN the block, which is the provenance guarantee applied to
// the one field where a value rather than an index is allowed. Otherwise the
// generic tail-four rule applies.
//
// The stated form exists because a trailing check digit makes the tail wrong:
// BOCHK's "012-394-2-033676-3" is account 033676, which a person reads as 3676,
// not the mechanical 6763. The per-institution table that knew this is gone
// with the rest of the config, so the knowledge moved into the model — where it
// costs no code per institution, which is the point of the whole redesign.
function resolveLastFour(
  blocks: OcrTextBlock[],
  index: number | undefined,
  stated: string | undefined,
): string | undefined {
  if (index === undefined) {
    return undefined;
  }

  const digits = textAt(blocks, index)?.replace(/\D/g, "") ?? "";

  // Stated digits are honoured only when they are actually in the block —
  // the provenance rule, applied to the one field where a value rather than an
  // index is allowed. Four digits that are not there are four digits invented.
  if (stated !== undefined) {
    return digits.includes(stated) ? stated : undefined;
  }

  const parsed = lastFourDigitsSchema.safeParse(digits.slice(-4));
  return parsed.success ? parsed.data : undefined;
}

function resolveBalance(
  blocks: OcrTextBlock[],
  selection: z.infer<typeof balanceSelectionSchema>,
): AccountBalance | undefined {
  const amountText = textAt(blocks, selection.amountBlock);
  if (amountText === undefined) {
    return undefined;
  }

  // The figure comes from the BLOCK, parsed by the same rules the rule engine
  // used. Pointing at a label instead of a figure is a mistake the model can
  // make; recording "可用余额" as a balance is not one this layer will make.
  const parsed = matchAmount(amountText);
  if (!parsed.ok) {
    return undefined;
  }

  const currency = resolveCurrency(blocks, selection, parsed.currency);
  if (currency === undefined) {
    return undefined;
  }

  // Applied to the MAGNITUDE, so a card that prints its sign and also carries a
  // debt label does not come out positive again. `|| 0` collapses -0, which
  // serializes as "-0" and reads as a bug on a settled card.
  const balance = selection.isDebt
    ? -Math.abs(parsed.amount) || 0
    : parsed.amount;

  return { currency, balance };
}

// Three sources, in descending order of how much the screen itself said:
// a block the model pointed at, the amount block's own text ("-1,745.52SGD"),
// then the model's stated inference. Anything the screen printed outranks
// anything the model concluded.
function resolveCurrency(
  blocks: OcrTextBlock[],
  selection: z.infer<typeof balanceSelectionSchema>,
  fromAmountBlock: AccountBalance["currency"] | undefined,
): AccountBalance["currency"] | undefined {
  if (selection.currencyBlock !== undefined) {
    const text = textAt(blocks, selection.currencyBlock);
    const mention = text === undefined ? undefined : currencyMention(text);
    if (mention) {
      return mention.currency;
    }
  }

  return fromAmountBlock ?? selection.currency;
}

/**
 * Resolves a model's selection against the blocks it was shown.
 *
 * Fields that cannot be resolved are dropped; an account left with nothing at
 * all is dropped whole, because an empty row in the draft reads as a
 * recognition failure the user then has to delete by hand.
 */
export function resolveRecognition(
  blocks: OcrTextBlock[],
  selection: RecognitionSelection,
): ResolvedRecognition {
  const accounts = selection.accounts
    .map((account): RecognizedAccount => {
      const balances = account.balances
        .map((balance) => resolveBalance(blocks, balance))
        .filter((balance): balance is AccountBalance => balance !== undefined);

      return {
        accountName: resolveName(blocks, account.nameBlocks),
        accountLastFourDigits: resolveLastFour(
          blocks,
          account.lastFourBlock,
          account.lastFour,
        ),
        balances: balances.length > 0 ? balances : undefined,
        kind: account.kind,
      };
    })
    .filter(
      (account) =>
        account.accountName !== undefined ||
        account.balances !== undefined ||
        account.accountLastFourDigits !== undefined,
    );

  return selection.institution
    ? { accounts, institution: selection.institution }
    : { accounts };
}
