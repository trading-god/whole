import { Link } from "expo-router";
import Head from "expo-router/head";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  Circle,
  Defs,
  LinearGradient,
  Path,
  Stop,
  Svg,
} from "react-native-svg";

import type { AssetAccount } from "@/features/assets/asset-repository";
import { defaultAssetCurrency } from "@/features/assets/currencies";
import { useAssetAccounts } from "@/features/assets/use-asset-accounts";
import { useAppLocale } from "@/i18n";
import { COLORS } from "@/theme/colors";

function AccountRow({ account }: { account: AssetAccount }) {
  const { formatCurrency } = useAppLocale();

  return (
    <View style={styles.accountRow}>
      <View style={[styles.accountIcon, { backgroundColor: account.tint }]}>
        <Text style={[styles.accountInitial, { color: account.color }]}>
          {account.initial}
        </Text>
      </View>
      <View style={styles.accountIdentity}>
        <Text style={styles.accountName}>{account.name}</Text>
        <Text style={styles.accountNumber}>
          •••• {account.accountLastFourDigits}
        </Text>
      </View>
      <View style={styles.accountValue}>
        <Text style={styles.accountBalance}>
          {formatCurrency(account.balance, account.currency)}
        </Text>
        <Text style={styles.accountCurrency}>{account.currency}</Text>
      </View>
    </View>
  );
}

