import type { LlmFailureKind, StructuredOutputMode } from "@whole/llm";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/Button";
import { ButtonGroup } from "@/components/ButtonGroup";
import { ChoiceChipGroup } from "@/components/ChoiceChipGroup";
import { FieldShell } from "@/components/FieldShell";
import { FormField } from "@/components/FormField";
import { KeyboardAvoidingView } from "@/components/KeyboardAvoidingView";
import { ScreenHeader } from "@/components/ScreenHeader";
import { probeConfiguredEndpoint } from "@/features/assets/model-probe";
import {
  loadProviderConfig,
  recordConsent,
  saveProviderConfig,
} from "@/features/assets/model-provider-store";
import {
  PROVIDER_PRESETS,
  type ProviderDraft,
  activePresetId,
  draftToProviderConfig,
  emptyProviderDraft,
  providerConfigToDraft,
  providerDraftHost,
} from "@/features/assets/provider-draft";
import { useReturnToOverview } from "@/navigation/useReturnToOverview";
import { COLORS } from "@/theme/colors";
import { cardSurface, screenStyles } from "@/theme/screen-styles";
import { SPACING } from "@/theme/spacing";
import { TONES } from "@/theme/tones";
import { FONT_SIZE, FONT_WEIGHT, LINE_HEIGHT } from "@/theme/typography";

// Where the user points Whole at a model.
//
// This screen exists because every "set one up in Settings" the recognition
// path can produce has to land somewhere. It deliberately offers no default
// endpoint: Whole would then be paying for everyone's inference, and "nothing
// leaves your device by default" would stop being true.
//
// THE INTERACTION, stated once because it is easy to get subtly wrong:
//
//   Save is available only when the form is both VALID and CHANGED. Valid
//   alone would offer to re-save a configuration the screen just loaded, and
//   the re-save would re-test an endpoint nobody touched.
//
//   Test is available whenever the form is valid, changed or not — "is my
//   endpoint up right now" is a reasonable question about an unchanged one.
//
//   The two buttons run the SAME probe and report it on THEMSELVES. A shared
//   spinner would have the test button claiming to work when the user pressed
//   Save. What they share is the failure reason, which is information rather
//   than button state.
//
//   Saving tests first unless the user already did, on this exact form. Any
//   edit retires that verdict, because it described a different endpoint.
//
//   Leaving discards. Cancel and the header's back chevron are the same act,
//   and neither warns — Save's availability is the signal that something is
//   unsaved.

// Each button's appearance, by its own phase. Tables rather than a ternary
// chain so a new phase cannot be added without giving it every part — the
// compiler asks for the entry.
const TEST_LABEL = {
  idle: "settings.test",
  // Not rendered: this button is chip-sized and sits beside the field it
  // tests, so the spinner alone is unambiguous — unlike the full-width Save,
  // which names what it is doing. Kept in the table so it stays exhaustive.
  testing: "settings.test",
  passed: "settings.testPassed",
  failed: "settings.testFailed",
} as const;

const TEST_VARIANT = {
  idle: "outline",
  testing: "outline",
  passed: "primary",
  failed: "danger",
} as const;

type TestPhase = keyof typeof TEST_LABEL;
// "testing" and "writing" are separate because they are separate waits, and
// the label is only worth keeping if it says WHICH one the user is in.
type SavePhase = "idle" | "testing" | "writing" | "saved";

const SAVE_LABEL = {
  idle: "settings.save",
  testing: "settings.testingEndpoint",
  writing: "settings.saving",
  saved: "settings.saved",
} as const;

// How long a verdict stays on the test button before it goes back to resting.
// It expires because it describes the endpoint as it was configured a moment
// ago, and a green button over a since-edited form says something untrue.
const TEST_VERDICT_MS = 2500;

