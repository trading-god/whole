import { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Icon } from "@/components/Icon";
import {
  ACCOUNT_LIST_BALANCE_COMPACT,
  ACCOUNT_LIST_BALANCE_MIN_FONT_SCALE,
  ACCOUNT_LIST_LEADING_SIZE,
  ACCOUNT_LIST_ROW_COMPACT,
  ACCOUNT_LIST_SEPARATOR_INSET,
  ACCOUNT_LIST_TRAILING_COMPACT,
  ACCOUNT_LIST_TRAILING_MAX_WIDTH,
  ACCOUNT_ROW_HEIGHT,
} from "@/features/accounts/account-list-constants";
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
import { PRESSED_OPACITY_SURFACE } from "@/theme/interaction";
import { SPACING } from "@/theme/spacing";
import {
  FONT_SIZE,
  FONT_VARIANT,
  FONT_WEIGHT,
  LETTER_SPACING,
} from "@/theme/typography";

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
  // When true, the row renders the compact layout: the total wraps onto its
  // own line below the name. Read once by the list owner (AccountsCard) and
  // passed down, so the rows don't each subscribe to window dimensions — a
  // keyboard show/hide on Android would otherwise re-render every mounted row.
  isCompact: boolean;
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
  isCompact,
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
  // Mirrors AccountRow: a group whose debts outweigh its balances is owed
  // money on net, and the figure says so in the caution ink.
  const isLiability = convertedTotal !== null && convertedTotal < 0;
  const accountCountText = t("home.accountCountInGroup", {
    count: accounts.length,
  });
  const totalText =
    convertedTotal !== null
      ? maskAssetAmount(
          formatCurrency(convertedTotal, displayCurrency),
          isBalanceHidden,
        )
      : "—";

  return (
    <View>
      {isFirst ? null : <View style={styles.separator} />}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={group.name}
        accessibilityValue={{ text: `${accountCountText}, ${totalText}` }}
        accessibilityState={{ expanded: isExpanded }}
        accessibilityHint={
          isExpanded ? t("home.collapseGroup") : t("home.expandGroup")
        }
        onPress={onToggle}
        style={({ pressed }) => (pressed ? styles.pressed : undefined)}
      >
        <View style={[styles.header, isCompact && styles.headerCompact]}>
          <View style={styles.chevronSlot}>
            <Icon
              name={isExpanded ? "chevron-down" : "chevron-right"}
              size="sm"
              color={COLORS.muted}
            />
          </View>
          <View style={styles.identity}>
            <Text numberOfLines={1} style={styles.name}>
              {group.name}
            </Text>
            <Text style={styles.count}>{accountCountText}</Text>
          </View>
          <Text
            numberOfLines={1}
            // Same rule as AccountRow's balance: shrink before clipping (see
            // ACCOUNT_LIST_BALANCE_MIN_FONT_SCALE) — a tail-ellipsised total
            // cuts the least-significant digits and reads as a wrong figure.
            adjustsFontSizeToFit
            minimumFontScale={ACCOUNT_LIST_BALANCE_MIN_FONT_SCALE}
            style={[
              styles.total,
              isCompact && styles.totalCompact,
              isLiability && styles.totalLiability,
            ]}
          >
            {totalText}
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
    // Starts where the group name does — the same inset as AccountRow's
    // separator, so grouped and ungrouped rows share one rhythm.
    marginLeft: ACCOUNT_LIST_SEPARATOR_INSET,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: ACCOUNT_ROW_HEIGHT,
    paddingHorizontal: SPACING.lg,
  },
  headerCompact: {
    ...ACCOUNT_LIST_ROW_COMPACT,
  },
  chevronSlot: {
    alignItems: "center",
    flexShrink: 0,
    height: ACCOUNT_LIST_LEADING_SIZE,
    justifyContent: "center",
    width: ACCOUNT_LIST_LEADING_SIZE,
  },
  identity: {
    flex: 1,
    flexShrink: 1,
    marginLeft: SPACING.md,
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
    fontVariant: FONT_VARIANT.tabular,
    fontWeight: FONT_WEIGHT.bold,
    marginLeft: SPACING.sm,
    maxWidth: ACCOUNT_LIST_TRAILING_MAX_WIDTH,
  },
  // The total is a Text directly in the row (no wrapper View), so alignment
  // comes from `textAlign` where AccountRow's uses `alignItems` on its value
  // column.
  totalCompact: {
    ...ACCOUNT_LIST_TRAILING_COMPACT,
    ...ACCOUNT_LIST_BALANCE_COMPACT,
    textAlign: "right",
  },
  totalLiability: {
    color: COLORS.caution,
  },
  pressed: {
    opacity: PRESSED_OPACITY_SURFACE,
  },
});