export default function Index() {
  const { formatCurrency } = useAppLocale();
  const { t } = useTranslation();
  const {
    accounts,
    error: accountLoadingFailed,
    isLoading: accountsAreLoading,
  } = useAssetAccounts();
  const totalBalance = useMemo(
    () =>
      accounts
        .filter((account) => account.currency === defaultAssetCurrency)
        .reduce((total, account) => total + account.balance, 0),
    [accounts],
  );
  const distribution = [
    { id: "cash", label: t("home.cash"), value: 47, color: "#A9E0C9" },
    {
      id: "investments",
      label: t("home.investments"),
      value: 35,
      color: "#7CBFA8",
    },
    {
      id: "digital-assets",
      label: t("home.digitalAssets"),
      value: 18,
      color: "#F0C781",
    },
  ];

  return (
    <>
      <Head>
        <title>{t("metadata.homeTitle")}</title>
        <meta name="description" content={t("metadata.homeDescription")} />
      </Head>
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <View>
              <Text style={styles.wordmark}>{t("common.wordmark")}</Text>
              <Text style={styles.greeting}>
                {t("home.greeting", { name: "Jack" })}
              </Text>
            </View>
            <Link href="/accounts/new" asChild>
              <Pressable
                accessibilityLabel={t("common.addAccount")}
                hitSlop={12}
                style={({ pressed }) => [
                  styles.addButton,
                  pressed && styles.addButtonPressed,
                ]}
              >
                <Text style={styles.addButtonLabel}>＋</Text>
              </Pressable>
            </Link>
          </View>

          <View style={styles.balanceCard}>
            <View style={styles.balanceCardTop}>
              <View>
                <Text style={styles.eyebrow}>
                  {t("home.totalAssetsInCurrency", {
                    currency: defaultAssetCurrency,
                  })}
                </Text>
                <Text style={styles.totalBalance}>
                  {accountsAreLoading || accountLoadingFailed
                    ? "—"
                    : formatCurrency(totalBalance, defaultAssetCurrency)}
                </Text>
              </View>
              <View style={styles.changePill}>
                <Text style={styles.changeText}>↗ 3.8%</Text>
              </View>
            </View>

            <View style={styles.chartWrap}>
              <Svg
                height="112"
                preserveAspectRatio="none"
                viewBox="0 0 330 112"
                width="100%"
              >
                <Defs>
                  <LinearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1">
                    <Stop offset="0" stopColor="#77D2B1" stopOpacity="0.38" />
                    <Stop offset="1" stopColor="#77D2B1" stopOpacity="0" />
                  </LinearGradient>
                </Defs>
                <Path
                  d="M0 90 C22 84 34 60 54 64 C78 70 86 88 108 76 C132 63 142 35 164 42 C184 49 194 68 214 60 C235 51 246 18 268 27 C292 37 302 21 330 9 L330 112 L0 112 Z"
                  fill="url(#chartFill)"
                />
                <Path
                  d="M0 90 C22 84 34 60 54 64 C78 70 86 88 108 76 C132 63 142 35 164 42 C184 49 194 68 214 60 C235 51 246 18 268 27 C292 37 302 21 330 9"
                  fill="none"
                  stroke="#79D7B5"
                  strokeLinecap="round"
                  strokeWidth="3"
                />
                <Circle cx="330" cy="9" fill="#D9FFF0" r="5" />
                <Circle cx="330" cy="9" fill="#69C8A6" r="3" />
              </Svg>
            </View>

            <View style={styles.chartFooter}>
              <Text style={styles.chartPeriod}>
                {t("home.pastMonths", { count: 6 })}
              </Text>
              <Text style={styles.chartDelta}>
                +{formatCurrency(4702.8, defaultAssetCurrency)}
              </Text>
            </View>
          </View>

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>
              {t("home.assetComposition")}
            </Text>
            <Text style={styles.sectionMeta}>
              {accountsAreLoading
                ? t("home.loading")
                : t("home.accountCount", { count: accounts.length })}
            </Text>
          </View>

          <View style={styles.distributionCard}>
            <View style={styles.distributionBar}>
              {distribution.map((item) => (
                <View
                  key={item.id}
                  style={[
                    styles.distributionSegment,
                    {
                      backgroundColor: item.color,
                      flex: item.value,
                    },
                  ]}
                />
              ))}
            </View>
            <View style={styles.legend}>
              {distribution.map((item) => (
                <View key={item.id} style={styles.legendItem}>
                  <View
                    style={[styles.legendDot, { backgroundColor: item.color }]}
                  />
                  <Text style={styles.legendLabel}>{item.label}</Text>
                  <Text style={styles.legendValue}>{item.value}%</Text>
                </View>
              ))}
            </View>
          </View>

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{t("home.myAccounts")}</Text>
            <Link href="/accounts/new" asChild>
              <Pressable
                accessibilityLabel={t("common.addAccount")}
                hitSlop={8}
              >
                <Text style={styles.sectionAction}>{t("home.add")}</Text>
              </Pressable>
            </Link>
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
                <View key={account.id}>
                  {index > 0 ? <View style={styles.separator} /> : null}
                  <AccountRow account={account} />
                </View>
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
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 36,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: 18,
    paddingTop: 10,
  },
  wordmark: {
    color: COLORS.brand,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 2.2,
  },
  greeting: {
    color: COLORS.ink,
    fontSize: 24,
    fontWeight: "700",
    letterSpacing: -0.6,
    marginTop: 5,
  },
  addButton: {
    alignItems: "center",
    backgroundColor: COLORS.brand,
    borderRadius: 22,
    height: 44,
    justifyContent: "center",
    shadowColor: COLORS.brandShadow,
    shadowOffset: { width: 0, height: 7 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    width: 44,
  },
  addButtonPressed: {
    opacity: 0.78,
    transform: [{ scale: 0.96 }],
  },
  addButtonLabel: {
    color: "#FFFFFF",
    fontSize: 27,
    fontWeight: "300",
    lineHeight: 30,
    marginTop: -2,
  },
  balanceCard: {
    backgroundColor: COLORS.brandDark,
    borderRadius: 28,
    overflow: "hidden",
    paddingHorizontal: 22,
    paddingTop: 22,
  },
  balanceCardTop: {
    alignItems: "flex-start",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  eyebrow: {
    color: "#ABC1B8",
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.4,
  },
  totalBalance: {
    color: "#FFFFFF",
    fontSize: 34,
    fontWeight: "700",
    letterSpacing: -1.5,
    marginTop: 8,
  },
  changePill: {
    backgroundColor: "rgba(130, 220, 185, 0.14)",
    borderColor: "rgba(130, 220, 185, 0.18)",
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  changeText: {
    color: "#8CE1C1",
    fontSize: 12,
    fontWeight: "700",
  },
  chartWrap: {
    height: 112,
    marginHorizontal: -22,
    marginTop: 10,
  },
  chartFooter: {
    alignItems: "center",
    borderTopColor: "rgba(255,255,255,0.08)",
    borderTopWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 15,
  },
  chartPeriod: {
    color: "#ABC1B8",
    fontSize: 12,
  },
  chartDelta: {
    color: "#8CE1C1",
    fontSize: 12,
    fontWeight: "700",
  },
  sectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 12,
    marginTop: 26,
    paddingHorizontal: 2,
  },
  sectionTitle: {
    color: COLORS.ink,
    fontSize: 17,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
  sectionMeta: {
    color: COLORS.muted,
    fontSize: 12,
  },
  sectionAction: {
    color: COLORS.brand,
    fontSize: 13,
    fontWeight: "700",
  },
  distributionCard: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.cardBorder,
    borderRadius: 22,
    borderWidth: 1,
    padding: 18,
  },
  distributionBar: {
    flexDirection: "row",
    gap: 4,
    height: 10,
    overflow: "hidden",
  },
  distributionSegment: {
    borderRadius: 5,
  },
  legend: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 18,
  },
  legendItem: {
    alignItems: "center",
    flexDirection: "row",
  },
  legendDot: {
    borderRadius: 4,
    height: 8,
    marginRight: 6,
    width: 8,
  },
  legendLabel: {
    color: COLORS.muted,
    fontSize: 11,
  },
  legendValue: {
    color: COLORS.ink,
    fontSize: 11,
    fontWeight: "700",
    marginLeft: 4,
  },
  accountsCard: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.cardBorder,
    borderRadius: 22,
    borderWidth: 1,
    paddingHorizontal: 16,
  },
  accountRow: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 76,
  },
  accountStatus: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    minHeight: 76,
  },
  accountStatusText: {
    color: COLORS.muted,
    fontSize: 12,
    marginLeft: 8,
  },
  accountErrorText: {
    color: COLORS.muted,
    fontSize: 12,
  },
  accountIcon: {
    alignItems: "center",
    borderRadius: 14,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  accountInitial: {
    fontSize: 13,
    fontWeight: "800",
  },
  accountIdentity: {
    flex: 1,
    marginLeft: 12,
  },
  accountName: {
    color: COLORS.ink,
    fontSize: 14,
    fontWeight: "700",
  },
  accountNumber: {
    color: COLORS.subtle,
    fontSize: 11,
    letterSpacing: 0.5,
    marginTop: 5,
  },
  accountValue: {
    alignItems: "flex-end",
    marginLeft: 8,
  },
  accountBalance: {
    color: COLORS.ink,
    fontSize: 14,
    fontWeight: "700",
  },
  accountCurrency: {
    color: COLORS.subtle,
    fontSize: 10,
    marginTop: 5,
  },
  separator: {
    backgroundColor: COLORS.border,
    height: StyleSheet.hairlineWidth,
    marginLeft: 56,
  },
  privacyNote: {
    color: COLORS.subtle,
    fontSize: 11,
    marginTop: 20,
    textAlign: "center",
  },
});
