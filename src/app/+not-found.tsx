import { Stack } from "expo-router";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/Button";
import { useReturnToOverview } from "@/navigation/useReturnToOverview";
import { COLORS } from "@/theme/colors";
import { cardSurface, screenStyles } from "@/theme/screen-styles";
import { SPACING } from "@/theme/spacing";
import {
  FONT_SIZE,
  FONT_WEIGHT,
  LETTER_SPACING,
  LINE_HEIGHT,
} from "@/theme/typography";

export default function NotFoundScreen() {
  const { t } = useTranslation();
  const returnToOverview = useReturnToOverview();

  return (
    <>
      <Stack.Screen options={{ title: t("notFound.screenTitle") }} />
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.card}>
          <Text style={styles.code}>404</Text>
          <Text style={styles.title}>{t("notFound.title")}</Text>
          <Text style={styles.description}>{t("notFound.description")}</Text>
          <Button
            accessibilityLabel={t("common.backToAssetOverview")}
            onPress={returnToOverview}
            style={styles.button}
          >
            {t("common.backToAssetOverview")}
          </Button>
        </View>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    ...screenStyles.safeArea,
    alignItems: "center",
    justifyContent: "center",
    padding: SPACING.xl,
  },
  card: {
    ...cardSurface,
    // A standalone centered card uses a more visible border than the list/form
    // cards (which keep cardSurface's subtle cardBorder).
    borderColor: COLORS.border,
    alignItems: "center",
    // Layout-specific cap so the centered card doesn't stretch too wide on
    // tablets — a named constant, not a token, since RADIUS/SPACING don't
    // model a max content width.
    maxWidth: 420,
    padding: SPACING.xxl,
    width: "100%",
  },
  code: {
    color: COLORS.brand,
    fontSize: FONT_SIZE.body,
    fontWeight: FONT_WEIGHT.extrabold,
    letterSpacing: LETTER_SPACING.code,
  },
  title: {
    color: COLORS.ink,
    fontSize: FONT_SIZE.heading,
    fontWeight: FONT_WEIGHT.extrabold,
    marginTop: SPACING.md,
  },
  description: {
    color: COLORS.muted,
    fontSize: FONT_SIZE.body,
    lineHeight: LINE_HEIGHT.body,
    marginTop: SPACING.md,
    textAlign: "center",
  },
  button: {
    marginTop: SPACING.xxl,
  },
});
