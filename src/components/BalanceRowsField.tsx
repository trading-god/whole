import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { ButtonBase } from "@/components/ButtonBase";
import { CurrencyPicker } from "@/components/CurrencyPicker";
import { FormField, SIGNED_DECIMAL_KEYBOARD } from "@/components/FormField";
import { Icon } from "@/components/Icon";
import { knownAssetCurrencies } from "@/features/assets/currencies";
import {
  type BalanceRow,
  markBalanceRows,
} from "@/features/assets/balance-rows";
import { COLORS } from "@/theme/colors";
import { MIN_INTERACTIVE_SIZE } from "@/theme/layout";
import { actionLink, screenStyles } from "@/theme/screen-styles";
import { CHIP_RADIUS } from "@/theme/sizes";
import { SPACING } from "@/theme/spacing";
import { FONT_SIZE } from "@/theme/typography";

// The per-currency balance rows of the account form: each row is a decimal
// input with a currency picker and an inline delete, followed by an "add
// currency" action (or an "all currencies added" notice once every tracked
// currency has a row). Extracted so the row markup and the add-currency action
// have one owner instead of being copy-pasted across both screens. Its copy
// comes from the form's own `accountForm` namespace — every screen rendering
// this field renders the same words.
export function BalanceRowsField({
  balanceRows,
  onAdd,
  onUpdate,
  onRemove,
}: {
  balanceRows: BalanceRow[];
  onAdd: () => void;
  onUpdate: (index: number, patch: Partial<BalanceRow>) => void;
  onRemove: (index: number) => void;
}) {
  const { t } = useTranslation();
  const accountBalanceLabel = t("accountForm.accountBalance");
  const addCurrencyLabel = t("accountForm.addCurrency");
  // The add-currency action is available while any tracked currency is still
  // missing — judged by distinct currencies, not raw row count, so a duplicate
  // row (e.g. [SGD, SGD, USD, HKD] with CNY missing) doesn't hide the button
  // and leave CNY unreachable. `addBalanceRow` picks an unused currency.
  const allCurrenciesAdded =
    new Set(balanceRows.map((row) => row.currency)).size >=
    knownAssetCurrencies.length;
  // Which row the user is typing in, so a half-typed entry is left alone until
  // focus leaves it. Held by row id, not index: removing a row shifts every
  // index below it.
  const [editingRowId, setEditingRowId] = useState<number | null>(null);
  // Per-row markers — is this a balance, is it unreadable, does it repeat an
  // earlier currency. Derived in `balance-rows.ts` so the duplicate rule the
  // field SHOWS and the one `draftToValidAccount` ENFORCES cannot drift, and so
  // it sits where `pnpm test:app` can reach it.
  //
  // The two ways this form used to disable Save without saying anything: a row
  // whose text isn't a number, and two rows in the same currency. Both parse
  // fine to the eye, so nothing was on screen to explain the grey button.
  const classified = markBalanceRows(balanceRows, editingRowId);
  return (
    <>
      {balanceRows.map((row, index) => (
        <View key={row.id}>
          {index > 0 ? <View style={screenStyles.fieldDivider} /> : null}
          <FormField
            label={index === 0 ? accountBalanceLabel : undefined}
            accessibilityLabel={`${accountBalanceLabel} ${row.currency}`}
            // A row whose text isn't a number is dropped by
            // `deriveValidBalances`, which is what disables Save. Said out
            // loud, because the keyboard can type characters the field cannot
            // use: iOS has no minus key on `decimal-pad`, so this field asks
            // for `numbers-and-punctuation`, which also offers `$`, `%` and the
            // rest — and "S$100" or "1.2.3" then vanished from the total with
            // nothing on screen to explain why Save stayed grey.
            error={
              classified[index].duplicateCurrency
                ? t("accountForm.duplicateCurrency")
                : classified[index].unreadable
                  ? t("accountForm.invalidBalance")
                  : undefined
            }
            keyboardType={SIGNED_DECIMAL_KEYBOARD}
            onBlur={() =>
              setEditingRowId((current) =>
                current === row.id ? null : current,
              )
            }
            onChangeText={(value) => onUpdate(index, { balance: value })}
            onFocus={() => setEditingRowId(row.id)}
            placeholder="0.00"
            value={row.balance}
            trailing={
              <View style={styles.balanceRowTrailing}>
                <CurrencyPicker
                  currencies={knownAssetCurrencies}
                  dialogTitle={t("accountForm.currency")}
                  value={row.currency}
                  variant="onLight"
                  onChange={(currency) => onUpdate(index, { currency })}
                />
                {balanceRows.length > 1 ? (
                  <ButtonBase
                    accessibilityLabel={t("accountForm.removeCurrencyRow")}
                    hitSlop={10}
                    onPress={() => onRemove(index)}
                    baseStyle={styles.deleteButton}
                    pressedStyle={screenStyles.pressed}
                  >
                    <Icon name="minus" size="sm" color={COLORS.muted} />
                  </ButtonBase>
                ) : null}
              </View>
            }
          />
        </View>
      ))}

      <View style={screenStyles.fieldDivider} />

      {!allCurrenciesAdded ? (
        <Pressable
          accessibilityLabel={addCurrencyLabel}
          style={styles.addCurrencyField}
          onPress={onAdd}
        >
          <Icon name="plus" size="sm" color={COLORS.brand} />
          <Text style={actionLink}>{addCurrencyLabel}</Text>
        </Pressable>
      ) : (
        <View style={styles.addCurrencyField}>
          <Text style={styles.addCurrencyComplete}>
            {t("accountForm.allCurrenciesAdded")}
          </Text>
        </View>
      )}

      <View style={screenStyles.fieldDivider} />
    </>
  );
}

const styles = StyleSheet.create({
  // The "add currency" action sits in the field rhythm as a pseudo-field row:
  // a divider above separates it from the last balance input, and its 48pt
  // height (12 padding + 24 content + 12 padding) matches a label-less balance
  // row, so switching between the add button and the "all currencies added"
  // notice never shifts the layout. A leading + glyph marks it as an add
  // action; the trailing account-kind field gets its own divider below.
  addCurrencyField: {
    alignItems: "center",
    flexDirection: "row",
    gap: SPACING.xs,
    justifyContent: "center",
    minHeight: MIN_INTERACTIVE_SIZE,
    paddingVertical: SPACING.md,
  },
  addCurrencyComplete: {
    color: COLORS.subtle,
    fontSize: FONT_SIZE.eyebrow,
  },
  // Trailing slot of a balance row: the currency unit capsule and, when more
  // than one currency is present, a compact delete button. The 6pt gap is
  // tight control spacing (not layout rhythm), so it stays literal.
  balanceRowTrailing: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
  },
  // Compact 28pt inline delete (smaller than the 48pt IconButton, which would
  // raise the row height); hitSlop on the Pressable restores the touch target.
  deleteButton: {
    alignItems: "center",
    borderRadius: CHIP_RADIUS,
    height: 28,
    justifyContent: "center",
    width: 28,
  },
});
