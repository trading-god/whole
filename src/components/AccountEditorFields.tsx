import { optionalLastFourDigitsSchema } from "@whole/ocr";
import { memo, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";

import { BalanceRowsField } from "@/components/BalanceRowsField";
import { ChoiceChipGroup } from "@/components/ChoiceChipGroup";
import { FieldShell } from "@/components/FieldShell";
import { FormField } from "@/components/FormField";
import { InstitutionPicker } from "@/components/InstitutionPicker";
import { assetKindPickerOptions } from "@/features/assets/account-appearance";
import { type AccountDraft } from "@/features/assets/account-draft";
import { type AssetAccountGroup } from "@/features/assets/asset-repository";
import {
  addBalanceRow,
  type BalanceRow,
  removeBalanceRow,
  updateBalanceRow,
} from "@/features/assets/balance-rows";
import { screenStyles } from "@/theme/screen-styles";

type AccountEditorFieldsProps = {
  // Controlled: the parent owns the draft and this component only renders it
  // and reports edits. Keeping the single source of truth above means a page
  // the user isn't looking at can still be reseeded (screenshot recognition)
  // or read (the save gate) without remounting anything.
  draft: AccountDraft;
  // Which draft this instance edits, passed back through `onChange`. Under the
  // native pager every page is mounted simultaneously, so the callback must
  // say which draft it applies to rather than relying on the visible page.
  index: number;
  // Reports an edit as an updater rather than a finished draft. That keeps the
  // handlers below independent of the current `draft`, so typing in one field
  // doesn't hand every other field a new callback identity (and re-render the
  // whole card) — and two edits batched in one tick can't drop the first.
  onChange: (
    update: (previous: AccountDraft) => AccountDraft,
    index: number,
  ) => void;
  // The edit screen locks the last four once the account has one (it is that
  // account's identity); the hint below the field explains the lock.
  lastFourEditable?: boolean;
  lastFourHint?: string;
  // Optional institution picker, rendered as the first field so the account's
  // institution is chosen inside the form rather than in a separate section
  // below. Passed by the edit screen and the single-account add flow; omitted
  // by the multi-account wizard, where the institution is a page-level
  // suggestion shared by the whole batch.
  institutions?: readonly AssetAccountGroup[];
  selectedInstitutionId?: string;
  onInstitutionChange?: (id: string) => void;
  // When provided, the institution picker offers a "create institution…"
  // entry that reveals an inline name field; the parent creates the group and
  // returns its new id.
  onCreateInstitution?: (name: string) => Promise<string | undefined>;
  // Optional institution name rendered as a free-text field at the top of the
  // card (the add-account wizard), pre-filled with the detected institution's
  // name so the user can correct a misrecognition. Mutually exclusive with the
  // InstitutionPicker props above (the edit screen uses the picker).
  institutionName?: string;
  onInstitutionNameChange?: (name: string) => void;
};

// The account form fields shared by the add-account screen's single form, its
// multi-account wizard, and the edit-account screen — one owner for the field
// set, its order, and its dividers. Memoized because the native pager mounts
// every wizard page at once and rebuilds its page array whenever the parent's
// `renderPage` closure changes (it captures the drafts): without this, editing
// one account re-renders every other account's form.
export const AccountEditorFields = memo(function AccountEditorFields({
  draft,
  index,
  onChange,
  lastFourEditable,
  lastFourHint,
  institutions,
  selectedInstitutionId,
  onInstitutionChange,
  onCreateInstitution,
  institutionName,
  onInstitutionNameChange,
}: AccountEditorFieldsProps) {
  const { t } = useTranslation();
  const accountKindOptions = useMemo(() => assetKindPickerOptions(t), [t]);
  // Whether the user is typing in the last-four field, so a half-entered number
  // is left alone until focus leaves it — the same rule the balance rows apply
  // to a half-typed figure (see `classifyBalanceRow`).
  const [lastFourEditing, setLastFourEditing] = useState(false);
  // The same schema the save gate parses (`account-draft.ts`), so the field's
  // error message and the Save button can never disagree about what a complete
  // last four is.
  const lastFourComplete = optionalLastFourDigitsSchema.safeParse(
    draft.lastFour,
  ).success;

  const patch = (next: Partial<AccountDraft>) =>
    onChange((previous) => ({ ...previous, ...next }), index);
  const patchBalances = (map: (rows: BalanceRow[]) => BalanceRow[]) =>
    onChange(
      (previous) => ({ ...previous, balances: map(previous.balances) }),
      index,
    );

  return (
    <View style={screenStyles.formCard}>
      {institutions && onInstitutionChange ? (
        <>
          <InstitutionPicker
            institutions={institutions}
            selectedInstitutionId={selectedInstitutionId ?? ""}
            onChange={onInstitutionChange}
            onCreate={onCreateInstitution}
          />
          <View style={screenStyles.fieldDivider} />
        </>
      ) : null}

      {institutionName !== undefined && onInstitutionNameChange ? (
        <>
          <FormField
            label={t("accountForm.group")}
            onChangeText={onInstitutionNameChange}
            placeholder={t("accountForm.newGroupPlaceholder")}
            value={institutionName}
          />
          <View style={screenStyles.fieldDivider} />
        </>
      ) : null}

      <FormField
        label={t("accountForm.accountName")}
        onChangeText={(name) => patch({ name })}
        placeholder={t("accountForm.accountNameExample")}
        value={draft.name}
      />

      {/* The last-four field is always shown so any account — one added by
          hand, or one whose OCR never caught a number — can have its tail four
          entered manually. Hiding it when empty would make the multi-account
          wizard's "give one a different last four" dedup hint impossible to
          act on. The 4-digit cap is enforced in JS (strip first, then slice) so
          pasting "•••• 1234" keeps the digits instead of being truncated by a
          native maxLength. */}
      <View style={screenStyles.fieldDivider} />
      <FormField
        editable={lastFourEditable}
        // The field caps at four digits but cannot stop the user at ONE.
        // `optionalLastFourDigitsSchema` takes an empty entry or exactly four,
        // so a half-typed "12" makes `draftToValidAccount` return null and Save
        // goes grey — with nothing on screen, which is the same silence the
        // balance rows' message was added to remove. Said only once focus has
        // left, for the same reason: mid-typing, "12" is on its way to "1234".
        error={
          lastFourEditing || lastFourComplete
            ? undefined
            : t("accountForm.incompleteLastFour")
        }
        keyboardType="number-pad"
        label={t("accountForm.lastFourDigits")}
        onBlur={() => setLastFourEditing(false)}
        onChangeText={(text) =>
          patch({ lastFour: text.replace(/\D/g, "").slice(0, 4) })
        }
        onFocus={() => setLastFourEditing(true)}
        placeholder="0000"
        prefix="****"
        value={draft.lastFour}
      />
      {lastFourHint ? (
        <Text style={screenStyles.fieldHint}>{lastFourHint}</Text>
      ) : null}

      <View style={screenStyles.fieldDivider} />

      <BalanceRowsField
        balanceRows={draft.balances}
        onAdd={() => patchBalances(addBalanceRow)}
        onUpdate={(rowIndex, rowPatch) =>
          patchBalances((rows) => updateBalanceRow(rows, rowIndex, rowPatch))
        }
        onRemove={(rowIndex) =>
          patchBalances((rows) => removeBalanceRow(rows, rowIndex))
        }
      />

      <FieldShell label={t("accountForm.accountKind")}>
        <ChoiceChipGroup
          options={accountKindOptions}
          value={draft.kind}
          onChange={(kind) => patch({ kind })}
        />
      </FieldShell>
    </View>
  );
});
