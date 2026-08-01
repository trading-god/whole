import { Link, useRouter } from "expo-router";
import Head from "expo-router/head";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AccountRow } from "@/components/AccountRow";
import { CurrencyPicker } from "@/components/CurrencyPicker";
import { Icon } from "@/components/Icon";
import { IconButton } from "@/components/IconButton";
import { NetWorthChart } from "@/components/NetWorthChart";
import { SectionHeader } from "@/components/SectionHeader";
import {
  ASSET_KIND_CHART_LABEL_KEYS,
  ASSET_KIND_DISTRIBUTION_COLORS,
  knownAssetKinds,
} from "@/features/assets/account-appearance";
import { sumBalancesByKindInCurrency } from "@/features/assets/asset-repository";
import {
  type Currency,
  defaultDisplayCurrencyForLanguageTag,
  orderedDisplayCurrencies,
} from "@/features/assets/currencies";
import { convertCurrency } from "@/features/assets/currency-conversion";
import {
  loadDisplayCurrency,
  saveDisplayCurrency,
} from "@/features/assets/display-currency-store";
import { computeNetWorthTrend } from "@/features/assets/net-worth-history";
import { useAssetAccounts } from "@/features/assets/use-asset-accounts";
import { useAppLocale } from "@/i18n";
import { COLORS } from "@/theme/colors";
import { useResponsiveLayout } from "@/theme/layout";
import {
  actionLink,
  actionLinkButton,
  cardSurface,
  screenStyles,
} from "@/theme/screen-styles";
import { CHIP_RADIUS } from "@/theme/sizes";
import { SPACING } from "@/theme/spacing";
import {
  FONT_SIZE,
  FONT_WEIGHT,
  LETTER_SPACING,
  LINE_HEIGHT,
} from "@/theme/typography";

// Largest-remainder rounding so the legend percentages always sum to 100 —
// naive per-kind Math.round can sum to 99 or 101 (e.g. 33/33/33). Returns all
// zeros when the total is non-positive so the empty/no-rates case stays clean.
function roundPercentages(shares: readonly number[]): number[] {
  const total = shares.reduce((sum, value) => sum + value, 0);
  if (total <= 0) {
    return shares.map(() => 0);
  }
  const raw = shares.map((share) => (share / total) * 100);
  const floored = raw.map((value) => Math.floor(value));
  let remainder = 100 - floored.reduce((sum, value) => sum + value, 0);
  const byFraction = raw
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction);
  for (let i = 0; i < remainder; i += 1) {
    floored[byFraction[i % byFraction.length].index] += 1;
  }
  return floored;
}

