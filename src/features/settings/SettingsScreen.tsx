import Constants from "expo-constants";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { verifyOnDeviceModel } from "@/features/on-device-model/model-context";
import { useAppLocale } from "@/i18n";
import { useStoredPreference } from "@/storage/use-stored-preference";
import { COLORS } from "@/theme/colors";
import { MIN_INTERACTIVE_SIZE } from "@/theme/layout";
import { cardSurface, screenStyles } from "@/theme/screen-styles";
import { RADIUS } from "@/theme/sizes";
import { SPACING } from "@/theme/spacing";
import { TONES } from "@/theme/tones";
import { FONT_SIZE, FONT_WEIGHT, LINE_HEIGHT } from "@/theme/typography";
import { formatBytes } from "@/features/on-device-model/format-bytes";
import { bundledModelStorageBytes } from "@/features/on-device-model/model-source";
import { BUNDLED_MODEL } from "@/features/on-device-model/on-device-catalog";

// What the settings screen has to say.
//
// Three sections. DISPLAY holds the one preference the app keeps for the user
// — the currency everything is converted into — which used to live only in a
// small trigger on the home card, where nobody looking for a setting would
// look. LANGUAGE follows the system, and says so rather than hiding the fact.
// RECOGNITION runs on the bundled model, entirely on this device, so there is
// nothing to configure; what is left is the two things a user can act on: SEE
// what the phone is carrying (which model, how much storage it takes) and TEST
// that it loads and runs, before spending a screenshot finding out. ABOUT is
// the version.
//
// The Test button keeps its label. The verdict is a line of text beside it: a
// button that turns green and reads "Working" for a moment looks like a
// switch, and the moment it turns back the verdict is gone. A line stays until
// the next test replaces it.

type TestPhase = "idle" | "testing" | "passed" | "failed";

// The label under the Test button for each settled phase; `null` while there
// is nothing to say.
const VERDICT_KEY = {
  idle: null,
  testing: "settings.onDevice.testing",
  passed: "settings.onDevice.testPassed",
  failed: "settings.onDevice.testFailure",
} as const satisfies Record<TestPhase, string | null>;

const APP_VERSION = Constants.expoConfig?.version ?? "";

export function SettingsScreen() {
  const { t } = useTranslation();
  const { languageTag } = useAppLocale();

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

  const [testPhase, setTestPhase] = useState<TestPhase>("idle");

  // Loading the model takes seconds, so a test can outlive the screen: the user
  // taps Test and navigates straight back. The state updates are gated on
  // this — without it the settled verdict calls `setTestPhase` on a component
  // that is gone.
  const isMountedRef = useRef(true);
  useEffect(() => {
    // Set on every run, not just the first: StrictMode mounts, unmounts and
    // mounts again, and a ref left `false` by that first cleanup would skip
    // every branch below for the life of the screen — the Test button would
    // spin forever with no verdict.
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const test = useCallback(() => {
    setTestPhase("testing");

    void verifyOnDeviceModel()
      .then(() => {
        if (isMountedRef.current) {
          setTestPhase("passed");
        }
      })
      .catch(() => {
        // The technical reason stays out of the UI — localized copy only
        // (AGENTS.md: all user-visible copy goes through i18next), and the
        // advice does not depend on which stage failed.
        if (isMountedRef.current) {
          setTestPhase("failed");
        }
      });
  }, []);

  const verdictKey = VERDICT_KEY[testPhase];

  return (
    <SafeAreaView style={screenStyles.safeArea}>
      <ScreenHeader title={t("settings.title")} />
      <ScrollView
        contentContainerStyle={screenStyles.contentScrollEnd}
        showsVerticalScrollIndicator={false}
      >
        <SectionHeader title={t("settings.display")} />
        <View style={styles.card}>
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
          <View
            accessibilityRole="button"
            accessibilityLabel={t("settings.language")}
            accessibilityHint={t("settings.changeInSystemSettings")}
            style={styles.row}
          >
            <View style={styles.rowCopy}>
              <Text style={styles.rowTitle}>{t("settings.language")}</Text>
              <Text style={styles.rowHint}>
                {t("settings.languageFollowsSystem")}
              </Text>
            </View>
            <Button
              size="xs"
              variant="outline"
              fullWidth={false}
              onPress={() => void Linking.openSettings()}
            >
              {t("settings.changeInSystemSettings")}
            </Button>
          </View>
        </View>

        <SectionHeader title={t("settings.onDevice.title")} />
        <View style={styles.card}>
          <Text style={styles.body}>
            {t("settings.onDevice.description", {
              model: BUNDLED_MODEL.name,
              size: formatBytes(bundledModelStorageBytes()),
            })}
          </Text>
          <View
            testID="on-device-notice"
            style={[
              styles.noticeCard,
              {
                backgroundColor: TONES.safe.surface,
                borderColor: TONES.safe.border,
              },
            ]}
          >
            <Text style={[styles.notice, { color: TONES.safe.ink }]}>
              {t("settings.onDevice.privacyNotice")}
            </Text>
          </View>
          <View style={styles.testRow}>
            <Button
              size="sm"
              variant="outline"
              fullWidth={false}
              disabled={testPhase === "testing"}
              loading={testPhase === "testing"}
              onPress={test}
            >
              {t("settings.onDevice.test")}
            </Button>
            {verdictKey === null ? null : (
              <Text
                accessibilityLiveRegion="polite"
                style={[
                  styles.verdict,
                  testPhase === "passed" && styles.verdictPassed,
                  testPhase === "failed" && styles.verdictFailed,
                ]}
              >
                {t(verdictKey)}
              </Text>
            )}
          </View>
        </View>

        <SectionHeader title={t("settings.about")} />
        <View style={styles.card}>
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
  card: {
    ...cardSurface,
    paddingHorizontal: SPACING.lg,
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: SPACING.md,
    justifyContent: "space-between",
    minHeight: MIN_INTERACTIVE_SIZE,
    paddingVertical: SPACING.md,
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
    color: COLORS.muted,
    fontSize: FONT_SIZE.micro,
    lineHeight: LINE_HEIGHT.tight,
  },
  body: {
    color: COLORS.ink,
    fontSize: FONT_SIZE.bodySm,
    lineHeight: LINE_HEIGHT.body,
    paddingTop: SPACING.md,
  },
  noticeCard: {
    // The shared card surface, repainted by the tone: the tone owns the fill
    // and the border colour, `cardSurface` owns the hairline. The radius is
    // the smallest on the scale — this panel is nested inside a card, so it
    // has to read as the inner shape.
    ...cardSurface,
    borderRadius: RADIUS.xs,
    marginVertical: SPACING.md,
    paddingHorizontal: SPACING.sm,
  },
  notice: {
    fontSize: FONT_SIZE.bodySm,
    lineHeight: LINE_HEIGHT.body,
    paddingVertical: SPACING.sm,
  },
  testRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: SPACING.md,
    paddingBottom: SPACING.md,
  },
  verdict: {
    color: COLORS.muted,
    flex: 1,
    fontSize: FONT_SIZE.bodySm,
    lineHeight: LINE_HEIGHT.body,
  },
  verdictPassed: {
    color: COLORS.brand,
    fontWeight: FONT_WEIGHT.semibold,
  },
  verdictFailed: {
    color: COLORS.danger,
    fontWeight: FONT_WEIGHT.semibold,
  },
});
