import { Link, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AccountRow } from "@/components/AccountRow";
import { Button } from "@/components/Button";
import { CurrencyPicker } from "@/components/CurrencyPicker";
import { Icon } from "@/components/Icon";
import { IconButton } from "@/components/IconButton";
import { NetWorthChart } from "@/components/NetWorthChart";
import { OptionPicker } from "@/components/OptionPicker";
import { SectionHeader } from "@/components/SectionHeader";
import {
  ASSET_KIND_CHART_LABEL_KEYS,
  ASSET_KIND_DISTRIBUTION_COLORS,
  knownAssetKinds,
} from "@/features/assets/account-appearance";
import {
  loadAssetPrivacyMode,
  maskAssetAmount,
  saveAssetPrivacyMode,
} from "@/features/assets/asset-privacy-store";
import { sumBalancesByKindInCurrency } from "@/features/assets/asset-repository";
import {
  amountsConvertible,
  defaultDisplayCurrencyForLanguageTag,
  orderedDisplayCurrencies,
} from "@/features/assets/currencies";
import {
  loadDisplayCurrency,
  saveDisplayCurrency,
} from "@/features/assets/display-currency-store";
import { computeNetWorthTrend } from "@/features/assets/net-worth-history";
import {
  type NetWorthRange,
  DEFAULT_NET_WORTH_RANGE,
  NET_WORTH_RANGES,
  loadNetWorthRange,
  saveNetWorthRange,
  selectSnapshotsInRange,
} from "@/features/assets/net-worth-range";
import { useAssetAccounts } from "@/features/assets/use-asset-accounts";
import { useOnboardingState } from "@/features/onboarding/onboarding-context";
import { loadUserName } from "@/features/user/user-store";
import { useAppLocale } from "@/i18n";
import { COLORS } from "@/theme/colors";
import { useResponsiveLayout } from "@/theme/layout";
import {
  actionLink,
  actionLinkButton,
  cardSurface,
  screenStyles,
} from "@/theme/screen-styles";
import { ACCOUNT_ROW_HEIGHT, CHIP_RADIUS } from "@/theme/sizes";
import { SPACING } from "@/theme/spacing";
import {
  FONT_SIZE,
  FONT_WEIGHT,
  LETTER_SPACING,
  LINE_HEIGHT,
} from "@/theme/typography";

// Icon size for the trend change pill. Shared by the <Icon> and its loading
// placeholder so the pill's footprint doesn't re-flow when the icon swaps in.
const PILL_ICON_SIZE = 14;

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

