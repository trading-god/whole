import Constants from "expo-constants";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/Button";
import { type PickerOption, OptionPicker } from "@/components/OptionPicker";
import { ScreenHeader } from "@/components/ScreenHeader";
import { SectionHeader } from "@/components/SectionHeader";
import {
  type Currency,
  defaultDisplayCurrencyForLanguageTag,
  orderedDisplayCurrencies,
} from "@/features/assets/currencies";
import {
  loadDisplayCurrency,
  saveDisplayCurrency,
} from "@/features/assets/display-currency-store";
import { RecognitionEngineSection } from "@/features/recognition/RecognitionEngineSection";
import { useAppLocale } from "@/i18n";
import { useStoredPreference } from "@/storage/use-stored-preference";
import { COLORS } from "@/theme/colors";
import { MIN_INTERACTIVE_SIZE, useResponsiveLayout } from "@/theme/layout";
import { screenStyles } from "@/theme/screen-styles";
import { SPACING } from "@/theme/spacing";
import { FONT_SIZE, FONT_WEIGHT } from "@/theme/typography";

// What the settings screen has to say.
//
// Three sections. DISPLAY holds the one preference the app keeps for the user
// — the currency everything is converted into — which used to live only in a
// small trigger on the home card, where nobody looking for a setting would
// look. LANGUAGE follows the system, and says so rather than hiding the fact.
// RECOGNITION is the engine choice: which model annotates a screenshot — the
// downloaded on-device one, or the user's own cloud service — with each
// engine's configuration living inside its card (see
// RecognitionEngineSection). ABOUT is the version.

const APP_VERSION = Constants.expoConfig?.version ?? "";
export function SettingsScreen() {
  const { t } = useTranslation();
  const { languageTag } = useAppLocale();
  const { isCompact } = useResponsiveLayout();

  // The display currency, shared with the home screen through the same
  // store; either surface may change it and the other follows on next load.
  const defaultDisplayCurrency =
    defaultDisplayCurrencyForLanguageTag(languageTag);
  const loadStoredDisplayCurrency = useCallback(
    () => loadDisplayCurrency(defaultDisplayCurrency),
    [defaultDisplayCurrency],
  );
  const [displayCurrency, setDisplayCurrency] = useStoredPreference(
    loadStoredDisplayCurrency,
    defaultDisplayCurrency,
    saveDisplayCurrency,
  );
  const currencyOptions: PickerOption<Currency>[] = orderedDisplayCurrencies(
    defaultDisplayCurrency,
  ).map((currency) => ({ value: currency, label: currency }));

  return (
    <SafeAreaView style={screenStyles.safeArea}>
      <ScreenHeader title={t("settings.title")} />
      <ScrollView
        contentContainerStyle={screenStyles.contentScrollEnd}
        showsVerticalScrollIndicator={false}
      >
        <SectionHeader title={t("settings.display")} />
        <View style={screenStyles.formCard}>
          <View style={styles.row}>
            <View style={styles.rowCopy}>
              <Text style={styles.rowTitle}>{t("home.displayCurrency")}</Text>
              <Text style={styles.rowHint}>
                {t("settings.displayCurrencyHint")}
              </Text>
            </View>
            <OptionPicker
              dialogTitle={t("home.displayCurrency")}
              onChange={setDisplayCurrency}
              options={currencyOptions}
              value={displayCurrency}
              variant="onLight"
            />
          </View>
          <View style={screenStyles.fieldDivider} />
          <View style={[styles.row, isCompact && styles.rowCompact]}>
            <View style={styles.rowCopy}>
              <Text style={styles.rowTitle}>{t("settings.language")}</Text>
              <Text style={styles.rowHint}>
                {t("settings.languageFollowsSystem")}
              </Text>
            </View>
            <Button
              accessibilityHint={t("settings.changeInSystemSettingsHint")}
              size="xs"
              variant="outline"
              fullWidth={isCompact}
              onPress={() => void Linking.openSettings()}
            >
              {t("settings.changeInSystemSettings")}
            </Button>
          </View>
        </View>

        <SectionHeader title={t("settings.engine.title")} />
        <View style={screenStyles.formCard}>
          <View style={styles.engineArea}>
            <RecognitionEngineSection />
          </View>
        </View>

        <SectionHeader title={t("settings.about")} />
        <View style={screenStyles.formCard}>
          <View style={styles.row}>
            <Text style={styles.rowTitle}>
              {t("settings.version", { version: APP_VERSION })}
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  engineArea: {
    paddingVertical: SPACING.md,
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: SPACING.md,
    justifyContent: "space-between",
    minHeight: MIN_INTERACTIVE_SIZE,
    paddingVertical: SPACING.md,
  },
  rowCompact: {
    alignItems: "stretch",
    flexDirection: "column",
  },
  rowCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  rowTitle: {
    color: COLORS.ink,
    fontSize: FONT_SIZE.body,
    fontWeight: FONT_WEIGHT.semibold,
  },
  rowHint: {
    ...screenStyles.metaLine,
  },
});
