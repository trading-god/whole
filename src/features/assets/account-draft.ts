import { z } from "zod";

import {
  type AssetKind,
  assetKindSchema,
} from "@/features/assets/account-appearance";
import {
  type AssetAccount,
  type NewAssetAccount,
  accountBalanceSchema,
  optionalLastFourDigitsSchema,
} from "@/features/assets/asset-repository";
import { type Currency } from "@/features/assets/currencies";
import { type RecognizedAccount } from "@/features/assets/screenshot-recognition";
import {
  type BalanceRow,
  createBalanceRow,
  deriveValidBalances,
  hasDuplicateCurrencyIn,
  toBalanceRows,
} from "@/features/assets/balance-rows";

// Editable form state for one account on the add-account screen — the single
// form and the multi-account wizard share this shape. `balances` carries the
// raw BalanceRow list (including empty rows the user is still filling in) so a
// half-typed row survives a page switch — validity is derived at save time by
// `draftToValidAccount`.
export type AccountDraft = {
  name: string;
  lastFour: string;
  balances: BalanceRow[];
  kind: AssetKind;
};

// Seeds a draft from a recognized account: the blank draft (empty name, one
// empty balance row in the default currency, "cash") overlaid with whatever
// fields the model returned. Called with an empty `recognized` ({}) this
// doubles as the blank-form seed.
export function recognizedToDraft(
  recognized: RecognizedAccount,
  defaultCurrency: Currency,
): AccountDraft {
  return mergeRecognizedIntoDraft(
    {
      name: "",
      lastFour: "",
      balances: [createBalanceRow(defaultCurrency)],
      kind: "cash",
    },
    recognized,
  );
}

// Seeds a draft from a stored account, for the edit screen. Kept here with the
// other draft constructors so "what a draft looks like" has one owner — a
// screen building its own would have to be revisited by hand whenever the
// account ⇄ draft mapping changes.
export function accountToDraft(account: AssetAccount): AccountDraft {
  return {
    name: account.name,
    lastFour: account.accountLastFourDigits ?? "",
    balances: toBalanceRows(account.balances),
    kind: account.kind,
  };
}

// Merges a recognized account into an existing draft: only fields the model
// actually returned overwrite the draft, so a partial recognition leaves what
// the user already typed untouched. The single-account form and the edit
// screen apply recognition through this; the wizard seeds fresh drafts via
// `recognizedToDraft` instead.
//
// Zero-balance rows are filtered OUT of the draft here (a DBS Multiplier
// holding SGD 100 + HKD 0 + USD 0 drops the HKD/USD rows), so the form doesn't
// show empty currency rows the user didn't mean to track. The recognition
// result itself (`RecognizedAccount.balances`) keeps the zeros — this filter
// is the display/draft layer, decoupled from recognition.
export function mergeRecognizedIntoDraft(
  draft: AccountDraft,
  recognized: RecognizedAccount,
): AccountDraft {
  return {
    name: recognized.accountName ?? draft.name,
    lastFour: recognized.accountLastFourDigits ?? draft.lastFour,
    balances:
      recognized.balances && recognized.balances.length > 0
        ? toBalanceRows(
            recognized.balances.filter((balance) => balance.balance !== 0),
          )
        : draft.balances,
    kind: recognized.kind ?? draft.kind,
  };
}

// Folds a recognition result into the add-account screen's drafts. Several
// accounts seed one draft each; a lone account merges into the current single
// draft — or starts from a blank one when leaving multi-account mode, since
// the previous drafts are superseded by the re-upload. `accounts` must be
// non-empty: the caller drops an empty recognition before reseeding, so a
// failed re-recognition can never wipe drafts the user is editing.
export function applyRecognizedToDrafts(
  drafts: AccountDraft[],
  accounts: RecognizedAccount[],
  defaultCurrency: Currency,
): AccountDraft[] {
  if (accounts.length >= 2) {
    return accounts.map((account) =>
      recognizedToDraft(account, defaultCurrency),
    );
  }

  const base =
    drafts.length === 1 ? drafts[0] : recognizedToDraft({}, defaultCurrency);
  return [mergeRecognizedIntoDraft(base, accounts[0])];
}

// Whether a draft holds anything the user would lose if it were replaced. A
// freshly seeded blank draft (empty name, one empty balance row, default kind)
// holds nothing; a draft the model filled in counts, since the user may have
// corrected it since. Backs the add screen's confirmation before a re-upload
// replaces the whole batch.
export function draftHasContent(draft: AccountDraft): boolean {
  return (
    draft.name.trim().length > 0 ||
    draft.lastFour.trim().length > 0 ||
    draft.balances.some((row) => row.balance.trim().length > 0)
  );
}

// Picks the recognized row that belongs to an account already being edited.
// A lone result is trusted as-is; a bank-overview screenshot yields every
// account row, and applying an arbitrary one could overwrite this account with
// a different one's data, so among several candidates only the row matching
// the account's last four is trusted — no match, no fill.
export function selectRecognizedForAccount(
  accounts: RecognizedAccount[],
  lastFour: string | undefined,
): RecognizedAccount | undefined {
  if (accounts.length === 1) {
    return accounts[0];
  }
  if (!lastFour) {
    return undefined;
  }
  return accounts.find(
    (candidate) => candidate.accountLastFourDigits === lastFour,
  );
}

// What makes a draft saveable, as one schema rather than a chain of guards:
// a name that isn't blank, a last four that is empty or exactly 4 digits, at
// least one valid balance row, and no currency held twice. Both string fields
// are trimmed by the schema, so the parsed output is what gets written — the
// rule and the normalization can't drift apart.
const saveableAccountSchema = z.object({
  name: z.string().trim().min(1),
  accountLastFourDigits: z.string().trim().pipe(optionalLastFourDigitsSchema),
  // The rows have already been narrowed to valid balances by
  // `deriveValidBalances`; what's left to check is that at least one survived
  // and that no currency repeats.
  balances: z
    .array(accountBalanceSchema)
    .min(1)
    .refine((balances) => !hasDuplicateCurrencyIn(balances)),
  kind: assetKindSchema,
});

// Derives a saveable account from a draft, or null when the draft isn't
// saveable yet. The save buttons' disabled state and both save paths (single
// form and wizard batch) derive from this one rule.
export function draftToValidAccount(
  draft: AccountDraft,
): NewAssetAccount | null {
  const parsed = saveableAccountSchema.safeParse({
    name: draft.name,
    accountLastFourDigits: draft.lastFour,
    balances: deriveValidBalances(draft.balances),
    kind: draft.kind,
  });
  if (!parsed.success) {
    return null;
  }

  return {
    ...parsed.data,
    // An account without a card-style number stores no last four at all,
    // rather than an empty string the dedup key would have to special-case.
    accountLastFourDigits: parsed.data.accountLastFourDigits || undefined,
  };
}
