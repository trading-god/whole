import { useRouter } from "expo-router";
import {
  type ReactNode,
  memo,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ButtonBase } from "@/components/ButtonBase";
import { FormField } from "@/components/FormField";
import { KeyboardAvoidingView } from "@/components/KeyboardAvoidingView";
import { PrivacyNote } from "@/components/PrivacyNote";
import { ScreenIntro } from "@/components/ScreenIntro";
import { SwipePager, type SwipePagerHandle } from "@/components/SwipePager";
import { useSwipePagerHardwareBack } from "@/components/use-swipe-pager-hardware-back";
import { WizardNav } from "@/components/WizardNav";
import { useCompleteOnboarding } from "@/features/onboarding/onboarding-context";
import { markOnboardingCompleted } from "@/features/onboarding/onboarding-store";
import {
  saveUserName,
  USER_NAME_MAX_LENGTH,
  userNameSchema,
} from "@/features/user/user-store";
import { LlmConfigFields } from "@/features/settings/llm-config-fields";
import {
  hasLlmConfigContent,
  llmConfigSchema,
  saveLlmConfig,
} from "@/features/settings/llm-config-store";
import { COLORS } from "@/theme/colors";
import { MIN_INTERACTIVE_SIZE } from "@/theme/layout";
import { screenStyles } from "@/theme/screen-styles";
import { SPACING } from "@/theme/spacing";
import { FONT_SIZE, FONT_WEIGHT } from "@/theme/typography";

const TOTAL_STEPS = 2;

