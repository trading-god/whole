import Head from "expo-router/head";
import { useRouter } from "expo-router";
import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Animated, {
  SlideInLeft,
  SlideInRight,
  SlideOutLeft,
  SlideOutRight,
} from "react-native-reanimated";

import { FormField } from "@/components/FormField";
import { IconButton } from "@/components/IconButton";
import { KeyboardAvoidingView } from "@/components/KeyboardAvoidingView";
import { PrivacyNote } from "@/components/PrivacyNote";
import { StepIndicator } from "@/components/StepIndicator";
import { useCompleteOnboarding } from "@/features/onboarding/onboarding-context";
import {
  markOnboardingCompleted,
  saveUserName,
  userNameSchema,
} from "@/features/onboarding/onboarding-store";
import { LlmConfigFields } from "@/features/settings/llm-config-fields";
import {
  hasLlmConfigContent,
  llmConfigSchema,
  saveLlmConfig,
} from "@/features/settings/llm-config-store";
import { COLORS } from "@/theme/colors";
import { MIN_INTERACTIVE_SIZE } from "@/theme/layout";
import { screenStyles } from "@/theme/screen-styles";
import { ICON_BUTTON_SIZES } from "@/theme/sizes";
import { SPACING } from "@/theme/spacing";
import { FONT_SIZE, FONT_WEIGHT } from "@/theme/typography";

const TOTAL_STEPS = 2;

// Step content slides via Reanimated layout animations: changing `step`
// remounts the Animated.View (key={step}), so the outgoing step slides out
// while the incoming one slides in. `direction` is set one render before the
// step changes so the exiting view picks up the correct SlideOut direction.
// No manual shared-value mutation, which keeps the React Compiler's
// immutability rule happy.
const STEP_SLIDE_MS = 280;

type StepDirection = "forward" | "back";

