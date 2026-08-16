import { Redirect } from "expo-router";
import { useTranslation } from "react-i18next";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ScreenHeader } from "@/components/ScreenHeader";
import { cardSurface, screenStyles } from "@/theme/screen-styles";
import { COLORS } from "@/theme/colors";
import { SPACING } from "@/theme/spacing";
import { FONT_SIZE, FONT_WEIGHT, LINE_HEIGHT } from "@/theme/typography";

// Dev Tools dashboard (`/dev`). The home screen's "Dev Mode" button lands here
// in dev builds; production builds don't register the route, so this has no
// surface in a release. It currently hosts no tool — OCR fixture capture moved
// to the macOS Vision bridge (`pnpm ocr`), which runs the same rule engine off
// device — so the screen is kept as the landing spot for the next dev-only
// utility rather than removed along with it.
export default function DevToolsScreen() {
  const { t } = useTranslation();
  // Expo Router auto-discovers `app/dev/` files, so the route exists in
  // production bundles even though _layout.tsx only registers it under __DEV__.
  // Bounce any deep-linked production visit back to the home screen.
  if (!__DEV__) {
    return <Redirect href="/" />;
  }

  return (
    <SafeAreaView style={screenStyles.safeArea}>
      <ScreenHeader title={t("devTools.title")} />
      <ScrollView
        contentContainerStyle={screenStyles.contentScrollEnd}
        showsVerticalScrollIndicator={false}
      >
        <Text style={screenStyles.formHint}>{t("devTools.subtitle")}</Text>
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>{t("devTools.emptyTitle")}</Text>
          <Text style={styles.emptyHint}>{t("devTools.emptyHint")}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  emptyCard: {
    ...cardSurface,
    gap: SPACING.xs,
    marginTop: SPACING.lg,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.lg,
  },
  emptyTitle: {
    color: COLORS.ink,
    fontSize: FONT_SIZE.bodyLg,
    fontWeight: FONT_WEIGHT.bold,
  },
  emptyHint: {
    color: COLORS.muted,
    fontSize: FONT_SIZE.bodySm,
    lineHeight: LINE_HEIGHT.body,
  },
});
