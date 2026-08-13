import { Redirect, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ScreenHeader } from "@/components/ScreenHeader";
import { cardSurface, screenStyles } from "@/theme/screen-styles";
import { COLORS } from "@/theme/colors";
import { SPACING } from "@/theme/spacing";
import { FONT_SIZE, FONT_WEIGHT } from "@/theme/typography";

// Dev Tools dashboard (`/dev`). The home screen's "Dev Mode" button lands here
// in dev builds; production builds don't register the route, so this has no
// surface in a release. Each row is a dev-only tool — the OCR fixture capture
// that generates regression samples for `packages/ocr-eval`.
export default function DevToolsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
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
        <View style={styles.section}>
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.row,
              pressed && screenStyles.pressed,
            ]}
            onPress={() => router.push("/dev/ocr-capture")}
          >
            <View style={styles.rowCopy}>
              <Text style={styles.rowTitle}>
                {t("devTools.ocrCaptureTitle")}
              </Text>
              <Text style={styles.rowSubtitle}>
                {t("devTools.ocrCaptureSubtitle")}
              </Text>
            </View>
            <Text style={styles.rowChevron}>›</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: SPACING.sm,
    marginTop: SPACING.lg,
  },
  row: {
    ...cardSurface,
    alignItems: "center",
    flexDirection: "row",
    gap: SPACING.md,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
  },
  rowCopy: {
    flex: 1,
    gap: SPACING.xs,
  },
  rowTitle: {
    color: COLORS.ink,
    fontSize: FONT_SIZE.bodyLg,
    fontWeight: FONT_WEIGHT.bold,
  },
  rowSubtitle: {
    color: COLORS.muted,
    fontSize: FONT_SIZE.bodySm,
  },
  rowChevron: {
    color: COLORS.subtle,
    fontSize: FONT_SIZE.bodyLg,
  },
});