export default function OnboardingScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const complete = useCompleteOnboarding();

  const [step, setStep] = useState(0);
  // Travel direction of the current transition. `setDirection` runs as an
  // urgent update and `setStep` inside startTransition renders after it, so the
  // outgoing view re-renders with the new direction before it unmounts — its
  // SlideOut then matches the incoming SlideIn's direction.
  const [direction, setDirection] = useState<StepDirection>("forward");
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [isFinishing, setIsFinishing] = useState(false);

  const nameParse = useMemo(() => userNameSchema.safeParse(name), [name]);
  const parsedModel = useMemo(
    () => llmConfigSchema.safeParse({ baseUrl, apiKey, model }),
    [baseUrl, apiKey, model],
  );
  const hasModelContent = hasLlmConfigContent({ baseUrl, apiKey, model });
  // On the model step the user may finish with an empty form (treated as skip)
  // or with a fully valid config — but not a half-filled one.
  const canFinish = !hasModelContent || parsedModel.success;

  const handleNext = useCallback(() => {
    if (!nameParse.success) {
      return;
    }
    // Persist the name as the user leaves step 0, so it survives even if they
    // later skip the model step.
    void saveUserName(nameParse.data).catch(() => {});
    setDirection("forward");
    startTransition(() => {
      setStep(1);
    });
  }, [nameParse]);

  const handleBack = useCallback(() => {
    setDirection("back");
    startTransition(() => {
      setStep(0);
    });
  }, []);

  // Finish and Skip share everything but the optional LLM-config save. Both
  // guard against a double-finish, persist the completion marker BEFORE
  // flipping the gate (so a write failure is surfaced as an alert + stays to
  // retry rather than silently leaving the flag unset and re-onboarding the
  // user next launch), then complete + replace to home.
  const completeOnboarding = useCallback(
    async (skipModel: boolean) => {
      if (isFinishing) {
        return;
      }
      setIsFinishing(true);
      try {
        if (!skipModel && hasModelContent && parsedModel.success) {
          await saveLlmConfig(parsedModel.data);
        }
        await markOnboardingCompleted();
        complete();
        router.replace("/");
      } catch {
        Alert.alert(
          t("onboarding.completionErrorTitle"),
          t("onboarding.completionErrorMessage"),
        );
        setIsFinishing(false);
      }
    },
    [isFinishing, hasModelContent, parsedModel, complete, router, t],
  );

  // Android hardware back: on step 1, return to step 0 (matching the visible
  // back chevron) instead of exiting the app — /onboarding is the only route in
  // the stack (the gate replace'd onto it), so the default back has nowhere to
  // pop to. On step 0 the default (exit) is acceptable: reopening re-routes
  // through the gate back to onboarding.
  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        // Swallow back while a finish/skip is in flight so the hardware button
        // matches the disabled back chevron — a mid-await back would otherwise
        // move to step 0 and, if the persist then fails, leave the user on the
        // wrong step.
        if (isFinishing) {
          return true;
        }
        if (step === 1) {
          handleBack();
          return true;
        }
        return false;
      },
    );
    return () => subscription.remove();
  }, [step, isFinishing, handleBack]);

  const nextDisabled = step === 0 ? !nameParse.success : !canFinish;
  const nextLabel = step === 0 ? t("onboarding.next") : t("onboarding.finish");

  // Forward: outgoing slides out left, incoming slides in from the right.
  // Back: outgoing slides out right, incoming slides in from the left. Memoized
  // on `direction` so a keystroke (which re-renders but doesn't change direction)
  // doesn't rebuild the animation builders — Reanimated only consumes them on
  // mount/unmount of the keyed view.
  const entering = useMemo(
    () =>
      (direction === "forward" ? SlideInRight : SlideInLeft).duration(
        STEP_SLIDE_MS,
      ),
    [direction],
  );
  const exiting = useMemo(
    () =>
      (direction === "forward" ? SlideOutLeft : SlideOutRight).duration(
        STEP_SLIDE_MS,
      ),
    [direction],
  );

  return (
    <>
      <Head>
        <title>{t("metadata.onboardingTitle")}</title>
        <meta
          name="description"
          content={t("metadata.onboardingDescription")}
        />
        <meta name="robots" content="noindex,nofollow" />
      </Head>
      <SafeAreaView style={screenStyles.safeArea} edges={["top", "bottom"]}>
        <KeyboardAvoidingView style={screenStyles.flex}>
          <View style={styles.header}>
            <Text style={screenStyles.wordmark}>{t("common.wordmark")}</Text>
          </View>

          <ScrollView
            contentContainerStyle={[
              screenStyles.content,
              { paddingTop: SPACING.lg },
            ]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            style={screenStyles.flex}
          >
            <Animated.View key={step} entering={entering} exiting={exiting}>
              <View style={screenStyles.intro}>
                <Text style={screenStyles.title}>
                  {step === 0
                    ? t("onboarding.nameTitle")
                    : t("onboarding.modelTitle")}
                </Text>
                <Text style={screenStyles.subtitle}>
                  {step === 0
                    ? t("onboarding.nameSubtitle")
                    : t("onboarding.modelSubtitle")}
                </Text>
              </View>

              {step === 0 ? (
                <View style={screenStyles.formCard}>
                  <FormField
                    autoCapitalize="words"
                    label={t("onboarding.nameLabel")}
                    maxLength={30}
                    placeholder={t("onboarding.namePlaceholder")}
                    required
                    value={name}
                    onChangeText={setName}
                  />
                </View>
              ) : (
                <LlmConfigFields
                  baseUrl={baseUrl}
                  apiKey={apiKey}
                  model={model}
                  onBaseUrlChange={setBaseUrl}
                  onApiKeyChange={setApiKey}
                  onModelChange={setModel}
                />
              )}

              {step === 1 ? (
                <View style={styles.footerHints}>
                  <Text style={screenStyles.formHint}>
                    {t("onboarding.modelHint")}
                  </Text>
                  {hasModelContent && !parsedModel.success ? (
                    <Text style={styles.errorHint}>
                      {t("onboarding.modelInvalid")}
                    </Text>
                  ) : null}
                  <PrivacyNote message={t("settings.privacy")} />
                </View>
              ) : null}
            </Animated.View>
          </ScrollView>

          <View style={styles.footer}>
            <View style={styles.navRow}>
              <View style={styles.navSide}>
                {step === 1 ? (
                  <IconButton
                    accessibilityLabel={t("onboarding.back")}
                    disabled={isFinishing}
                    name="chevron-left"
                    size="md"
                    variant="outline"
                    onPress={handleBack}
                  />
                ) : null}
              </View>
              <StepIndicator count={TOTAL_STEPS} current={step} />
              <View style={styles.navSide}>
                {isFinishing ? (
                  <ActivityIndicator color={COLORS.brand} size="small" />
                ) : (
                  <IconButton
                    accessibilityLabel={nextLabel}
                    disabled={nextDisabled}
                    elevated
                    name="chevron-right"
                    size="md"
                    variant="primary"
                    onPress={
                      step === 0
                        ? handleNext
                        : () => void completeOnboarding(false)
                    }
                  />
                )}
              </View>
            </View>
            <View style={styles.skipRow}>
              {step === 1 ? (
                <Pressable
                  accessibilityLabel={t("onboarding.skip")}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: isFinishing }}
                  disabled={isFinishing}
                  hitSlop={12}
                  onPress={() => void completeOnboarding(true)}
                  style={styles.skipButton}
                >
                  <Text style={styles.skipText}>{t("onboarding.skip")}</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.md,
  },
  footerHints: {
    gap: SPACING.sm,
    marginTop: SPACING.lg,
  },
  errorHint: {
    color: COLORS.danger,
    fontSize: FONT_SIZE.micro,
    fontWeight: FONT_WEIGHT.semibold,
  },
  footer: {
    paddingBottom: SPACING.md,
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.sm,
  },
  navRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  // Fixed-width sides match the md IconButton so the indicator stays centered
  // whether or not the back arrow is rendered (step 0 has none).
  navSide: {
    alignItems: "center",
    height: ICON_BUTTON_SIZES.md,
    justifyContent: "center",
    width: ICON_BUTTON_SIZES.md,
  },
  skipRow: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: MIN_INTERACTIVE_SIZE,
    marginTop: SPACING.xs,
  },
  skipButton: {
    minHeight: MIN_INTERACTIVE_SIZE,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.xs,
  },
  skipText: {
    color: COLORS.muted,
    fontSize: FONT_SIZE.bodySm,
    fontWeight: FONT_WEIGHT.semibold,
  },
});
