import { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Icon } from "@/components/Icon";
import {
  type AssetAccount,
  type AssetAccountGroup,
  sumBalancesByKindInCurrency,
} from "@/features/assets/asset-repository";
import { maskAssetAmount } from "@/features/assets/asset-privacy-store";
import { type ExchangeRates } from "@/features/assets/currency-conversion";
import { type Currency } from "@/features/assets/currencies";
import { useAppLocale } from "@/i18n";
import { COLORS } from "@/theme/colors";
import { ACCOUNT_ROW_HEIGHT } from "@/theme/sizes";
import { SPACING } from "@/theme/spacing";
import { FONT_SIZE, FONT_WEIGHT, LETTER_SPACING } from "@/theme/typography";

type AccountGroupRowProps = {
  group: AssetAccountGroup;
  // The child accounts that belong to this group. The header sums these into
  // one display-currency total (mirroring AccountRow's per-account total), so
  // a group reads as a single collapsible figure until expanded.
  accounts: readonly AssetAccount[];
  displayCurrency: Currency;
  rates: ExchangeRates;
  // When true, the group total renders as the shared asset mask instead of the
  // formatted figure — matching AccountRow, an unconvertible total still reads
  // as "—" so missing rates aren't mistaken for a hidden amount.
  isBalanceHidden: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  isFirst: boolean;
};

// A collapsible group header for the home account list. Renders the group
// name, a child-account count, and the summed display-currency total of its
// children. Tapping the header toggles expand/collapse; the child AccountRows
// are rendered by the home screen (passed through `children` of the wrapping
// view when expanded) so their swipe-to-delete gesture and active-row state
// stay owned by the screen, exactly as for ungrouped accounts. Child rows are
// NOT indented — the header provides the visual grouping, and keeping child
// rows flush avoids any conflict with AccountRow's horizontal pan gesture.
export const AccountGroupRow = memo(function AccountGroupRow({
  group,
  accounts,
  displayCurrency,
  rates,
  isBalanceHidden,
  isExpanded,
  onToggle,
  isFirst,
}: AccountGroupRowProps) {
  const { t } = useTranslation();
  const { formatCurrency } = useAppLocale();
  // Sum every child's per-currency balances into the display currency, so a
  // multi-account group shows one comparable total — the same fold AccountRow
  // applies to a single account's multi-currency balances.
  const convertedTotal = useMemo(
    () => sumBalancesByKindInCurrency(accounts, displayCurrency, rates).total,
    [accounts, displayCurrency, rates],
  );

  return (
    <View>
      {isFirst ? null : <View style={styles.separator} />}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={group.name}
        accessibilityHint={
          isExpanded ? t("home.collapseGroup") : t("home.expandGroup")
        }
        onPress={onToggle}
        style={({ pressed }) => (pressed ? styles.pressed : undefined)}
      >
        <View style={styles.header}>
          <Icon
            name={isExpanded ? "chevron-down" : "chevron-right"}
            size="sm"
            color={COLORS.muted}
          />
          <View style={styles.identity}>
            <Text numberOfLines={1} style={styles.name}>
              {group.name}
            </Text>
            <Text style={styles.count}>
              {t("home.accountCountInGroup", { count: accounts.length })}
            </Text>
          </View>
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.5}
            style={styles.total}
          >
            {convertedTotal !== null
              ? maskAssetAmount(
                  formatCurrency(convertedTotal, displayCurrency),
                  isBalanceHidden,
                )
              : "—"}
          </Text>
        </View>
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  separator: {
    backgroundColor: COLORS.border,
    height: StyleSheet.hairlineWidth,
    // Aligns with the chevron + identity block (icon width + inset), mirroring
    // AccountRow's separator so grouped and ungrouped rows share one rhythm.
    marginLeft: 72,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: ACCOUNT_ROW_HEIGHT,
    paddingHorizontal: SPACING.lg,
  },
  identity: {
    flex: 1,
    flexShrink: 1,
    marginLeft: SPACING.sm,
    minWidth: 0,
  },
  name: {
    color: COLORS.ink,
    fontSize: FONT_SIZE.body,
    fontWeight: FONT_WEIGHT.bold,
  },
  count: {
    color: COLORS.subtle,
    fontSize: FONT_SIZE.micro,
    letterSpacing: LETTER_SPACING.numeric,
    marginTop: 2,
  },
  total: {
    color: COLORS.ink,
    flexShrink: 0,
    fontSize: FONT_SIZE.body,
    fontWeight: FONT_WEIGHT.bold,
    marginLeft: SPACING.sm,
    maxWidth: 150,
  },
  pressed: {
    opacity: 0.6,
  },
});
