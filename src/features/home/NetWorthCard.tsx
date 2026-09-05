import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";

import { CurrencyPicker } from "@/features/accounts/CurrencyPicker";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { IconButton } from "@/components/IconButton";
import { NetWorthChart } from "@/features/home/NetWorthChart";
import { type PickerOption, OptionPicker } from "@/components/OptionPicker";
import { type Currency } from "@/features/assets/currencies";
import { type NetWorthRange } from "@/features/assets/net-worth-range";
import {
  type NetWorthSnapshot,
  type NetWorthTrend,
} from "@/features/assets/net-worth-history";
import { maskAssetAmount } from "@/features/assets/asset-privacy-store";
import { useResponsiveLayout } from "@/theme/layout";
import { BUTTON_HORIZONTAL_PADDING, CHIP_RADIUS } from "@/theme/sizes";
import { COLORS } from "@/theme/colors";
import { SPACING } from "@/theme/spacing";
import {
  FONT_SIZE,
  FONT_VARIANT,
  FONT_WEIGHT,
  LETTER_SPACING,
  LINE_HEIGHT,
} from "@/theme/typography";

// Icon size for the trend change pill. Shared by the <Icon> and its loading
// placeholder so the pill's footprint doesn't re-flow when the icon swaps in.
const PILL_ICON_SIZE = 14;

// Width of the trend pill's loading placeholder — matches the real pill's
// footprint (icon + label) so the total-balance layout doesn't re-flow when
// the pill swaps in. A layout-specific constant, not a touch target.
const PILL_PLACEHOLDER_WIDTH = 48;

type NetWorthCardProps = {
  // Display-currency switcher on the eyebrow row.
  displayCurrency: Currency;
  displayCurrencies: readonly Currency[];
  onDisplayCurrencyChange: (currency: Currency) => void;
  // Privacy masking applies to the trend pill's percentage.
  isPrivacyEnabled: boolean;
  onTogglePrivacy: () => void;
  // The already-masked total (HomeScreen owns the waiting/empty/unavailable
  // rules that decide the string).
  totalDisplayValue: string;
  // True while accounts or rates load — the pill is replaced by a
  // placeholder so the card's layout doesn't re-flow.
  showPillPlaceholder: boolean;
  trend: NetWorthTrend;
  isDeclining: boolean;
  // Chart inputs, already narrowed to the selected range by the screen.
  rangedSnapshots: readonly NetWorthSnapshot[];
  ratesUnavailable: boolean;
  // No accounts exist yet: the chart area becomes the invitation to add one.
  isSettledEmpty: boolean;
  onAddAccount: () => void;
  chartRange: NetWorthRange;
  chartRangeOptions: readonly PickerOption<NetWorthRange>[];
  onChartRangeChange: (range: NetWorthRange) => void;
  chartDeltaText: string;
};

