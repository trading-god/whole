import { useRouter } from "expo-router";
import { type ReactNode, memo, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/Button";
import { FormField } from "@/components/FormField";
import { KeyboardAvoidingView } from "@/components/KeyboardAvoidingView";
import { ScreenIntro } from "@/components/ScreenIntro";
import { useCompleteOnboarding } from "@/features/onboarding/onboarding-context";
import { markOnboardingCompleted } from "@/features/onboarding/onboarding-store";
import {
  saveUserName,
  USER_NAME_MAX_LENGTH,
  userNameSchema,
} from "@/features/user/user-store";
import { screenStyles } from "@/theme/screen-styles";
import { SPACING } from "@/theme/spacing";

// Shared chrome for the onboarding form: the scroll surface and the title /
// subtitle block every step opens with, so the step declares only what makes
// it different instead of each repeating the wrapper.
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

export default function OnboardingScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const complete = useCompleteOnboarding();

  const [name, setName] = useState("");
  const [isFinishing, setIsFinishing] = useState(false);

  const nameParse = useMemo(() => userNameSchema.safeParse(name), [name]);

  // Finish persists the name and the completion marker, then flips the gate
  // and replaces to home. Persisting the marker BEFORE flipping the gate
  // surfaces a write failure as an alert + stays to retry rather than silently
  // leaving the flag unset and re-onboarding the user next launch. The name is
  // best-effort: a failed write just falls back to the generic greeting.
  const completeOnboarding = useCallback(async () => {
    if (isFinishing) {
      return;
    }
    setIsFinishing(true);
    try {
      if (nameParse.success) {
        await saveUserName(nameParse.data).catch(() => {});
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
  }, [isFinishing, nameParse, complete, router, t]);

  return (
    <SafeAreaView style={screenStyles.safeArea} edges={["top", "bottom"]}>
      <KeyboardAvoidingView style={screenStyles.flex}>
        <View style={styles.header}>
          <Text style={screenStyles.wordmark}>{t("common.wordmark")}</Text>
        </View>

        <NameStep name={name} onNameChange={setName} />

        <View style={styles.footer}>
          <Button
            size="lg"
            variant="primary"
            elevated
            disabled={!nameParse.success}
            loading={isFinishing}
            onPress={() => void completeOnboarding()}
          >
            {t("onboarding.finish")}
          </Button>
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
  // form sits on (the header above it is a bare wordmark, not a title bar).
  stepContent: {
    ...screenStyles.content,
    paddingTop: SPACING.lg,
  },
  // The button carries its own 48pt touch target, so the footer only pads the
  // bottom edge below the scroll surface.
  footer: {
    paddingBottom: SPACING.md,
    paddingHorizontal: SPACING.xl,
  },
});
