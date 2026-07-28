import { Link, Stack } from "expo-router";
import Head from "expo-router/head";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { COLORS } from "@/theme/colors";

export default function NotFoundScreen() {
  const { t } = useTranslation();

  return (
    <>
      <Head>
        <title>{t("metadata.notFoundTitle")}</title>
        <meta name="robots" content="noindex,nofollow" />
      </Head>
      <Stack.Screen options={{ title: t("notFound.screenTitle") }} />
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.card}>
          <Text style={styles.code}>404</Text>
          <Text style={styles.title}>{t("notFound.title")}</Text>
          <Text style={styles.description}>{t("notFound.description")}</Text>
          <Link href="/" replace asChild>
            <Pressable
              accessibilityLabel={t("common.backToAssetOverview")}
              style={({ pressed }) => [
                styles.homeButton,
                pressed && styles.homeButtonPressed,
              ]}
            >
              <Text style={styles.homeButtonText}>
                {t("common.backToAssetOverview")}
              </Text>
            </Pressable>
          </Link>
        </View>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    alignItems: "center",
    backgroundColor: COLORS.background,
    flex: 1,
    justifyContent: "center",
    padding: 20,
  },
  card: {
    alignItems: "center",
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
    borderRadius: 24,
    borderWidth: 1,
    maxWidth: 420,
    padding: 28,
    width: "100%",
  },
  code: {
    color: COLORS.brand,
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 2,
  },
  title: {
    color: COLORS.ink,
    fontSize: 24,
    fontWeight: "800",
    marginTop: 12,
  },
  description: {
    color: COLORS.muted,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 10,
    textAlign: "center",
  },
  homeButton: {
    alignItems: "center",
    backgroundColor: COLORS.brand,
    borderRadius: 16,
    justifyContent: "center",
    marginTop: 24,
    minHeight: 48,
    paddingHorizontal: 20,
  },
  homeButtonPressed: {
    opacity: 0.8,
  },
  homeButtonText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
  },
});
