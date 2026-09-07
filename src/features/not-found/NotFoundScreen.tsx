import { Stack } from "expo-router";
import { useTranslation } from "react-i18next";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/Button";
import { useReturnToOverview } from "@/lib/useReturnToOverview";
import { COLORS } from "@/theme/colors";
import { cardSurface, screenStyles } from "@/theme/screen-styles";
import { SPACING } from "@/theme/spacing";
import {
  FONT_SIZE,
  FONT_WEIGHT,
  LETTER_SPACING,
  LINE_HEIGHT,
} from "@/theme/typography";

export function NotFoundScreen() {
  const { t } = useTranslation();
  const returnToOverview = useReturnToOverview();

  return (
    <>
      <Stack.Screen options={{ title: t("notFound.screenTitle") }} />
      <SafeAreaView style={screenStyles.safeArea}>
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
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
        </ScrollView>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    alignItems: "center",
    flexGrow: 1,
    justifyContent: "center",
    padding: SPACING.xl,
  },
  card: {
    ...cardSurface,
    alignItems: "center",
    borderColor: COLORS.border,
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
    textAlign: "center",
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