export function SettingsScreen() {
  const { t } = useTranslation();
  const returnToOverview = useReturnToOverview();

  const [draft, setDraft] = useState<ProviderDraft>(emptyProviderDraft);
  // What is on disk, so "changed" is a comparison rather than a flag that has
  // to be cleared correctly from every edit path — including an edit that is
  // undone, which a flag would report as still dirty.
  const [saved, setSaved] = useState<ProviderDraft>(emptyProviderDraft);

  // The tier this exact form was verified to support, or null when it has not
  // been. Retired by every edit.
  const [verified, setVerified] = useState<StructuredOutputMode | null>(null);
  // Shared, because it is information rather than button state: whichever
  // button ran the probe, the reason belongs under the field it is about.
  const [failure, setFailure] = useState<LlmFailureKind | null>(null);
  const [writeFailed, setWriteFailed] = useState(false);

  const [testPhase, setTestPhase] = useState<TestPhase>("idle");
  const [savePhase, setSavePhase] = useState<SavePhase>("idle");

  useEffect(() => {
    let stale = false;
    void loadProviderConfig()
      .then((config) => {
        if (stale) {
          return;
        }
        const loaded = providerConfigToDraft(config);
        setDraft(loaded);
        setSaved(loaded);
      })
      // An unreadable settings record reads as "nothing configured", which is
      // what the form already shows — the alternative is an error over a
      // preference the user is about to overwrite anyway.
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, []);

  const config = draftToProviderConfig(draft);
  const { host, isLocal } = providerDraftHost(draft);
  const activePreset = activePresetId(draft);
  const isChanged = (Object.keys(draft) as (keyof ProviderDraft)[]).some(
    (field) => draft[field] !== saved[field],
  );
  // The colour is part of the message. A block saying "this leaves your device"
  // on the same reassuring green as one saying it does not makes the difference
  // something the user has to read rather than see.
  const tone = TONES[isLocal ? "safe" : "caution"];
  const isSaveBusy = savePhase === "testing" || savePhase === "writing";

  const update = useCallback((patch: Partial<ProviderDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    // Every verdict on screen described the endpoint as it was a moment ago.
    setVerified(null);
    setFailure(null);
    setWriteFailed(false);
    setSavePhase("idle");
    setTestPhase("idle");
  }, []);

  // Runs the probe and records what it found. The caller drives its own
  // button's phase, which is what keeps the two decoupled.
  const runProbe =
    useCallback(async (): Promise<StructuredOutputMode | null> => {
      if (!config) {
        return null;
      }
      setFailure(null);

      const result = await probeConfiguredEndpoint(config);
      if (!result.ok) {
        setFailure(result.kind);
        return null;
      }

      setVerified(result.mode);
      return result.mode;
    }, [config]);

  const verdictTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (verdictTimer.current !== null) {
        clearTimeout(verdictTimer.current);
      }
    },
    [],
  );

  const test = useCallback(() => {
    setTestPhase("testing");
    void runProbe().then((mode) => {
      setTestPhase(mode === null ? "failed" : "passed");

      if (verdictTimer.current !== null) {
        clearTimeout(verdictTimer.current);
      }
      verdictTimer.current = setTimeout(() => {
        // Only a settled verdict expires. A test started in the meantime owns
        // the button now, and clearing it would blank a spinner mid-flight.
        setTestPhase((current) =>
          current === "passed" || current === "failed" ? "idle" : current,
        );
      }, TEST_VERDICT_MS);
    });
  }, [runProbe]);

  const save = useCallback(() => {
    if (!config || host === null) {
      return;
    }

    void (async () => {
      setWriteFailed(false);

      let mode = verified;
      if (mode === null) {
        setSavePhase("testing");
        mode = await runProbe();
        if (mode === null) {
          setSavePhase("idle");
          return;
        }
      }

      setSavePhase("writing");

      try {
        // The tier is a property of the ENDPOINT, so it is stored with it.
        await saveProviderConfig({ ...config, structuredOutput: mode });
        await recordConsent(host);
        // Now the form matches disk again, which is what takes Save back out
        // of reach until the next edit.
        setSaved(draft);
        setSavePhase("saved");
      } catch {
        setWriteFailed(true);
        setSavePhase("idle");
      }
    })();
  }, [config, draft, host, runProbe, verified]);

  return (
    <SafeAreaView style={screenStyles.safeArea}>
      <ScreenHeader title={t("settings.title")} />
      <KeyboardAvoidingView style={screenStyles.safeArea}>
        <ScrollView
          contentContainerStyle={screenStyles.contentScrollEnd}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={screenStyles.formHint}>{t("settings.intro")}</Text>

          <View style={styles.card}>
            <FieldShell label={t("settings.presetLabel")}>
              <View style={styles.presets}>
                {PROVIDER_PRESETS.map((preset) => {
                  const isActive = preset.id === activePreset;
                  const label = t(`settings.preset.${preset.id}` as never);
                  return (
                    <Button
                      key={preset.id}
                      size="xs"
                      variant={isActive ? "primary" : "outline"}
                      accessibilityLabel={label}
                      accessibilityState={{ selected: isActive }}
                      onPress={() =>
                        update({ baseUrl: preset.baseUrl, api: preset.api })
                      }
                    >
                      {label}
                    </Button>
                  );
                })}
              </View>
            </FieldShell>

            <FormField
              label={t("settings.baseUrl")}
              accessibilityLabel={t("settings.baseUrl")}
              placeholder={t("settings.baseUrlPlaceholder")}
              value={draft.baseUrl}
              onChangeText={(baseUrl) => update({ baseUrl })}
              autoCapitalize="none"
              keyboardType="url"
              required
              trailing={
                <Button
                  size="xs"
                  variant={TEST_VARIANT[testPhase]}
                  disabled={config === null || testPhase === "testing"}
                  loading={testPhase === "testing"}
                  onPress={test}
                >
                  {testPhase === "testing" ? null : t(TEST_LABEL[testPhase])}
                </Button>
              }
            />
            {failure !== null ? (
              <Text style={styles.error}>
                {t(TEST_FAILURE_KEY[failure] as never)}
              </Text>
            ) : null}

            <FieldShell label={t("settings.protocol")}>
              <ChoiceChipGroup
                options={[
                  {
                    label: t("settings.protocolOpenAi"),
                    value: "openai-chat" as const,
                  },
                  {
                    label: t("settings.protocolAnthropic"),
                    value: "anthropic-messages" as const,
                  },
                ]}
                value={draft.api}
                onChange={(api) => update({ api })}
              />
            </FieldShell>

            <FormField
              label={t("settings.model")}
              accessibilityLabel={t("settings.model")}
              placeholder={t("settings.modelPlaceholder")}
              value={draft.model}
              onChangeText={(model) => update({ model })}
              autoCapitalize="none"
              required
            />

            <FormField
              label={t("settings.apiKey")}
              accessibilityLabel={t("settings.apiKey")}
              placeholder={t("settings.apiKeyPlaceholder")}
              value={draft.apiKey}
              onChangeText={(apiKey) => update({ apiKey })}
              autoCapitalize="none"
            />
          </View>

          {host !== null ? (
            <View
              testID="endpoint-notice"
              style={[
                styles.card,
                { backgroundColor: tone.surface, borderColor: tone.border },
              ]}
            >
              <Text style={[styles.notice, { color: tone.ink }]}>
                {isLocal
                  ? t("settings.localNotice", { host })
                  : t("settings.remoteNotice", { host })}
              </Text>
            </View>
          ) : null}

          {writeFailed ? (
            <Text style={styles.error}>{t("settings.saveFailed")}</Text>
          ) : null}
        </ScrollView>

        {/* Pinned rather than at the end of the scroll: this form is long
            enough that the primary action would otherwise be somewhere the
            user has to go looking for. */}
        <View style={styles.actionBar}>
          <ButtonGroup>
            <Button size="lg" variant="outline" onPress={returnToOverview}>
              {t("settings.cancel")}
            </Button>
            <Button
              size="lg"
              variant="primary"
              accessibilityLabel={t("settings.save")}
              disabled={config === null || !isChanged || isSaveBusy}
              loading={isSaveBusy}
              onPress={save}
            >
              {t(SAVE_LABEL[savePhase])}
            </Button>
          </ButtonGroup>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// One message per cause. A red button says the endpoint did not answer; it
// cannot say whether to retype a key, wait for a quota, or fix the address —
// and under a bring-your-own endpoint the user is the only person who can.
const TEST_FAILURE_KEY: Record<LlmFailureKind, string> = {
  unauthorized: "settings.testUnauthorized",
  "rate-limited": "settings.testRateLimited",
  network: "settings.testNetwork",
  server: "settings.testUnusable",
  malformed: "settings.testUnusable",
};

const styles = StyleSheet.create({
  card: {
    ...cardSurface,
    marginTop: SPACING.md,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
  },
  presets: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: SPACING.sm,
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
  actionBar: {
    backgroundColor: COLORS.background,
    borderTopColor: COLORS.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
  },
});
