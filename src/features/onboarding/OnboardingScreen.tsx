import { useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
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
import { RADIUS } from "@/theme/sizes";
import { SPACING } from "@/theme/spacing";
import { TONES } from "@/theme/tones";
import { FONT_SIZE, LINE_HEIGHT } from "@/theme/typography";

// The first screen a new user sees. It says what the app does and where the
// data stays before it asks for anything — the privacy promise is the reason
// to trust the app with a bank screenshot, so it comes before the screenshot.
// The name is optional: the greeting falls back to a plain hello, and a
// required field on a welcome screen is a gate with nothing behind it.
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

        <ScrollView
          contentContainerStyle={styles.stepContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <ScreenIntro
            title={t("onboarding.nameTitle")}
            subtitle={t("onboarding.nameSubtitle")}
          />
          <View
            testID="onboarding-privacy"
            style={[
              styles.privacyCard,
              {
                backgroundColor: TONES.safe.surface,
                borderColor: TONES.safe.border,
              },
            ]}
          >
            <Text style={[styles.privacyText, { color: TONES.safe.ink }]}>
              {t("onboarding.privacyNote")}
            </Text>
          </View>
          <View style={screenStyles.formCard}>
            <FormField
              autoCapitalize="words"
              label={t("onboarding.nameLabel")}
              maxLength={USER_NAME_MAX_LENGTH}
              placeholder={t("onboarding.namePlaceholder")}
              value={name}
              onChangeText={setName}
            />
            <Text style={styles.nameHint}>{t("onboarding.nameHint")}</Text>
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <Button
            size="lg"
            variant="primary"
            elevated
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
  privacyCard: {
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    marginBottom: SPACING.lg,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
  },
  privacyText: {
    fontSize: FONT_SIZE.bodySm,
    lineHeight: LINE_HEIGHT.body,
  },
  nameHint: {
    ...screenStyles.fieldHint,
    marginTop: 0,
    paddingBottom: SPACING.md,
  },
  // The button carries its own 48pt touch target, so the footer only pads the
  // bottom edge below the scroll surface.
  footer: {
    paddingBottom: SPACING.md,
    paddingHorizontal: SPACING.xl,
  },
});
