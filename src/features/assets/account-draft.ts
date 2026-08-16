import { z } from "zod";

// The schemas come straight from `@whole/ocr` rather than through
// `asset-repository`/`screenshot-recognition`, which only re-export them: both
// of those modules import Expo native code (`expo-crypto`,
// `expo-image-manipulator`), and reaching the draft rules through them made
// this file — pure data-in/data-out, and the owner of every zero-balance and
// recognition-merge rule below — impossible to test outside a React Native
// runtime. `AssetAccount`/`NewAssetAccount` stay type-only imports, which erase
// at compile time and carry no runtime dependency.
import {
  type AssetKind,
  type RecognizedAccount,
  accountBalanceSchema,
  assetKindSchema,
  optionalLastFourDigitsSchema,
} from "@whole/ocr";

import type {
  AssetAccount,
  NewAssetAccount,
} from "@/features/assets/asset-repository";
import { type Currency } from "@/features/assets/currencies";
import {
  type BalanceRow,
  createBalanceRow,
  classifyBalanceRows,
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
  // The zero-row rule lives in the merge, which the blank seed goes through
  // like any other draft — a seed row carries no value, so it holds no
  // currency and cannot make the merge keep a zero the ADD path should drop.
  // Filtering here as well is what broke the settled card: the merge then
  // dropped the pre-filtered all-zero row again and the draft fell back to the
  // blank seed, which `draftToValidAccount` rejects.
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
// This is also where zero-balance rows are decided, for every path — see the
// rule at `keptBalances`. The recognition result itself
// (`RecognizedAccount.balances`) keeps every zero; this is the display/draft
// layer, decoupled from recognition.
export function mergeRecognizedIntoDraft(
  draft: AccountDraft,
  recognized: RecognizedAccount,
): AccountDraft {
  // A zero means two different things, told apart by what it sits beside.
  //
  // Beside real money it is an overview's empty sub-account (a DBS Multiplier
  // holds SGD 100,554.59 + HKD 0.00 + USD 0.00) — noise the draft should not
  // open with, unless the draft already tracks that currency, where the 0.00 is
  // the screenshot correcting a balance and hiding it left the stale figure in
  // place.
  //
  // Alone it is the account's whole balance: a settled card, and the corpus
  // holds three. Dropping that row left a draft `draftToValidAccount` rejects,
  // and one such card blocked Save for every other account on the screenshot.
  //
  // "Already tracks" reads the row's VALUE, not just its currency — the blank
  // seed row is a placeholder, and counting it made a US-locale seed keep an
  // overview's USD 0.00 sub-account while an SG-locale one dropped it.
  const balances = recognized.balances ?? [];
  const held = new Set(
    draft.balances
      .filter((row) => row.balance.trim().length > 0)
      .map((row) => row.currency),
  );
  const keptBalances = balances.some((balance) => balance.balance !== 0)
    ? balances.filter(
        (balance) => balance.balance !== 0 || held.has(balance.currency),
      )
    : balances;
  const recognizedRows = toBalanceRows(keptBalances);
  return {
    name: recognized.accountName ?? draft.name,
    lastFour: recognized.accountLastFourDigits ?? draft.lastFour,
    // Gated on what SURVIVES the zero filter, not on what was recognized. An
    // all-zero recognition — an emptied sub-account, a settled card — passed
    // the length check and then assigned the empty result, so the draft lost
    // its balance rows entirely: `BalanceRowsField` rendered nothing at all and
    // Save stayed disabled until the user found "add currency". Keeping the
    // rows the user already has is the right answer for a screenshot that
    // states no non-zero balance.
    balances: recognizedRows.length > 0 ? recognizedRows : draft.balances,
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

  // Through `recognizedToDraft`'s zero filter whenever there is nothing to
  // preserve — which includes the FIRST upload, where the screen's one draft is
  // the blank seed. A one-account overview (DBS Multiplier holds SGD 100,554.59
  // + HKD 0.00 + USD 0.00) otherwise opened with a row per empty sub-account.
  //
  // Merging into a draft the user has actually filled in keeps the merge's rule
  // instead: there a zero is the screenshot correcting a balance, not noise to
  // hide, and a settled card must be allowed to read 0.00.
  const existing = drafts.length === 1 ? drafts[0] : undefined;
  if (!existing || !draftHasContent(existing)) {
    return [recognizedToDraft(accounts[0], defaultCurrency)];
  }
  return [mergeRecognizedIntoDraft(existing, accounts[0])];
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

// Whether a recognized account is worth applying to a draft. This is the
// FORM-layer filter — `parseOcrBlocks` still returns these accounts (the
// recognition result keeps them, decoupled from this display decision) — and
// both consumers use it: the add wizard, which seeds one draft per account, and
// the edit screen, which merges a lone result into the account being edited.
// Only `new.tsx` filtered, so the recognizer's content-less output could
// overwrite a real account's name and kind on the edit screen and still report
// success.
//
// Identity decides first. An account the screen NAMES is worth a draft whatever
// its figures say — a card sitting at 0.00 is still the user's card, and the
// corpus holds three of them. What gets dropped is a row with no identity at
// all: an all-zero currency row from an overview's sub-account list (an empty
// holding the user didn't mean to track), and the content-less account the
// recognizer emits when a screen showed money it has no currency for — real
// enough to report, but as a draft it is a blank page the user must notice and
// remove before `canSave` will let them save the accounts beside it.
export function isWorthDrafting(account: RecognizedAccount): boolean {
  if (
    account.accountName !== undefined ||
    account.accountLastFourDigits !== undefined
  ) {
    return true;
  }
  return (account.balances ?? []).some((balance) => balance.balance !== 0);
}

// Picks the recognized row that belongs to an account already being edited.
// A lone result is trusted as-is; an institution-overview screenshot yields
// every account row, and applying an arbitrary one could overwrite this account
// with a different one's data, so among several candidates only the row
// matching the account's last four is trusted — no match, no fill.
export function selectRecognizedForAccount(
  accounts: RecognizedAccount[],
  lastFour: string | undefined,
): RecognizedAccount | undefined {
  // The count is read off the RECOGNITION, not off what survives the filter.
  // Filtering first turned a two-account screenshot whose second row was junk
  // into a "lone result", and the edit screen then applied the OTHER account's
  // name and balances to the account being edited — the hijack this function
  // exists to prevent. `isWorthDrafting` still decides whether the account it
  // picked is worth applying.
  const picked =
    accounts.length === 1
      ? accounts[0]
      : lastFour
        ? accounts.find(
            (candidate) => candidate.accountLastFourDigits === lastFour,
          )
        : undefined;
  return picked && isWorthDrafting(picked) ? picked : undefined;
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
  // One pass over the rows for both answers (see `classifyBalanceRows`): the
  // balances to store, and whether any row holds text that isn't one. The form
  // marks such a row (see `BalanceRowsField`); refusing the save here is what
  // makes the marking mean something.
  const { balances, hasUnreadable } = classifyBalanceRows(draft.balances);
  if (hasUnreadable) {
    return null;
  }
  const parsed = saveableAccountSchema.safeParse({
    name: draft.name,
    accountLastFourDigits: draft.lastFour,
    balances,
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