// One persisted view preference: rendered from `fallback` until the stored
// value loads, then written back through `save` whenever it changes. The stale
// guard is what makes the load safe to drop on unmount, and both failure modes
// are swallowed deliberately — a preference that can't be read stays on its
// fallback, one that can't be written reverts on the next launch, and neither
// is worth an alert over a view setting. Stated once so the fourth preference
// can't quietly ship without the guard. `save` is omitted for a preference
// this screen only reads (the greeting name, written during onboarding).
function useStoredPreference<T>(
  load: () => Promise<T>,
  fallback: T,
  save?: (value: T) => Promise<void>,
): [T, (value: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState(fallback);
  // Set the moment the user picks a value, so a read that resolves late can't
  // revert what they just chose — and already persisted. A cold start opens the
  // database and runs the legacy AsyncStorage migration scan before the first
  // read returns, which is a wide enough window to tap a picker in; without
  // this the screen would disagree with storage until the next launch.
  const hasUserChoice = useRef(false);

  useEffect(() => {
    let stale = false;
    void load()
      .then((stored) => {
        if (!stale && !hasUserChoice.current) {
          setValue(stored);
        }
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [load]);

  // Accepts a functional update so a caller can flip the value from inside the
  // updater without reading a stale closure (the eye toggle double-taps). The
  // setter resolves `next` against the current value and persists the result —
  // the save rides the same updater so a double-tap writes the value the UI
  // actually switched to.
  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      hasUserChoice.current = true;
      setValue((current) => {
        const resolved =
          typeof next === "function" ? (next as (prev: T) => T)(current) : next;
        void save?.(resolved).catch(() => {});
        return resolved;
      });
    },
    [save],
  );

  return [value, set];
}

export default function Index() {
  // First-run guard. The root layout's auth gate redirects un-onboarded users
  // to /onboarding, but expo-router still mounts this screen for a frame
  // before the `replace` lands — and the splash screen doesn't always cover
  // that window under SDK 57. Render a blank surface (matching the app
  // background) until the gate clears, so the worst case is a seamless
  // blank → onboarding transition instead of home → onboarding. The real home
  // UI lives in <HomeScreen /> below so its hooks (account loading, etc.) only
  // run once onboarding is complete.
  const isOnboarded = useOnboardingState();
  if (!isOnboarded) {
    return <View style={screenStyles.safeArea} />;
  }
  return <HomeScreen />;
}

function HomeScreen() {
  // Dev-mode entry is dev-only, exactly like the /dev route registration in
  // _layout.tsx (Metro-injected, false in production bundles). Kept as a local
  // constant so the render reads "isDev" instead of spreading `__DEV__`.
  const isDev = __DEV__;
  const { formatCurrency, languageTag } = useAppLocale();
  const { t } = useTranslation();
  const router = useRouter();
  const { isCompact } = useResponsiveLayout();
  const {
    accounts,
    snapshots,
    rates,
    ratesReady,
    error: accountLoadingFailed,
    isLoading: accountsAreLoading,
    removeAccount,
    refresh,
  } = useAssetAccounts();
  const defaultDisplayCurrency = useMemo(
    () => defaultDisplayCurrencyForLanguageTag(languageTag),
    [languageTag],
  );
  // The display currency starts on the locale default and the chart on the
  // window the footer used before it became selectable, so both render before
  // storage answers; the stored preference replaces them once it loads.
  const loadStoredDisplayCurrency = useCallback(
    () => loadDisplayCurrency(defaultDisplayCurrency),
    [defaultDisplayCurrency],
  );
  const [displayCurrency, handleDisplayCurrencyChange] = useStoredPreference(
    loadStoredDisplayCurrency,
    defaultDisplayCurrency,
    saveDisplayCurrency,
  );
  // Assets start visible and hydrate from storage in the background; a failed
  // read stays visible and a failed write reverts on the next launch, neither
  // worth an alert over a view setting (see useStoredPreference).
  const loadStoredAssetPrivacyMode = useCallback(
    () => loadAssetPrivacyMode("visible"),
    [],
  );
  const [assetPrivacyMode, setAssetPrivacyMode] = useStoredPreference(
    loadStoredAssetPrivacyMode,
    "visible",
    saveAssetPrivacyMode,
  );
  // The eye toggle flips the mode. Functional update (supported by
  // useStoredPreference) so a rapid double-tap toggles twice instead of
  // re-reading a stale closure of the mode.
  const isAssetPrivacyModeEnabled = assetPrivacyMode === "hidden";
  const toggleAssetPrivacyMode = useCallback(
    () =>
      setAssetPrivacyMode((current) =>
        current === "hidden" ? "visible" : "hidden",
      ),
    [setAssetPrivacyMode],
  );
  const [chartRange, handleChartRangeChange] = useStoredPreference(
    loadNetWorthRange,
    DEFAULT_NET_WORTH_RANGE,
    saveNetWorthRange,
  );
  // The name captured during onboarding; "" until the stored value loads (or
  // if onboarding was skipped), in which case the greeting falls back.
  const [userName] = useStoredPreference(loadUserName, "");

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
  // The chart, the pill, and the footer delta all read the selected window, so
  // it is narrowed once here. Memoized because `useAssetAccounts` hands back a
  // cached snapshot reference when nothing was recorded — re-filtering on every
  // render would hand the chart a new array each time and throw away its
  // memoized geometry.
  const rangedSnapshots = useMemo(
    () => selectSnapshotsInRange(snapshots, chartRange),
    [snapshots, chartRange],
  );
  // Read in the display currency, not converted from a base one: snapshots
  // carry a figure per currency because holdings are revalued at today's rate
  // while the capital behind them stays frozen at the rate it moved at. So a
  // rate move is growth in one currency and nothing in another, and switching
  // the currency genuinely recomputes the answer rather than rescaling it.
  const trend = useMemo(
    () => computeNetWorthTrend(rangedSnapshots, displayCurrency),
    [rangedSnapshots, displayCurrency],
  );
  // One direction drives the pill, the footer amount, and the curve, so a red
  // number can never sit on a green line. Unknown deltas read as non-negative
  // so nothing flashes red while data loads.
  const isDeclining = trend.delta !== null && trend.delta < 0;
  // Range labels are plural-aware messages, so each option names its own key
  // and count. Keying the labels by range (instead of listing options inline)
  // makes the compiler demand a label whenever a range is added.
  const chartRangeOptions = useMemo(() => {
    const labels: Record<NetWorthRange, string> = {
      "1m": t("home.pastMonths", { count: 1 }),
      "3m": t("home.pastMonths", { count: 3 }),
      "6m": t("home.pastMonths", { count: 6 }),
      "1y": t("home.pastYears", { count: 1 }),
      all: t("home.allTime"),
    };
    return NET_WORTH_RANGES.map((value) => ({ value, label: labels[value] }));
  }, [t]);
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
  // While accounts or rates are still loading (or a load failed) show "—".
  // Once settled: no accounts → 0.00 plus a hint to add an account (the total
  // is genuinely 0); accounts present but the total didn't convert (rates
  // unavailable for every balance) → "—"; otherwise the formatted total.
  const isWaiting = accountsAreLoading || accountLoadingFailed || !ratesReady;
  const showEmptyBalanceHint = !isWaiting && accounts.length === 0;
  // Privacy mode masks asset figures with a fixed string, but an unavailable
  // figure ("—") is a state the user must still be able to read — a mask
  // would masquerade missing data as hidden assets. So the mask replaces only
  // real, loaded amounts: the 0.00 "no accounts yet" total is a genuine figure
  // and masks like any other (a bare "0" among bulleted figures would read as
  // a leak); only the "—" unavailability placeholder stays readable.
  const totalDisplayValue = (() => {
    if (isWaiting) {
      // Waiting state shows the "—" placeholder, which the mask leaves readable
      // (no digits to hide): revealing "—" while loaded figures are masked
      // doesn't leak anything real, unlike showing an actual amount would.
      return "—";
    }
    if (displayTotal === null) {
      return showEmptyBalanceHint
        ? maskAssetAmount(
            formatCurrency(0, displayCurrency),
            isAssetPrivacyModeEnabled,
          )
        : "—";
    }
    return maskAssetAmount(
      formatCurrency(displayTotal, displayCurrency),
      isAssetPrivacyModeEnabled,
    );
  })();

  const chartDeltaText = (() => {
    // A window too short to have a delta is one the chart is already covering
    // with its "building history" placeholder, so the footer stays a dash
    // rather than repeating that sentence a few points away from it.
    if (trend.delta === null) {
      return "—";
    }
    const sign = trend.delta >= 0 ? "+" : "-";
    return maskAssetAmount(
      `${sign}${formatCurrency(Math.abs(trend.delta), displayCurrency)}`,
      isAssetPrivacyModeEnabled,
    );
  })();

  const [activeRowId, setActiveRowId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // `refresh` never rejects (it absorbs its own failures), so the spinner is
  // dropped on settle without a failure branch — a pull that couldn't reach the
  // rate service simply leaves the screen on the figures it already had.
  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    void refresh().finally(() => setIsRefreshing(false));
  }, [refresh]);

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
    <SafeAreaView style={screenStyles.safeArea} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            colors={[COLORS.brand]}
            onRefresh={handleRefresh}
            refreshing={isRefreshing}
            tintColor={COLORS.brand}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text style={screenStyles.wordmark}>{t("common.wordmark")}</Text>
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.6}
              style={styles.greeting}
            >
              {userName
                ? t("home.greeting", { name: userName })
                : t("home.greetingFallback")}
            </Text>
          </View>
          <View style={styles.headerActions}>
            {/* Dev-mode entry, shown only in dev builds (production drops the
                /dev route and renders a plain round add button instead; see
                _layout.tsx). Placed left of the add button with the flask icon
                so it reads as a developer utility next to the primary action. */}
            {isDev ? (
              <Button
                size="sm"
                variant="ghost"
                icon="flask-conical"
                accessibilityLabel={t("devTools.title")}
                onPress={() => router.push("/dev")}
              >
                {t("home.devToolsLabel")}
              </Button>
            ) : null}
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
                <IconButton
                  name={isAssetPrivacyModeEnabled ? "eye-off" : "eye"}
                  size="sm"
                  variant="onDark"
                  iconSize="sm"
                  accessibilityLabel={
                    isAssetPrivacyModeEnabled
                      ? t("home.showAssetAmounts")
                      : t("home.hideAssetAmounts")
                  }
                  accessibilityHint={
                    isAssetPrivacyModeEnabled
                      ? t("home.showAssetAmountsHint")
                      : t("home.hideAssetAmountsHint")
                  }
                  accessibilityState={{
                    checked: isAssetPrivacyModeEnabled,
                  }}
                  hitSlop={8}
                  onPress={toggleAssetPrivacyMode}
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
            {accountsAreLoading || !ratesReady ? (
              <View
                style={[
                  styles.changePill,
                  isCompact && styles.changePillCompact,
                ]}
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
                  color={
                    isDeclining ? COLORS.negativeOnDark : COLORS.accentOnDark
                  }
                />
                <Text
                  style={[
                    styles.changeText,
                    isDeclining && styles.changeTextNegative,
                  ]}
                >
                  {maskAssetAmount(
                    `${trend.changePercent >= 0 ? "+" : ""}${trend.changePercent.toFixed(1)}%`,
                    isAssetPrivacyModeEnabled,
                  )}
                </Text>
              </View>
            ) : null}
          </View>

          <View style={styles.chartWrap}>
            <NetWorthChart
              snapshots={rangedSnapshots}
              currency={displayCurrency}
              isNegative={isDeclining}
              placeholderText={
                // A snapshot needs a rate for every currency, because it
                // records one figure per currency — so a device that has never
                // reached the rate service records nothing at all, and the
                // usual "building history" copy would promise progress that
                // will never come. Name the real reason instead.
                ratesReady && !amountsConvertible(rates)
                  ? t("home.chartRatesUnavailable")
                  : t("home.chartAccumulating")
              }
            />
          </View>

          <View
            style={[styles.chartFooter, isCompact && styles.chartFooterCompact]}
          >
            <OptionPicker
              dialogTitle={t("home.chartRange")}
              onChange={handleChartRangeChange}
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
        </View>

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
                <Text style={styles.legendValue}>
                  {maskAssetAmount(
                    `${item.percent}%`,
                    isAssetPrivacyModeEnabled,
                  )}
                </Text>
              </View>
            ))}
          </View>
        </View>

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

        <View style={styles.accountsCard}>
          {accountsAreLoading ? (
            <View style={styles.accountsPlaceholder} />
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
                isBalanceHidden={isAssetPrivacyModeEnabled}
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
    // A labeled button sits next to the circular add button, which is tighter
    // than two pure icon buttons — give the pair air so the primary action
    // keeps its own breathing room.
    gap: SPACING.md,
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
    width: 48,
  },
  changeText: {
    color: COLORS.accentOnDark,
    fontSize: FONT_SIZE.eyebrow,
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
    fontWeight: FONT_WEIGHT.bold,
  },
  chartDeltaNegative: {
    color: COLORS.negativeOnDark,
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
    minHeight: ACCOUNT_ROW_HEIGHT,
  },
  // Invisible placeholder holding the accounts card's height while the local
  // accounts load (fast). Transparent so it blends with the card surface — no
  // skeleton/spinner flash — and ACCOUNT_ROW_HEIGHT matches a real row.
  accountsPlaceholder: {
    backgroundColor: "transparent",
    minHeight: ACCOUNT_ROW_HEIGHT,
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
