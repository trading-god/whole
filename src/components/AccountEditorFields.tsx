import { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";

import { BalanceRowsField } from "@/components/BalanceRowsField";
import { ChoiceChipGroup } from "@/components/ChoiceChipGroup";
import { FieldShell } from "@/components/FieldShell";
import { FormField } from "@/components/FormField";
import { assetKindPickerOptions } from "@/features/assets/account-appearance";
import { type AccountDraft } from "@/features/assets/account-draft";
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
}: AccountEditorFieldsProps) {
  const { t } = useTranslation();
  const accountKindOptions = useMemo(() => assetKindPickerOptions(t), [t]);

  const patch = (next: Partial<AccountDraft>) =>
    onChange((previous) => ({ ...previous, ...next }), index);
  const patchBalances = (map: (rows: BalanceRow[]) => BalanceRow[]) =>
    onChange(
      (previous) => ({ ...previous, balances: map(previous.balances) }),
      index,
    );

  return (
    <View style={screenStyles.formCard}>
      <FormField
        label={t("accountForm.accountName")}
        onChangeText={(name) => patch({ name })}
        placeholder={t("accountForm.accountNameExample")}
        value={draft.name}
      />

      <View style={screenStyles.fieldDivider} />

      {/* The 4-digit cap is enforced in JS, not via maxLength: the native
          maxLength truncates BEFORE onChangeText runs, so pasting formatted
          text like "•••• 1234" would be cut to its first four characters and
          stripped to nothing. Stripping first, then slicing, keeps the digits. */}
      <FormField
        editable={lastFourEditable}
        keyboardType="number-pad"
        label={t("accountForm.lastFourDigits")}
        onChangeText={(text) =>
          patch({ lastFour: text.replace(/\D/g, "").slice(0, 4) })
        }
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
