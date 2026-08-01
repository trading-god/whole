import Head from "expo-router/head";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/Button";
import { ButtonBase } from "@/components/ButtonBase";
import { ButtonGroup } from "@/components/ButtonGroup";
import { KeyboardAvoidingView } from "@/components/KeyboardAvoidingView";
import { PrivacyNote } from "@/components/PrivacyNote";
import { ScreenHeader } from "@/components/ScreenHeader";
import { testLlmConnection } from "@/features/settings/llm-client";
import { LlmConfigFields } from "@/features/settings/llm-config-fields";
import {
  type LlmConfig,
  clearLlmConfig,
  hasLlmConfigContent,
  llmConfigSchema,
  loadLlmConfig,
  saveLlmConfig,
} from "@/features/settings/llm-config-store";
import { COLORS } from "@/theme/colors";
import { screenStyles } from "@/theme/screen-styles";
import { CHIP_HEIGHT, CHIP_RADIUS, RADIUS } from "@/theme/sizes";
import { SPACING } from "@/theme/spacing";
import { FONT_SIZE, FONT_WEIGHT } from "@/theme/typography";

// How long the test button holds its "Connected"/"Failed" state before
// reverting to idle. Follows the Material 3 snackbar default (~4s), giving
// users enough time to register the result without lingering.
const TEST_RESULT_DISPLAY_MS = 4000;

const TEST_LABEL_KEY = {
  idle: "settings.testConnection",
  testing: "settings.testing",
  success: "settings.testSuccess",
  error: "settings.testFailed",
} as const;

