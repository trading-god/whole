import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/Button";
import type { ButtonVariant } from "@/components/button-variants";
import { ScreenHeader } from "@/components/ScreenHeader";
import { verifyOnDeviceModel } from "@/features/on-device-model/model-context";
import { COLORS } from "@/theme/colors";
import { cardSurface, screenStyles } from "@/theme/screen-styles";
import { RADIUS } from "@/theme/sizes";
import { SPACING } from "@/theme/spacing";
import { TONES } from "@/theme/tones";
import { FONT_SIZE, FONT_WEIGHT, LINE_HEIGHT } from "@/theme/typography";
import { formatBytes } from "@/features/on-device-model/format-bytes";
import { bundledModelStorageBytes } from "@/features/on-device-model/model-source";
import { BUNDLED_MODEL } from "@/features/on-device-model/on-device-catalog";

// What the settings screen has to say about recognition.
//
// Recognition runs on the bundled model, entirely on this device, so there is
// nothing to configure. What is left is the two things a user can act on: SEE
// what the phone is carrying (which model, how much storage it takes) and TEST
// that it loads and runs, before spending a screenshot finding out.
//
// The Test button owns its own verdict: it lives on the button that earned it,
// expires after a moment (it describes the device as it was), and a test still
// running owns the button until it settles.

// One row per phase: the label to show (`null` while testing — the button is
// chip-sized, so the spinner alone is unambiguous) and the variant that carries
// the verdict. One table rather than two, so a new phase cannot be given a
// label and forgotten a variant.
const TEST_PHASES = {
  idle: { label: "settings.onDevice.test", variant: "outline" },
  testing: { label: null, variant: "outline" },
  passed: { label: "settings.onDevice.testPassed", variant: "primary" },
  failed: { label: "settings.onDevice.testFailed", variant: "danger" },
} as const satisfies Record<
  string,
  { label: string | null; variant: ButtonVariant }
>;

type TestPhase = keyof typeof TEST_PHASES;

// How long a verdict stays on the test button before it goes back to resting.
const TEST_VERDICT_MS = 2500;

export function SettingsScreen() {
  const { t } = useTranslation();

  const [testPhase, setTestPhase] = useState<TestPhase>("idle");
  const [failed, setFailed] = useState(false);

  const verdictTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Loading the model takes seconds, so a test can outlive the screen: the user
  // taps Test and navigates straight back. Both the state updates and the
  // verdict timer are gated on this — without it the `finally` below arms a
  // timer after unmount that nothing will ever clear, and it then calls
  // `setTestPhase` on a component that is gone.
  const isMountedRef = useRef(true);
  useEffect(() => {
    // Set on every run, not just the first: StrictMode mounts, unmounts and
    // mounts again, and a ref left `false` by that first cleanup would skip
    // every branch below for the life of the screen — the Test button would
    // spin forever with no verdict.
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (verdictTimer.current !== null) {
        clearTimeout(verdictTimer.current);
      }
    };
  }, []);

  const test = useCallback(() => {
    setTestPhase("testing");
    setFailed(false);

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
          setFailed(true);
          setTestPhase("failed");
        }
      })
      .finally(() => {
        if (!isMountedRef.current) {
          return;
        }
        if (verdictTimer.current !== null) {
          clearTimeout(verdictTimer.current);
        }
        verdictTimer.current = setTimeout(() => {
          // Only a settled verdict expires. A test started in the meantime
          // owns the button now, and clearing it would blank a spinner
          // mid-flight.
          setTestPhase((current) =>
            current === "passed" || current === "failed" ? "idle" : current,
          );
        }, TEST_VERDICT_MS);
      });
  }, []);

  const { label, variant } = TEST_PHASES[testPhase];

  return (
    <SafeAreaView style={screenStyles.safeArea}>
      <ScreenHeader title={t("settings.title")} />
      <ScrollView
        contentContainerStyle={screenStyles.contentScrollEnd}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.card}>
          <Text style={styles.modelName}>{t("settings.onDevice.title")}</Text>
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
          <Button
            size="sm"
            variant={variant}
            disabled={testPhase === "testing"}
            loading={testPhase === "testing"}
            // While testing the button renders only a spinner, and a button
            // with no text has no name for a screen reader to announce — for
            // the several seconds the model takes to load.
            accessibilityLabel={t(label ?? "settings.onDevice.test")}
            onPress={test}
          >
            {label === null ? null : t(label)}
          </Button>
          {failed ? (
            // Persists past the button's verdict expiry — the reason is
            // information, and the next test owns clearing it.
            <Text style={styles.error}>
              {t("settings.onDevice.testFailure")}
            </Text>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  card: {
    ...cardSurface,
    marginTop: SPACING.md,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
  },
  modelName: {
    fontSize: FONT_SIZE.body,
    fontWeight: FONT_WEIGHT.semibold,
    paddingVertical: SPACING.xs,
  },
  body: {
    fontSize: FONT_SIZE.bodySm,
    lineHeight: LINE_HEIGHT.body,
    paddingVertical: SPACING.xs,
  },
  noticeCard: {
    // The shared card surface, repainted by the tone: the tone owns the fill
    // and the border colour, `cardSurface` owns the hairline. The radius is
    // the smallest on the scale — this panel is nested inside a card, so it
    // has to read as the inner shape.
    ...cardSurface,
    borderRadius: RADIUS.xs,
    marginVertical: SPACING.sm,
    paddingHorizontal: SPACING.sm,
  },
  notice: {
    fontSize: FONT_SIZE.bodySm,
    lineHeight: LINE_HEIGHT.body,
    paddingVertical: SPACING.sm,
  },
  error: {
    color: COLORS.danger,
    fontSize: FONT_SIZE.bodySm,
    fontWeight: FONT_WEIGHT.semibold,
    paddingBottom: SPACING.sm,
  },
});