export default function Index() {
  const { formatCurrency, languageTag } = useAppLocale();
  const { t } = useTranslation();
  const router = useRouter();
  const { isCompact } = useResponsiveLayout();
  const {
    accounts,
    baseCurrency,
    snapshots,
    snapshotsInBaseCurrency,
    rates,
    error: accountLoadingFailed,
    isLoading: accountsAreLoading,
    removeAccount,
  } = useAssetAccounts();
  const defaultDisplayCurrency = useMemo(
    () => defaultDisplayCurrencyForLanguageTag(languageTag),
    [languageTag],
  );
  const [displayCurrency, setDisplayCurrency] = useState<Currency>(
    defaultDisplayCurrency,
  );

  useEffect(() => {
    let stale = false;
    void loadDisplayCurrency(defaultDisplayCurrency)
      .then((currency) => {
        if (!stale) {
          setDisplayCurrency(currency);
        }
      })
      .catch(() => {
        // A storage read failure leaves the locale default in place rather
        // than surfacing an unhandled rejection.
      });
    return () => {
      stale = true;
    };
  }, [defaultDisplayCurrency]);

  // orderedDisplayCurrencies is a cheap 4-element sort and CurrencyPicker
  // isn't memo'd, so no useMemo is needed (a stable ref would have no consumer).
  const displayCurrencies = orderedDisplayCurrencies(defaultDisplayCurrency);

  // Each account is converted directly to the display currency and the results
  // summed, so the total never routes through an intermediate pivot currency.
  // The same single pass yields the per-kind totals for the distribution chart.
  const { totals: totalsByKind, total: displayTotal } = useMemo(
    () => sumBalancesByKindInCurrency(accounts, displayCurrency, rates),
    [accounts, displayCurrency, rates],
  );
  const trend = useMemo(() => computeNetWorthTrend(snapshots), [snapshots]);
  const displayDelta = useMemo(
    () =>
      trend.delta === null || baseCurrency === null || !snapshotsInBaseCurrency
        ? null
        : convertCurrency(trend.delta, baseCurrency, displayCurrency, rates),
    [
      trend.delta,
      baseCurrency,
      displayCurrency,
      rates,
      snapshotsInBaseCurrency,
    ],
  );
  const distribution = useMemo(() => {
    const percents = roundPercentages(
      knownAssetKinds.map((kind) => totalsByKind[kind]),
    );
    return knownAssetKinds.map((kind, index) => ({
      kind,
      label: t(ASSET_KIND_CHART_LABEL_KEYS[kind]),
      percent: percents[index],
      color: ASSET_KIND_DISTRIBUTION_COLORS[kind],
    }));
  }, [totalsByKind, t]);
  const hasDistribution = displayTotal !== null && displayTotal > 0;
  // Empty state: with no accounts the total is genuinely 0, so show 0.00 (not
  // a placeholder dash) plus a hint nudging the user to add an account. The
  // dash is reserved for "accounts exist but rates couldn't be fetched".
  const isWaiting = accountsAreLoading || accountLoadingFailed;
  const showEmptyBalanceHint = !isWaiting && accounts.length === 0;
  const totalDisplayValue = (() => {
    if (isWaiting) {
      return "—";
    }
    if (displayTotal === null) {
      return showEmptyBalanceHint ? formatCurrency(0, displayCurrency) : "—";
    }
    return formatCurrency(displayTotal, displayCurrency);
  })();

  const chartDeltaText = (() => {
    if (trend.delta === null) {
      return t("home.chartAccumulating");
    }
    if (displayDelta === null) {
      return "—";
    }
    const sign = trend.delta >= 0 ? "+" : "-";
    return `${sign}${formatCurrency(Math.abs(displayDelta), displayCurrency)}`;
  })();

  const [activeRowId, setActiveRowId] = useState<string | null>(null);

  const handleDisplayCurrencyChange = useCallback((currency: Currency) => {
    setDisplayCurrency(currency);
    // Fire-and-forget: a persistence failure leaves the preference unsaved
    // (reverts on next launch) rather than surfacing an unhandled rejection.
    void saveDisplayCurrency(currency).catch(() => {});
  }, []);

  const handleRemove = useCallback(
    async (id: string) => {
      try {
        await removeAccount(id);
      } catch {
        Alert.alert(t("home.deleteAccountError"));
      }
      // Close only the deleted row — a different row the user opened during
      // the await should stay open.
      setActiveRowId((current) => (current === id ? null : current));
    },
    [removeAccount, t],
  );

  const handleOpenAccount = useCallback(
    (id: string) => {
      router.push({ pathname: "/accounts/[id]", params: { id } });
    },
    [router],
  );

  return (
    <>
      <Head>
        <title>{t("metadata.homeTitle")}</title>
        <meta name="description" content={t("metadata.homeDescription")} />
      </Head>
      <SafeAreaView style={screenStyles.safeArea} edges={["top"]}>
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.wordmark}>{t("common.wordmark")}</Text>
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.6}
                style={styles.greeting}
              >
                {t("home.greeting", { name: "Jack" })}
              </Text>
            </View>
            <View style={styles.headerActions}>
              <IconButton
                name="settings"
                size="md"
                variant="ghost"
                accessibilityLabel={t("common.settings")}
                hitSlop={12}
                onPress={() => router.push("/settings")}
              />
              <IconButton
                name="plus"
                size="md"
                variant="primary"
                elevated
                accessibilityLabel={t("common.addAccount")}
                hitSlop={12}
                onPress={() => router.push("/accounts/new")}
              />
            </View>
          </View>

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
                    onChange={handleDisplayCurrencyChange}
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
                {showEmptyBalanceHint ? (
                  <Text style={styles.totalBalanceHint}>
                    {t("home.emptyBalanceHint")}
                  </Text>
                ) : null}
              </View>
              {trend.changePercent !== null ? (
                <View
                  style={[
                    styles.changePill,
                    isCompact && styles.changePillCompact,
                  ]}
                >
                  <Icon
                    name={
                      trend.changePercent >= 0 ? "trending-up" : "trending-down"
                    }
                    size={14}
                    color={COLORS.accentOnDark}
                  />
                  <Text style={styles.changeText}>
                    {trend.changePercent >= 0 ? "+" : ""}
                    {trend.changePercent.toFixed(1)}%
                  </Text>
                </View>
              ) : null}
            </View>

            <View style={styles.chartWrap}>
              <NetWorthChart
                snapshots={snapshots}
                placeholderText={t("home.chartAccumulating")}
              />
            </View>

            <View
              style={[
                styles.chartFooter,
                isCompact && styles.chartFooterCompact,
              ]}
            >
              <Text style={styles.chartPeriod}>
                {t("home.pastMonths", { count: 6 })}
              </Text>
              <Text style={styles.chartDelta}>{chartDeltaText}</Text>
            </View>
          </View>

          <View style={styles.sectionHeader}>
            <SectionHeader
              title={t("home.assetComposition")}
              detail={
                <Text style={styles.sectionMeta}>
                  {accountsAreLoading
                    ? t("home.loading")
                    : t("home.accountCount", { count: accounts.length })}
                </Text>
              }
            />
          </View>

          <View style={styles.distributionCard}>
            <View style={styles.distributionBar}>
              {hasDistribution ? (
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
              {distribution.map((item) => (
                <View key={item.kind} style={styles.legendItem}>
                  <View
                    style={[
                      styles.legendDot,
                      {
                        backgroundColor: hasDistribution
                          ? item.color
                          : COLORS.border,
                      },
                    ]}
                  />
                  <Text numberOfLines={1} style={styles.legendLabel}>
                    {item.label}
                  </Text>
                  <Text style={styles.legendValue}>{item.percent}%</Text>
                </View>
              ))}
            </View>
          </View>

          <View style={styles.sectionHeader}>
            <SectionHeader
              title={t("home.myAccounts")}
              detail={
                <Link href="/accounts/new" asChild>
                  <Pressable
                    accessibilityLabel={t("common.addAccount")}
                    style={actionLinkButton}
                  >
                    <Text style={actionLink}>{t("home.add")}</Text>
                  </Pressable>
                </Link>
              }
            />
          </View>

          <View style={styles.accountsCard}>
            {accountsAreLoading ? (
              <View style={styles.accountStatus}>
                <ActivityIndicator color={COLORS.brand} size="small" />
                <Text style={styles.accountStatusText}>
                  {t("home.loadingAccounts")}
                </Text>
              </View>
            ) : accountLoadingFailed ? (
              <View style={styles.accountStatus}>
                <Text style={styles.accountErrorText}>
                  {t("home.accountLoadError")}
                </Text>
              </View>
            ) : (
              accounts.map((account, index) => (
                <AccountRow
                  key={account.id}
                  account={account}
                  displayCurrency={displayCurrency}
                  rates={rates}
                  isFirst={index === 0}
                  isActive={activeRowId === account.id}
                  onActivate={setActiveRowId}
                  onOpenAccount={handleOpenAccount}
                  onRemove={handleRemove}
                />
              ))
            )}
          </View>

          <Text style={styles.privacyNote}>{t("home.accountDataPrivacy")}</Text>
        </ScrollView>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: SPACING.xl,
    paddingBottom: SPACING.xxxl,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: SPACING.md,
    justifyContent: "space-between",
    paddingBottom: SPACING.lg,
    paddingTop: SPACING.md,
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  headerActions: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 0,
    gap: SPACING.xs,
  },
  wordmark: {
    color: COLORS.brand,
    fontSize: FONT_SIZE.eyebrow,
    fontWeight: FONT_WEIGHT.extrabold,
    letterSpacing: LETTER_SPACING.wordmark,
  },
  greeting: {
    color: COLORS.ink,
    fontSize: FONT_SIZE.heading,
    fontWeight: FONT_WEIGHT.bold,
    letterSpacing: LETTER_SPACING.headingTight,
    marginTop: SPACING.sm,
  },
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
    fontWeight: FONT_WEIGHT.bold,
    letterSpacing: LETTER_SPACING.displayTight,
    lineHeight: LINE_HEIGHT.display,
    marginTop: 2,
  },
  totalBalanceHint: {
    color: COLORS.mutedOnDark,
    fontSize: FONT_SIZE.bodySm,
    fontWeight: FONT_WEIGHT.medium,
    marginTop: SPACING.sm,
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
  changePillCompact: {
    alignSelf: "flex-start",
  },
  changeText: {
    color: COLORS.accentOnDark,
    fontSize: FONT_SIZE.eyebrow,
    fontWeight: FONT_WEIGHT.bold,
  },
  chartWrap: {
    marginHorizontal: -SPACING.xl,
    marginTop: SPACING.md,
  },
  chartFooter: {
    alignItems: "center",
    borderTopColor: COLORS.dividerOnDark,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: SPACING.sm,
    justifyContent: "space-between",
    paddingVertical: SPACING.lg,
  },
  chartFooterCompact: {
    alignItems: "flex-start",
    flexDirection: "column",
  },
  chartPeriod: {
    color: COLORS.mutedOnDark,
    fontSize: FONT_SIZE.eyebrow,
  },
  chartDelta: {
    color: COLORS.accentOnDark,
    fontSize: FONT_SIZE.eyebrow,
    fontWeight: FONT_WEIGHT.bold,
  },
  sectionHeader: {
    marginBottom: SPACING.md,
    marginTop: SPACING.xxl,
    paddingHorizontal: 2,
  },
  sectionMeta: {
    color: COLORS.muted,
    fontSize: FONT_SIZE.eyebrow,
  },
  distributionCard: {
    ...cardSurface,
    padding: SPACING.lg,
  },
  distributionBar: {
    flexDirection: "row",
    gap: SPACING.xs,
    height: 10,
    overflow: "hidden",
  },
  distributionSegment: {
    borderRadius: 5,
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
    borderRadius: 4,
    height: 8,
    marginRight: SPACING.sm,
    width: 8,
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
  accountsCard: {
    ...cardSurface,
    overflow: "hidden",
  },
  accountStatus: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    minHeight: 76,
  },
  accountStatusText: {
    color: COLORS.muted,
    fontSize: FONT_SIZE.eyebrow,
    marginLeft: SPACING.sm,
  },
  accountErrorText: {
    color: COLORS.muted,
    fontSize: FONT_SIZE.eyebrow,
  },
  privacyNote: {
    color: COLORS.subtle,
    fontSize: FONT_SIZE.micro,
    marginTop: SPACING.md,
    textAlign: "center",
  },
});