export default function SettingsScreen() {
  const { t } = useTranslation();
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [hasLoadedConfig, setHasLoadedConfig] = useState(false);
  const [isConfigured, setIsConfigured] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  // True while Clear is erasing the config. Clear and Save race on the same
  // storage keys, so Save is disabled (via canSave) during a clear to keep a
  // mid-clear Save from persisting the about-to-be-erased values.
  const [isClearing, setIsClearing] = useState(false);
  const [testState, setTestState] = useState<
    "idle" | "testing" | "success" | "error"
  >("idle");
  // Whether the current form values have passed a connectivity test since
  // the last edit. null = not tested yet, true = passed, false = failed. Held
  // in a ref because it drives only event-handler logic (runTest/save), not
  // render output — a state value would re-render the screen on every test
  // result for nothing.
  const lastTestPassedRef = useRef<boolean | null>(null);
  const testResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Whether the form changed while a connectivity test was in flight. The test
  // result then describes stale values, so runTest must not mark the form as
  // passed — otherwise Save would store unverified values.
  const formEditedDuringTestRef = useRef(false);

  useEffect(() => {
    void loadLlmConfig()
      .then((config) => {
        setBaseUrl(config.baseUrl);
        setApiKey(config.apiKey);
        setModel(config.model);
        setIsConfigured(hasLlmConfigContent(config));
        setHasLoadedConfig(true);
      })
      .catch(() => {
        // Reading the stored config failed (keystore/storage error). Unlock
        // the form so the user can still enter and save values instead of
        // leaving Save permanently disabled on an unhandled rejection.
        setHasLoadedConfig(true);
      });
  }, []);

  const clearTestTimer = useCallback(() => {
    if (testResetTimer.current) {
      clearTimeout(testResetTimer.current);
      testResetTimer.current = null;
    }
  }, []);

  // Clear any pending auto-reset timer if the screen unmounts mid-test.
  useEffect(() => () => clearTestTimer(), [clearTestTimer]);

  const resetTestStatus = () => {
    clearTestTimer();
    setTestState("idle");
  };

  // Show a test result briefly, then return the button to idle on its own.
  const scheduleResetTestStatus = () => {
    clearTestTimer();
    testResetTimer.current = setTimeout(() => {
      testResetTimer.current = null;
      resetTestStatus();
    }, TEST_RESULT_DISPLAY_MS);
  };

  // Reset the test button and result whenever the user edits the form, so a
  // stale "Connected"/"Failed" state and a prior pass don't persist.
  const updateField = (setter: (value: string) => void, value: string) => {
    setter(value);
    if (testState === "testing") {
      // An edit while a test is in flight invalidates its result; flag it so
      // runTest doesn't mark the (now-changed) form as passed when it resolves.
      formEditedDuringTestRef.current = true;
    } else if (testState !== "idle") {
      resetTestStatus();
    }
    if (lastTestPassedRef.current !== null) {
      lastTestPassedRef.current = null;
    }
  };

  const parsedForm = useMemo(
    () => llmConfigSchema.safeParse({ baseUrl, apiKey, model }),
    [baseUrl, apiKey, model],
  );
  const hasContent = hasLlmConfigContent({ baseUrl, apiKey, model });
  // Clear 与 Save 互不依赖：保存中无需禁用 Clear。保存期间两个按钮都通过
  // Button 的 loading 态保持各自外观、仅阻止按压，避免整条底栏灰化闪烁。
  // Save is also disabled while a connectivity test is in flight, so pressing
  // it can't launch a second concurrent test — the in-flight test resolves and
  // sets lastTestPassedRef, after which Save proceeds without re-testing.
  const canSave =
    hasLoadedConfig &&
    parsedForm.success &&
    testState !== "testing" &&
    !isClearing;

  // The test button reflects the latest result inline (idle / testing /
  // connected / failed) instead of rendering a separate status line, which
  // would shift the field height as it appears and disappears.
  const testLabel = t(TEST_LABEL_KEY[testState]);
  const testStateStyle =
    TEST_STATE_STYLES[!parsedForm.success ? "disabled" : testState];
  // 成功/失败态保留结果显示并阻止再次触发，直到自动回到 idle 后才允许重新测试。
  const testDisabled = testState !== "idle" || !parsedForm.success;

  // Runs a connectivity test against the given config, drives the test button
  // state, records whether it passed, and surfaces failures itself — both
  // callers (test button, save) react identically to a failure.
  const runTest = async (values: LlmConfig): Promise<boolean> => {
    formEditedDuringTestRef.current = false;
    // Cancel any pending auto-reset from a prior test so its timer can't fire
    // mid-test and flip testState back to "idle", which would re-enable the
    // button and allow a second concurrent test while this one is still in
    // flight. scheduleResetTestStatus in the finally sets a fresh timer.
    clearTestTimer();
    setTestState("testing");
    try {
      await testLlmConnection(values);
      if (formEditedDuringTestRef.current) {
        // The form changed mid-test, so the result no longer describes the
        // current values. Drop back to idle with no recorded pass so Save
        // re-tests the current values before storing anything.
        resetTestStatus();
        lastTestPassedRef.current = null;
        return false;
      }
      setTestState("success");
      lastTestPassedRef.current = true;
      return true;
    } catch (error) {
      if (formEditedDuringTestRef.current) {
        // The form changed (or was cleared) mid-test, so the error no longer
        // describes the current values. Drop it without alerting, mirroring the
        // success path's discard — otherwise a test that fails while Clear is
        // in flight shows a spurious "Test failed" alert over an empty form.
        resetTestStatus();
        lastTestPassedRef.current = null;
        return false;
      }
      setTestState("error");
      lastTestPassedRef.current = false;
      Alert.alert(
        t("settings.testFailed"),
        error instanceof Error ? error.message : String(error),
      );
      return false;
    } finally {
      scheduleResetTestStatus();
    }
  };

  const save = async () => {
    if (!parsedForm.success) {
      return;
    }

    const values = parsedForm.data;
    setIsSaving(true);

    try {
      // Require a passing connectivity test before saving. If the current
      // form hasn't been tested (or last failed), run one now and abort on
      // failure so an unusable config is never stored.
      if (lastTestPassedRef.current !== true) {
        const ok = await runTest(values);
        if (!ok) {
          return;
        }
      }

      await saveLlmConfig(values);
      setIsConfigured(true);
      Alert.alert(t("settings.saved"));
    } catch {
      Alert.alert(t("settings.saveErrorTitle"), t("settings.saveErrorMessage"));
    } finally {
      setIsSaving(false);
    }
  };

  const confirmClear = () => {
    Alert.alert(
      t("settings.clearConfirmTitle"),
      t("settings.clearConfirmMessage"),
      [
        { style: "cancel", text: t("common.cancel") },
        {
          style: "destructive",
          text: t("settings.clear"),
          onPress: async () => {
            // A connectivity test may still be in flight (testLlmConnection can
            // take up to the request timeout). Clearing the form invalidates its
            // result — flag it so the in-flight test resets on resolve instead of
            // marking the about-to-be-cleared (or later re-typed) form as passed,
            // which would let Save skip re-testing and persist untested values.
            formEditedDuringTestRef.current = true;
            // Disable Clear+Save for the duration: Clear and Save race on the
            // same storage keys, so a Save pressed mid-clear would skip the
            // test gate (lastTestPassedRef not yet cleared) and persist the
            // about-to-be-erased values.
            setIsClearing(true);
            try {
              await clearLlmConfig();
              setBaseUrl("");
              setApiKey("");
              setModel("");
              setIsConfigured(false);
              lastTestPassedRef.current = null;
              resetTestStatus();
            } catch {
              Alert.alert(
                t("settings.clearErrorTitle"),
                t("settings.clearErrorMessage"),
              );
            } finally {
              setIsClearing(false);
            }
          },
        },
      ],
    );
  };

  return (
    <>
      <Head>
        <title>{t("metadata.settingsTitle")}</title>
        <meta name="description" content={t("metadata.settingsDescription")} />
        <meta name="robots" content="noindex,nofollow" />
      </Head>
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView style={styles.flex}>
          <ScreenHeader title={t("settings.screenTitle")} />

          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.intro}>
              <Text style={styles.title}>{t("settings.introTitle")}</Text>
              <Text style={styles.subtitle}>
                {t("settings.introDescription")}
              </Text>
            </View>

            <View
              style={[
                styles.statusChip,
                isConfigured ? styles.statusChipActive : null,
              ]}
            >
              <View
                style={[
                  styles.statusDot,
                  isConfigured
                    ? styles.statusDotActive
                    : styles.statusDotInactive,
                ]}
              />
              <Text
                style={[
                  styles.statusText,
                  isConfigured ? styles.statusTextActive : null,
                ]}
              >
                {isConfigured
                  ? t("settings.statusSaved")
                  : t("settings.statusNotSet")}
              </Text>
            </View>

            <LlmConfigFields
              baseUrl={baseUrl}
              apiKey={apiKey}
              model={model}
              editable={hasLoadedConfig}
              onBaseUrlChange={(value) => updateField(setBaseUrl, value)}
              onApiKeyChange={(value) => updateField(setApiKey, value)}
              onModelChange={(value) => updateField(setModel, value)}
              baseUrlTrailing={
                <ButtonBase
                  accessibilityLabel={testLabel}
                  disabled={testDisabled}
                  hitSlop={8}
                  onPress={() => {
                    if (parsedForm.success) {
                      void runTest(parsedForm.data);
                    }
                  }}
                  baseStyle={[styles.testInlineButton, testStateStyle.button]}
                  pressedStyle={styles.pressed}
                >
                  <Text style={[styles.testInlineText, testStateStyle.text]}>
                    {testLabel}
                  </Text>
                </ButtonBase>
              }
            />

            <PrivacyNote message={t("settings.privacy")} />
          </ScrollView>

          <View style={styles.bottomBar}>
            <ButtonGroup>
              <Button
                size="lg"
                variant="danger"
                disabled={!isConfigured && !hasContent}
                loading={isSaving || isClearing}
                onPress={confirmClear}
              >
                {t("settings.clear")}
              </Button>
              <Button
                size="lg"
                variant="primary"
                elevated
                disabled={!canSave}
                loading={isSaving}
                onPress={() => void save()}
              >
                {isSaving ? t("settings.saving") : t("settings.save")}
              </Button>
            </ButtonGroup>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  ...screenStyles,
  statusChip: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: COLORS.surfaceMuted,
    borderRadius: CHIP_RADIUS,
    flexDirection: "row",
    marginBottom: SPACING.lg,
    // Match the ChoiceChipGroup capsule height (CHIP_HEIGHT) instead of the
    // 48pt button height — a status tag isn't a touch target, so it sits with
    // the rest of the pill/chip family rather than towering over the form.
    minHeight: CHIP_HEIGHT,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  statusChipActive: {
    backgroundColor: COLORS.brandSoft,
  },
  statusDot: {
    borderRadius: 4,
    flexShrink: 0,
    height: 8,
    marginRight: SPACING.sm,
    width: 8,
  },
  statusDotActive: {
    backgroundColor: COLORS.brand,
  },
  statusDotInactive: {
    backgroundColor: COLORS.subtle,
  },
  statusText: {
    color: COLORS.muted,
    flexShrink: 1,
    fontSize: FONT_SIZE.eyebrow,
    fontWeight: FONT_WEIGHT.bold,
  },
  statusTextActive: {
    color: COLORS.brand,
  },
  testInlineButton: {
    alignItems: "center",
    borderRadius: RADIUS.md,
    justifyContent: "center",
    minHeight: 32,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  testInlineButtonIdle: {
    backgroundColor: COLORS.brandSoft,
  },
  testInlineButtonTesting: {
    backgroundColor: COLORS.brandSoft,
    opacity: 0.5,
  },
  testInlineButtonSuccess: {
    backgroundColor: COLORS.brand,
  },
  testInlineButtonError: {
    backgroundColor: COLORS.danger,
  },
  testInlineButtonDisabled: {
    backgroundColor: COLORS.disabledBg,
  },
  testInlineText: {
    fontSize: FONT_SIZE.bodySm,
    fontWeight: FONT_WEIGHT.bold,
  },
  testInlineTextIdle: {
    color: COLORS.brand,
  },
  testInlineTextOnColor: {
    color: COLORS.white,
  },
  testInlineTextDisabled: {
    color: COLORS.disabledText,
  },
});

// 按状态配对的按钮/文字样式。合并在一处而非分散两个表达式，确保任意状态的
// 按钮底色与文字色始终成对变化，新增状态只需改这一处。Hoisted to module scope
// (it only references module-level styles) so it isn't rebuilt every render.
const TEST_STATE_STYLES = {
  idle: {
    button: styles.testInlineButtonIdle,
    text: styles.testInlineTextIdle,
  },
  testing: {
    button: styles.testInlineButtonTesting,
    text: styles.testInlineTextIdle,
  },
  success: {
    button: styles.testInlineButtonSuccess,
    text: styles.testInlineTextOnColor,
  },
  error: {
    button: styles.testInlineButtonError,
    text: styles.testInlineTextOnColor,
  },
  disabled: {
    button: styles.testInlineButtonDisabled,
    text: styles.testInlineTextDisabled,
  },
} as const;