// Shared chrome for an onboarding step: the scroll surface and the title /
// subtitle block every step opens with, so a step declares only what makes it
// different instead of each repeating the wrapper.
function OnboardingStep({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <ScrollView
      contentContainerStyle={styles.stepContent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <ScreenIntro title={title} subtitle={subtitle} />
      {children}
    </ScrollView>
  );
}

// The two steps are separate memoized components rather than branches of one
// `renderPage` closure: the pager mounts both pages at once, so a closure over
// every field would rebuild both trees on each keystroke. Taking only its own
// values lets the step the user isn't on bail out at the memo boundary.
const NameStep = memo(function NameStep({
  name,
  onNameChange,
}: {
  name: string;
  onNameChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <OnboardingStep
      title={t("onboarding.nameTitle")}
      subtitle={t("onboarding.nameSubtitle")}
    >
      <View style={screenStyles.formCard}>
        <FormField
          autoCapitalize="words"
          label={t("onboarding.nameLabel")}
          maxLength={USER_NAME_MAX_LENGTH}
          placeholder={t("onboarding.namePlaceholder")}
          required
          value={name}
          onChangeText={onNameChange}
        />
      </View>
    </OnboardingStep>
  );
});

const ModelStep = memo(function ModelStep({
  baseUrl,
  apiKey,
  model,
  isInvalid,
  onBaseUrlChange,
  onApiKeyChange,
  onModelChange,
}: {
  baseUrl: string;
  apiKey: string;
  model: string;
  isInvalid: boolean;
  onBaseUrlChange: (value: string) => void;
  onApiKeyChange: (value: string) => void;
  onModelChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <OnboardingStep
      title={t("onboarding.modelTitle")}
      subtitle={t("onboarding.modelSubtitle")}
    >
      <LlmConfigFields
        baseUrl={baseUrl}
        apiKey={apiKey}
        model={model}
        onBaseUrlChange={onBaseUrlChange}
        onApiKeyChange={onApiKeyChange}
        onModelChange={onModelChange}
      />
      <View style={styles.footerHints}>
        <Text style={screenStyles.formHint}>{t("onboarding.modelHint")}</Text>
        {isInvalid ? (
          <Text style={screenStyles.errorHint}>
            {t("onboarding.modelInvalid")}
          </Text>
        ) : null}
        <PrivacyNote message={t("settings.privacy")} />
      </View>
    </OnboardingStep>
  );
});

export default function OnboardingScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const complete = useCompleteOnboarding();

  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [isFinishing, setIsFinishing] = useState(false);
  const pagerRef = useRef<SwipePagerHandle>(null);

  const nameParse = useMemo(() => userNameSchema.safeParse(name), [name]);
  const parsedModel = useMemo(
    () => llmConfigSchema.safeParse({ baseUrl, apiKey, model }),
    [baseUrl, apiKey, model],
  );
  const hasModelContent = hasLlmConfigContent({ baseUrl, apiKey, model });
  // On the model step the user may finish with an empty form (treated as skip)
  // or with a fully valid config — but not a half-filled one.
  const canFinish = !hasModelContent || parsedModel.success;

  const handleNext = () => pagerRef.current?.goTo(1);
  const handleBack = () => pagerRef.current?.goTo(0);

  // The single persistence point for the name: button-driven `goTo` and user
  // swipes both land here via onIndexChange, so leaving step 0 saves exactly
  // once however the user advances — and the name survives even if they later
  // skip the model step. Best-effort: the name is a non-critical preference,
  // so a failed write just falls back to the generic greeting rather than
  // blocking the step transition with an alert.
  const handlePageChange = (nextStep: number) => {
    if (nextStep === 1 && nameParse.success) {
      void saveUserName(nameParse.data).catch(() => {});
    }
    setStep(nextStep);
  };

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
      // Resolved before the try: React Compiler cannot lower a conditional
      // (here the `&&` chain) inside a try/catch and would bail out of the
      // whole component, leaving this screen with no memoization at all.
      const configToSave =
        !skipModel && hasModelContent && parsedModel.success
          ? parsedModel.data
          : null;
      try {
        if (configToSave) {
          await saveLlmConfig(configToSave);
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
  useSwipePagerHardwareBack({ pagerRef, index: step, busy: isFinishing });

  const nextDisabled = step === 0 ? !nameParse.success : !canFinish;
  const nextLabel = step === 0 ? t("onboarding.next") : t("onboarding.finish");
  // Step 0 blocks swiping forward until the name is valid (matching the next
  // button's disabled state); step 1 allows swiping back to step 0 except
  // while a finish/skip is in flight — matching the disabled chevrons and
  // swallowed hardware back, so no navigation path can move the user
  // mid-persist.
  const scrollEnabled = !isFinishing && (step !== 0 || nameParse.success);

  return (
    <SafeAreaView style={screenStyles.safeArea} edges={["top", "bottom"]}>
      <KeyboardAvoidingView style={screenStyles.flex}>
        <View style={styles.header}>
          <Text style={screenStyles.wordmark}>{t("common.wordmark")}</Text>
        </View>

        <SwipePager
          ref={pagerRef}
          count={TOTAL_STEPS}
          initialIndex={0}
          onIndexChange={handlePageChange}
          scrollEnabled={scrollEnabled}
          renderPage={(pageIndex) =>
            pageIndex === 0 ? (
              <NameStep name={name} onNameChange={setName} />
            ) : (
              <ModelStep
                baseUrl={baseUrl}
                apiKey={apiKey}
                model={model}
                isInvalid={!canFinish}
                onBaseUrlChange={setBaseUrl}
                onApiKeyChange={setApiKey}
                onModelChange={setModel}
              />
            )
          }
        />

        <View style={styles.footer}>
          <WizardNav
            count={TOTAL_STEPS}
            current={step}
            backLabel={t("onboarding.back")}
            nextLabel={nextLabel}
            onBack={handleBack}
            onNext={
              step === 0 ? handleNext : () => void completeOnboarding(false)
            }
            backDisabled={isFinishing}
            nextDisabled={nextDisabled}
            nextBusy={isFinishing}
          />
          <View style={styles.skipRow}>
            {step === 1 ? (
              <ButtonBase
                accessibilityLabel={t("onboarding.skip")}
                disabled={isFinishing}
                hitSlop={12}
                onPress={() => void completeOnboarding(true)}
                baseStyle={styles.skipButton}
                pressedStyle={screenStyles.pressed}
              >
                <Text style={styles.skipText}>{t("onboarding.skip")}</Text>
              </ButtonBase>
            ) : null}
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.md,
  },
  // The shared screen content padding plus the extra top inset the onboarding
  // steps sit on (the header above them is a bare wordmark, not a title bar).
  stepContent: {
    ...screenStyles.content,
    paddingTop: SPACING.lg,
  },
  footerHints: {
    gap: SPACING.sm,
    marginTop: SPACING.lg,
  },
  // Horizontal and top padding live on WizardNav; the footer only pads the
  // bottom edge below the skip row.
  footer: {
    paddingBottom: SPACING.md,
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