// The dark brand card at the top of the home screen: total balance in the
// display currency, the trend pill, the net-worth chart with its range footer,
// and — while no account exists — the empty-state invitation in the chart's
// place.
export function NetWorthCard({
  displayCurrency,
  displayCurrencies,
  onDisplayCurrencyChange,
  isPrivacyEnabled,
  onTogglePrivacy,
  totalDisplayValue,
  showPillPlaceholder,
  trend,
  isDeclining,
  rangedSnapshots,
  ratesUnavailable,
  isSettledEmpty,
  onAddAccount,
  chartRange,
  chartRangeOptions,
  onChartRangeChange,
  chartDeltaText,
}: NetWorthCardProps) {
  const { t } = useTranslation();
  const { isCompact } = useResponsiveLayout();

  return (
    <View style={styles.balanceCard}>
      <View
        style={[
          styles.balanceCardTop,
          isCompact && styles.balanceCardTopCompact,
        ]}
      >
        <View style={styles.balanceCopy}>
          <View style={styles.eyebrowRow}>
            <Text numberOfLines={1} style={styles.eyebrow}>
              {t("home.totalAssetsLabel")}
            </Text>
            <CurrencyPicker
              currencies={displayCurrencies}
              value={displayCurrency}
              onChange={onDisplayCurrencyChange}
            />
            <IconButton
              name={isPrivacyEnabled ? "eye-off" : "eye"}
              size="sm"
              variant="onDark"
              iconSize="sm"
              accessibilityLabel={
                isPrivacyEnabled
                  ? t("home.showAssetAmounts")
                  : t("home.hideAssetAmounts")
              }
              accessibilityHint={
                isPrivacyEnabled
                  ? t("home.showAssetAmountsHint")
                  : t("home.hideAssetAmountsHint")
              }
              accessibilityState={{
                checked: isPrivacyEnabled,
              }}
              hitSlop={8}
              onPress={onTogglePrivacy}
            />
          </View>
          <Text
            adjustsFontSizeToFit
            minimumFontScale={0.7}
            numberOfLines={1}
            style={styles.totalBalance}
          >
            {totalDisplayValue}
          </Text>
        </View>
        {showPillPlaceholder ? (
          <View
            style={[styles.changePill, isCompact && styles.changePillCompact]}
          >
            <View style={styles.pillPlaceholder} />
          </View>
        ) : trend.changePercent !== null ? (
          <View
            style={[
              styles.changePill,
              isDeclining && styles.changePillNegative,
              isCompact && styles.changePillCompact,
            ]}
          >
            <Icon
              name={isDeclining ? "trending-down" : "trending-up"}
              size={PILL_ICON_SIZE}
              color={isDeclining ? COLORS.negativeOnDark : COLORS.accentOnDark}
            />
            <Text
              style={[
                styles.changeText,
                isDeclining && styles.changeTextNegative,
              ]}
            >
              {maskAssetAmount(
                `${trend.changePercent >= 0 ? "+" : ""}${trend.changePercent.toFixed(1)}%`,
                isPrivacyEnabled,
              )}
            </Text>
          </View>
        ) : null}
      </View>

      {/* With no accounts there is no curve to wait for, so the chart and
          its footer give way to the one thing that would start it. The
          range picker goes with them: every range renders the same nothing
          until an account exists, and a delta of "—" beside a total of 0
          is a third way of saying "empty" on a card that has already said
          it twice. */}
      {isSettledEmpty ? (
        <View style={styles.chartEmptyState}>
          <Text style={styles.chartEmptyCopy}>
            {t("home.chartEmptyPrompt")}
          </Text>
          <Button
            size="sm"
            variant="onDark"
            icon="plus"
            fullWidth={false}
            // Pulled left by its own horizontal padding so the "+" lines up
            // with the copy above it. The padding is sized for a filled
            // button, where the background makes it read as the edge; on a
            // transparent one it is just an indent nothing accounts for.
            style={styles.chartEmptyAction}
            onPress={onAddAccount}
          >
            {t("common.addAccount")}
          </Button>
        </View>
      ) : (
        <>
          <View style={styles.chartWrap}>
            <NetWorthChart
              snapshots={rangedSnapshots}
              currency={displayCurrency}
              isNegative={isDeclining}
              // The curve is a picture of the numbers the mask hides — its
              // shape alone says whether the month went up or down — so it
              // hides with them.
              isHidden={isPrivacyEnabled}
              // The chart counts its own samples; the only thing it cannot
              // see is that no sample will ever be recorded without rates.
              ratesUnavailable={ratesUnavailable}
            />
          </View>

          <View
            style={[styles.chartFooter, isCompact && styles.chartFooterCompact]}
          >
            <OptionPicker
              dialogTitle={t("home.chartRange")}
              onChange={onChartRangeChange}
              options={chartRangeOptions}
              value={chartRange}
              variant="onDarkMuted"
            />
            <Text
              style={[
                styles.chartDelta,
                isDeclining && styles.chartDeltaNegative,
              ]}
            >
              {chartDeltaText}
            </Text>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  balanceCard: {
    backgroundColor: COLORS.brandDark,
    borderRadius: 28,
    overflow: "hidden",
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.sm,
  },
  balanceCardTop: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: SPACING.md,
    justifyContent: "space-between",
  },
  balanceCardTopCompact: {
    flexDirection: "column",
  },
  balanceCopy: {
    flex: 1,
    minWidth: 0,
  },
  eyebrowRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: SPACING.sm,
  },
  eyebrow: {
    color: COLORS.mutedOnDark,
    fontSize: FONT_SIZE.eyebrow,
    fontWeight: FONT_WEIGHT.semibold,
    letterSpacing: LETTER_SPACING.caption,
  },
  totalBalance: {
    color: COLORS.white,
    fontSize: FONT_SIZE.display,
    fontVariant: FONT_VARIANT.tabular,
    fontWeight: FONT_WEIGHT.bold,
    letterSpacing: LETTER_SPACING.displayTight,
    lineHeight: LINE_HEIGHT.display,
    marginTop: 2,
  },
  // Replaces the chart and its footer while no account exists. Left-aligned
  // under the total rather than centred in the chart's footprint: it is the
  // next line of the card's sentence ("0.00 — here is how to change that"),
  // not a notice about a missing chart. The button's `fullWidth={false}` is
  // what keeps it from stretching — an `alignItems` here would only shadow it.
  chartEmptyState: {
    gap: SPACING.md,
    paddingBottom: SPACING.xl,
    paddingTop: SPACING.md,
  },
  chartEmptyCopy: {
    color: COLORS.mutedOnDark,
    fontSize: FONT_SIZE.bodySm,
    fontWeight: FONT_WEIGHT.medium,
    lineHeight: LINE_HEIGHT.body,
  },
  chartEmptyAction: {
    marginLeft: -BUTTON_HORIZONTAL_PADDING,
  },
  changePill: {
    alignItems: "center",
    backgroundColor: COLORS.accentOnDarkSoft,
    borderColor: COLORS.accentOnDarkBorder,
    borderRadius: CHIP_RADIUS,
    borderWidth: 1,
    flexDirection: "row",
    flexShrink: 0,
    gap: SPACING.xs,
    // The right column's container top aligns with the left "总资产" eyebrow
    // row box via `flex-start`, but the pill's border sits flush at that box
    // top while the eyebrow text starts lower (line-height head-room above the
    // glyph), so the pill reads as higher than the copy. Nudge the pill down
    // until its top edge meets the eyebrow glyph's visual top.
    marginTop: SPACING.sm,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.sm,
  },
  // Decline treatment for the pill — same geometry, decline tones, so the chip
  // doesn't resize when the trend flips.
  changePillNegative: {
    backgroundColor: COLORS.negativeOnDarkSoft,
    borderColor: COLORS.negativeOnDarkBorder,
  },
  changePillCompact: {
    alignSelf: "flex-start",
  },
  // Transparent block reserving the trend pill's footprint while account or
  // rate data loads, so the pill's appearance doesn't re-flow the
  // total-balance font (wide) or grow the card (compact). Sized to match the
  // real pill's icon (PILL_ICON_SIZE) + eyebrow text line.
  pillPlaceholder: {
    backgroundColor: "transparent",
    height: PILL_ICON_SIZE,
    width: PILL_PLACEHOLDER_WIDTH,
  },
  changeText: {
    color: COLORS.accentOnDark,
    fontSize: FONT_SIZE.eyebrow,
    fontVariant: FONT_VARIANT.tabular,
    fontWeight: FONT_WEIGHT.bold,
  },
  changeTextNegative: {
    color: COLORS.negativeOnDark,
  },
  chartWrap: {
    marginHorizontal: -SPACING.xl,
    marginTop: SPACING.md,
  },
  chartFooter: {
    alignItems: "center",
    borderTopColor: COLORS.dividerOnDark,
    // 1px, not StyleSheet.hairlineWidth: the divider sits on the dark
    // brandDark card where a hairline (0.5px) is too faint to read.
    borderTopWidth: 1,
    flexDirection: "row",
    gap: SPACING.sm,
    justifyContent: "space-between",
    // The range picker carries its own 48pt touch target, so the row only pads
    // enough to clear the divider — the previous 16pt would stack on top of
    // that height and bloat the card.
    paddingVertical: SPACING.xs,
  },
  chartFooterCompact: {
    alignItems: "flex-start",
    flexDirection: "column",
    // Stacked, the delta sits below the picker and needs its own bottom
    // breathing room, which the row layout gets from the picker's height.
    paddingBottom: SPACING.md,
  },
  chartDelta: {
    color: COLORS.accentOnDark,
    fontSize: FONT_SIZE.eyebrow,
    fontVariant: FONT_VARIANT.tabular,
    fontWeight: FONT_WEIGHT.bold,
  },
  chartDeltaNegative: {
    color: COLORS.negativeOnDark,
  },
});
