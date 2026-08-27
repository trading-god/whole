import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";

import { ASSET_KIND_CHART_LABEL_KEYS } from "@/features/assets/account-appearance";
import { maskAssetAmount } from "@/features/assets/asset-privacy-store";
import { type AssetKind } from "@whole/ocr";
import { buildDistribution } from "@/features/home/distribution";
import { useResponsiveLayout } from "@/theme/layout";
import { cardSurface } from "@/theme/screen-styles";
import { COLORS } from "@/theme/colors";
import { SPACING } from "@/theme/spacing";
import { FONT_SIZE, FONT_WEIGHT } from "@/theme/typography";

// Asset-distribution bar geometry. The segment radius is half the bar height
// so each segment reads as a capsule.
const DISTRIBUTION_BAR_HEIGHT = 10;

// Legend dot size — the radius is half the size for a circle.
const LEGEND_DOT_SIZE = 8;

type AssetDistributionCardProps = {
  // Per-kind totals in the display currency, from the home screen's single
  // conversion pass. A negative total is a liability: held, but not a slice of
  // the composition (see distribution.ts).
  totalsByKind: Readonly<Record<AssetKind, number>>;
  isPrivacyEnabled: boolean;
};

// The asset-composition card: the segmented bar of what the net worth is made
// of, and the legend beneath it. Both the bar and the legend degrade to a grey
// placeholder under privacy mode — masking only the legend left the shares on
// display.
export function AssetDistributionCard({
  totalsByKind,
  isPrivacyEnabled,
}: AssetDistributionCardProps) {
  const { t } = useTranslation();
  const { isCompact } = useResponsiveLayout();

  const distribution = useMemo(
    () =>
      buildDistribution(totalsByKind).map((slice) => ({
        ...slice,
        label: t(ASSET_KIND_CHART_LABEL_KEYS[slice.kind]),
      })),
    [totalsByKind, t],
  );

  // Gated on the POSITIVE kinds, not on net worth. The composition bar already
  // excludes negative kinds (see `roundPercentages`), so a user whose card debt
  // exceeds their cash still has a real composition to show — testing the
  // signed net total instead hid the bar and greyed the dots while the legend
  // beside them went on reading "Cash 100%".
  const hasDistribution = distribution.some((slice) => slice.percent > 0);

  return (
    <View style={styles.distributionCard}>
      <View style={styles.distributionBar}>
        {/* The bar draws the composition itself, so privacy mode gets the
            same grey placeholder track as an empty screen. Masking only the
            legend left the shares on display: cash 70% / crypto 30% is two
            segments in a 7:3 ratio beside a legend reading "••••", which is
            the composition the mask is there to hide — and the segment
            count alone says which classes are held. */}
        {hasDistribution && !isPrivacyEnabled ? (
          distribution
            .filter((item) => item.percent > 0)
            .map((item) => (
              <View
                key={item.kind}
                style={[
                  styles.distributionSegment,
                  {
                    backgroundColor: item.color,
                    flex: item.percent,
                  },
                ]}
              />
            ))
        ) : (
          <View
            style={[
              styles.distributionSegment,
              { backgroundColor: COLORS.border, flex: 1 },
            ]}
          />
        )}
      </View>
      <View style={[styles.legend, isCompact && styles.legendCompact]}>
        {/* With a composition to show, the legend lists every kind the user
            actually HOLDS — which is not the same set the bar draws: a
            holding under half a percent rounds to 0% and gets no segment,
            but it is still money and belongs in the legend, reading "<1%".
            A negative kind is in neither. With no composition (no accounts
            yet, no rates, or liabilities only) it lists every kind at 0%
            beside the grey placeholder bar, so the empty state still says
            what the bar WOULD show. */}
        {(hasDistribution && !isPrivacyEnabled
          ? distribution.filter((item) => item.held)
          : distribution
        ).map((item) => (
          <View key={item.kind} style={styles.legendItem}>
            <View
              style={[
                styles.legendDot,
                {
                  backgroundColor: hasDistribution ? item.color : COLORS.border,
                },
              ]}
            />
            <Text numberOfLines={1} style={styles.legendLabel}>
              {item.label}
            </Text>
            <Text style={styles.legendValue}>
              {isPrivacyEnabled
                ? // Every kind, every value masked the same way. The
                  // readable variants below each say something a mask is
                  // supposed to hide: the liability label marks a kind as a
                  // net debt, "<1%" gives a magnitude band, and filtering
                  // the list to held kinds reveals which classes the user
                  // holds at all — none of which a masked screen should
                  // show.
                  maskAssetAmount(`${item.percent}%`, true)
                : // A liability has no share of the composition — "0%"
                  // would read as "you hold none", which is not what a debt
                  // is. Said in words rather than with a dash placeholder:
                  // the home screen already prints that dash a few points
                  // above for "there is no figure to show" (the total while
                  // rates load), and a card balance of -S$4,766.92 then read
                  // as "couldn't compute" instead of "you owe money".
                  !item.inComposition && item.held
                  ? t("home.netLiability")
                  : item.percent === 0 && item.held
                    ? t("home.lessThanOnePercent")
                    : `${item.percent}%`}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  distributionCard: {
    ...cardSurface,
    padding: SPACING.lg,
  },
  distributionBar: {
    flexDirection: "row",
    gap: SPACING.xs,
    height: DISTRIBUTION_BAR_HEIGHT,
    overflow: "hidden",
  },
  distributionSegment: {
    borderRadius: DISTRIBUTION_BAR_HEIGHT / 2,
  },
  legend: {
    flexDirection: "row",
    gap: SPACING.md,
    justifyContent: "space-between",
    marginTop: SPACING.lg,
  },
  legendCompact: {
    flexWrap: "wrap",
    justifyContent: "flex-start",
  },
  legendItem: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 1,
    minWidth: 0,
  },
  legendDot: {
    borderRadius: LEGEND_DOT_SIZE / 2,
    height: LEGEND_DOT_SIZE,
    marginRight: SPACING.sm,
    width: LEGEND_DOT_SIZE,
  },
  legendLabel: {
    color: COLORS.muted,
    flexShrink: 1,
    fontSize: FONT_SIZE.micro,
  },
  legendValue: {
    color: COLORS.ink,
    flexShrink: 0,
    fontSize: FONT_SIZE.micro,
    fontWeight: FONT_WEIGHT.bold,
    marginLeft: SPACING.xs,
  },
});
