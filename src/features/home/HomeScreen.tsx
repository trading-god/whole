import { Link, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AccountsCard } from "@/features/home/AccountsCard";
import { AssetDistributionCard } from "@/features/home/AssetDistributionCard";
import { NetWorthCard } from "@/features/home/NetWorthCard";
import { IconButton } from "@/components/IconButton";
import { SectionHeader } from "@/components/SectionHeader";
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
import { useAssetAccounts } from "@/features/home/use-asset-accounts";
import { useOnboardingState } from "@/features/onboarding/onboarding-context";
import { loadUserName } from "@/features/user/user-store";
import { useAppLocale } from "@/i18n";
import { useStoredPreference } from "@/storage/use-stored-preference";
import { COLORS } from "@/theme/colors";
import {
  actionLink,
  actionLinkButton,
  screenStyles,
} from "@/theme/screen-styles";
import { SPACING } from "@/theme/spacing";
import { FONT_SIZE, FONT_WEIGHT, LETTER_SPACING } from "@/theme/typography";

// The placeholder this screen already uses for "there is no figure to show
// here" (the total while rates load). The legend reuses it for a kind that is
// held but has no share of the composition — a liability.
const UNAVAILABLE_VALUE = "—";

// Hoisted out of the screen so `useStoredPreference`'s load effect sees one
// stable identity for the life of the app. It captures nothing.
const loadStoredAssetPrivacyMode = () => loadAssetPrivacyMode("visible");

// First-run guard. The root layout's auth gate redirects un-onboarded users
// to /onboarding, but expo-router still mounts this screen for a frame
// before the `replace` lands — and the splash screen doesn't always cover
// that window under SDK 57. Render a blank surface (matching the app
// background) until the gate clears, so the worst case is a seamless
// blank → onboarding transition instead of home → onboarding. The real home
// UI lives in <HomeScreen /> below so its hooks (account loading, etc.) only
// run once onboarding is complete.
export default function HomeScreen() {
  const isOnboarded = useOnboardingState();
  if (!isOnboarded) {
    return <View style={screenStyles.safeArea} />;
  }
  return <HomeScreenBody />;
}

function HomeScreenBody() {
  const { formatCurrency, languageTag } = useAppLocale();
  const { t } = useTranslation();
  const router = useRouter();
  const {
    accounts,
    groups,
    snapshots,
    rates,
    ratesReady,
    error: accountLoadingFailed,
    isLoading: accountsAreLoading,
    removeAccount,
    refresh,
  } = useAssetAccounts();
  // Not memoized: it returns a `Currency` string, and every dep array below
  // compares it by value.
  const defaultDisplayCurrency =
    defaultDisplayCurrencyForLanguageTag(languageTag);
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
  // worth an alert over a view setting (see useStoredPreference). The loader is
  // a module constant rather than an empty-dep `useCallback` — it captures
  // nothing, and the hook's effect keys off its identity.
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
  // While accounts or rates are still loading (or a load failed) show "—".
  // Once settled: no accounts → 0.00 (the total is genuinely 0); accounts
  // present but the total didn't convert (rates unavailable for every balance)
  // → "—"; otherwise the formatted total.
  const isWaiting = accountsAreLoading || accountLoadingFailed || !ratesReady;
  // Settled, and there is genuinely nothing tracked yet — the loading half of
  // the test is why this is not simply `accounts.length === 0`. It is also a
  // different state from "history is still too short", and the card says so
  // differently: no curve can appear here until an account exists, so the chart
  // area becomes the invitation to add one rather than a progress message that
  // would never resolve.
  const isSettledEmpty = !isWaiting && accounts.length === 0;
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
      return UNAVAILABLE_VALUE;
    }
    if (displayTotal === null) {
      return isSettledEmpty
        ? maskAssetAmount(
            formatCurrency(0, displayCurrency),
            isAssetPrivacyModeEnabled,
          )
        : UNAVAILABLE_VALUE;
    }
    return maskAssetAmount(
      formatCurrency(displayTotal, displayCurrency),
      isAssetPrivacyModeEnabled,
    );
  })();

  const chartDeltaText = (() => {
    // A window too short to have a delta is one the chart is already covering
    // with its own placeholder, so the footer stays a dash rather than
    // repeating that sentence a few points away from it.
    if (trend.delta === null) {
      return UNAVAILABLE_VALUE;
    }
    const sign = trend.delta >= 0 ? "+" : "-";
    return maskAssetAmount(
      `${sign}${formatCurrency(Math.abs(trend.delta), displayCurrency)}`,
      isAssetPrivacyModeEnabled,
    );
  })();

  const [isRefreshing, setIsRefreshing] = useState(false);

  // `refresh` never rejects (it absorbs its own failures), so the spinner is
  // dropped on settle without a failure branch — a pull that couldn't reach the
  // rate service simply leaves the screen on the figures it already had.
  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    void refresh().finally(() => setIsRefreshing(false));
  }, [refresh]);

  const handleOpenAccount = useCallback(
    (id: string) => {
      router.push({ pathname: "/accounts/[id]", params: { id } });
    },
    [router],
  );

  return (
    <SafeAreaView style={screenStyles.safeArea} edges={["top"]}>
      <ScrollView
        contentContainerStyle={screenStyles.contentScrollEnd}
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
            {/* Settings is where the model endpoint is configured, and every
                "set one up in Settings" message the recognition path can
                produce has to be able to land somewhere. */}
            <IconButton
              name="settings"
              size="md"
              variant="outline"
              accessibilityLabel={t("settings.title")}
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

        <NetWorthCard
          displayCurrency={displayCurrency}
          displayCurrencies={displayCurrencies}
          onDisplayCurrencyChange={handleDisplayCurrencyChange}
          isPrivacyEnabled={isAssetPrivacyModeEnabled}
          onTogglePrivacy={toggleAssetPrivacyMode}
          totalDisplayValue={totalDisplayValue}
          showPillPlaceholder={accountsAreLoading || !ratesReady}
          trend={trend}
          isDeclining={isDeclining}
          rangedSnapshots={rangedSnapshots}
          ratesUnavailable={ratesReady && !amountsConvertible(rates)}
          isSettledEmpty={isSettledEmpty}
          onAddAccount={() => router.push("/accounts/new")}
          chartRange={chartRange}
          chartRangeOptions={chartRangeOptions}
          onChartRangeChange={handleChartRangeChange}
          chartDeltaText={chartDeltaText}
        />

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

        <AssetDistributionCard
          totalsByKind={totalsByKind}
          isPrivacyEnabled={isAssetPrivacyModeEnabled}
        />

        <SectionHeader
          title={t("home.myAccounts")}
          detail={
            <Link href="/accounts/new" asChild>
              <Pressable
                accessibilityLabel={t("common.addAccount")}
                style={({ pressed }) => [
                  actionLinkButton,
                  pressed && screenStyles.pressed,
                ]}
              >
                <Text style={actionLink}>{t("home.add")}</Text>
              </Pressable>
            </Link>
          }
        />

        <AccountsCard
          accounts={accounts}
          groups={groups}
          displayCurrency={displayCurrency}
          rates={rates}
          isBalanceHidden={isAssetPrivacyModeEnabled}
          isLoading={accountsAreLoading}
          loadFailed={Boolean(accountLoadingFailed)}
          onOpenAccount={handleOpenAccount}
          onRemove={removeAccount}
        />

        <Text style={styles.privacyNote}>{t("home.accountDataPrivacy")}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
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
  sectionMeta: {
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
