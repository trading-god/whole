import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/Button";
import { ButtonGroup } from "@/components/ButtonGroup";
import { FormField } from "@/components/FormField";
import { formatBytes } from "@/features/on-device-model/format-bytes";
import {
  type OnDeviceModel,
  type OnDeviceModelId,
  DEFAULT_ON_DEVICE_MODEL,
  ON_DEVICE_MODELS,
} from "@/features/on-device-model/on-device-catalog";
import {
  deleteModel,
  downloadModel,
  modelPresence,
} from "@/features/on-device-model/model-download";
import {
  selectOnDeviceModel,
  verifyOnDeviceModel,
} from "@/features/on-device-model/model-context";
import {
  loadOnDeviceModelId,
  saveOnDeviceModelId,
} from "@/features/on-device-model/on-device-model-store";
import {
  DownloadByteReadout,
  DownloadProgressBar,
} from "@/features/recognition/DownloadProgressBar";
import {
  EngineOptionCard,
  RadioMark,
  RADIO_ROW_INDENT,
} from "@/features/recognition/EngineOptionCard";
import {
  loadRecognitionEngine,
  saveRecognitionEngine,
} from "@/features/recognition/engine-store";
import {
  type RemoteModelConfig,
  normalizeRemoteBaseUrl,
  remoteConfigSchema,
} from "@/features/recognition/remote-config-schema";
import {
  loadRemoteModelConfig,
  saveRemoteModelConfig,
  clearRemoteModelConfig,
} from "@/features/recognition/remote-model-config-store";
import { createRemoteRunModel } from "@/features/recognition/remote-runner";
import { useStoredPreference } from "@/storage/use-stored-preference";
import { COLORS } from "@/theme/colors";
import { PRESSED_OPACITY_SURFACE } from "@/theme/interaction";
import { MIN_INTERACTIVE_SIZE } from "@/theme/layout";
import { screenStyles } from "@/theme/screen-styles";
import { TONES } from "@/theme/tones";
import { RADIUS } from "@/theme/sizes";
import { SPACING } from "@/theme/spacing";
import { FONT_SIZE, FONT_WEIGHT } from "@/theme/typography";

// The recognition engine section: which model answers the annotation turn.
//
// TWO engines behind one choice — the downloaded on-device model, or the
// user's own OpenAI-compatible endpoint — each with its configuration living
// INSIDE its card (radio-card pattern: select to expand, one engine's config
// never crowds the other's). The on-device card holds a second choice of the
// same shape: WHICH model, each row carrying its storage and memory costs so
// the user weighs device fit, not just accuracy.
//
// The section owns no engine state of its own: everything renders from the
// real sources (engine and model preferences in kv-store, model files on
// disk, remote config in SecureStore), so the card and the recognition gate
// cannot disagree.

// The probe phases both engines' Test flows share: idle → testing → a verdict.
type TestPhase = "idle" | "testing" | "passed" | "failed";

// Module-scope so the loader keeps one identity across renders —
// `useStoredPreference`'s hydrate effect is keyed on `[load]`, and an inline
// arrow (a new identity every render) would re-run the storage read on every
// render of the section.
const loadEnginePreference = () => loadRecognitionEngine("on-device");

export function RecognitionEngineSection() {
  const { t } = useTranslation();

  // ── The engine choice ────────────────────────────────────────────────
  // Both preferences hydrate through `useStoredPreference` — the hook's
  // stale-load guard is the whole point (a tap landing before the stored
  // value resolves must not be reverted by it), and this is the fourth and
  // fifth consumer it exists for.
  const [engine, chooseEngine] = useStoredPreference(
    loadEnginePreference,
    "on-device",
    saveRecognitionEngine,
  );

  return (
    <View
      accessibilityLabel={t("settings.engine.title")}
      accessibilityRole="radiogroup"
      style={styles.section}
      testID="recognition-engine-section"
    >
      <EngineOptionCard
        selected={engine === "on-device"}
        title={t("settings.engine.onDevice")}
        hint={t("settings.engine.onDeviceHint")}
        onSelect={() => chooseEngine("on-device")}
        testID="engine-on-device-card"
      >
        <OnDeviceEngineConfig />
      </EngineOptionCard>
      <EngineOptionCard
        selected={engine === "remote"}
        title={t("settings.engine.remote")}
        hint={t("settings.engine.remoteHint")}
        onSelect={() => chooseEngine("remote")}
        testID="engine-remote-card"
      >
        <RemoteEngineConfig />
      </EngineOptionCard>
    </View>
  );
}

// ── The on-device engine's configuration ─────────────────────────────────

function OnDeviceEngineConfig() {
  const { t } = useTranslation();
  // The selected model, from the same store the recognition gate reads.
  const [modelId, setModelId] = useStoredPreference(
    loadOnDeviceModelId,
    DEFAULT_ON_DEVICE_MODEL.id,
    saveOnDeviceModelId,
  );

  // Switching models releases the loaded context (`selectOnDeviceModel`):
  // the E2B context is useless for running E4B, and holding both is exactly
  // the memory crunch the lifecycle exists to avoid — the next completion
  // loads the new weights.
  const chooseModel = (next: OnDeviceModelId) => {
    setModelId(next);
    void selectOnDeviceModel(next).catch(() => {});
  };

  return (
    <View
      accessibilityLabel={t("settings.engine.modelChoice")}
      accessibilityRole="radiogroup"
      style={styles.configStack}
    >
      {ON_DEVICE_MODELS.map((model) => (
        <ModelRow
          key={model.id}
          model={model}
          selected={modelId === model.id}
          onSelect={() => chooseModel(model.id)}
        />
      ))}
    </View>
  );
}

// One model row: radio select + the cost lines + the download lifecycle.
//
// Costs are stated in the row itself — storage (the download's bill) and
// memory (the running bill) — because the user weighing E2B vs E4B on a
// mid-range phone is weighing exactly these two numbers, and the model's
// accuracy edge is useless advice to someone whose device cannot hold it.
function ModelRow({
  model,
  selected,
  onSelect,
}: {
  model: OnDeviceModel;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  const modelCosts = t("settings.engine.modelCosts", {
    size: formatBytes(model.sizeBytes),
    ram: formatBytes(model.ramBytes),
  });

  const [presence, setPresence] = useState(() => modelPresence(model.id));
  const refreshPresence = useCallback(() => {
    setPresence(modelPresence(model.id));
  }, [model.id]);

  const [downloadPhase, setDownloadPhase] = useState<
    "idle" | "downloading" | "failed"
  >("idle");
  const [downloadFraction, setDownloadFraction] = useState(0);

  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const startDownload = useCallback(() => {
    setDownloadPhase("downloading");
    // From zero: a retry replaces the partial file rather than resuming it,
    // so seeding the bar from the leftover bytes would show progress the
    // restart is about to throw away.
    setDownloadFraction(0);
    void downloadModel(model.id, (fraction) => {
      if (isMountedRef.current) {
        setDownloadFraction(fraction);
      }
    })
      .then(() => {
        if (isMountedRef.current) {
          setDownloadPhase("idle");
          refreshPresence();
        }
      })
      .catch(() => {
        // The technical reason stays out of the UI — localized copy only
        // (AGENTS.md), and the recovery does not depend on which byte range
        // failed: retry the download.
        if (isMountedRef.current) {
          setDownloadPhase("failed");
          refreshPresence();
        }
      });
  }, [model.id, refreshPresence]);

  const deleteWeights = useCallback(() => {
    deleteModel(model.id);
    refreshPresence();
  }, [model.id, refreshPresence]);

  // One row head, three bodies. The radio head is identical across the
  // download lifecycle (absent → downloading → present), so it renders once
  // here and only the body below it switches — an accessibility or layout
  // change to the head then can't drift between states.
  let body: ReactNode;
  if (downloadPhase === "downloading") {
    body = (
      <View style={styles.progressStack}>
        <DownloadProgressBar fraction={downloadFraction} />
        <DownloadByteReadout
          sizeBytes={Math.round(downloadFraction * model.sizeBytes)}
          totalBytes={model.sizeBytes}
        />
        <Text style={styles.hint}>{t("settings.engine.downloading")}</Text>
      </View>
    );
  } else if (presence.status === "present") {
    body = (
      <>
        <Text style={styles.costLine}>{modelCosts}</Text>
        {selected ? (
          <ButtonGroup style={styles.modelActions}>
            <ModelTestButton />
            <Button size="sm" variant="dangerGhost" onPress={deleteWeights}>
              {t("settings.engine.deleteModel")}
            </Button>
          </ButtonGroup>
        ) : null}
      </>
    );
  } else {
    // Absent or partial: the download offer, with what it costs stated up
    // front. A failed pass re-offers the download, which starts over from the
    // beginning — the downloader replaces whatever partial file is there.
    body = (
      <>
        <Text style={styles.costLine}>{modelCosts}</Text>
        {downloadPhase === "failed" ? (
          <Text style={styles.downloadError}>
            {t("settings.engine.downloadFailed")}
          </Text>
        ) : null}
        <Button
          accessibilityHint={t("settings.engine.downloadHint", {
            model: model.name,
            size: formatBytes(model.sizeBytes),
          })}
          size="sm"
          variant="primary"
          onPress={startDownload}
        >
          {t("settings.engine.download")}
        </Button>
      </>
    );
  }

  // A download of the unselected model still matters — the row keeps its own
  // lifecycle regardless of selection.
  return (
    <View style={styles.modelRow} testID={`model-row-${model.id}`}>
      <PressableRow
        selected={selected}
        onSelect={onSelect}
        name={model.name}
        hint={modelCosts}
      />
      {body}
    </View>
  );
}

// The select-able head of a model row: the radio and the name. Pressing it
// selects the model; the download lifecycle below it is NOT part of the
// target, so tapping Download does not also flip the selection.
function PressableRow({
  selected,
  onSelect,
  name,
  hint,
}: {
  selected: boolean;
  onSelect: () => void;
  name: string;
  hint: string;
}) {
  return (
    <Pressable
      accessibilityLabel={name}
      accessibilityHint={hint}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onSelect}
      style={({ pressed }) => [
        styles.modelSelectRow,
        pressed && styles.pressed,
      ]}
    >
      <RadioMark selected={selected} />
      <Text style={styles.modelName}>{name}</Text>
    </Pressable>
  );
}

// The Test button for the SELECTED model — the context it probes is the
// one bound to the current model id, so only the selected row offers it.
function ModelTestButton() {
  const { t } = useTranslation();
  const [testPhase, setTestPhase] = useState<TestPhase>("idle");
  const isMountedRef = useRef(true);
  useEffect(() => {
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
        if (isMountedRef.current) {
          setTestPhase("failed");
        }
      });
  }, []);

  return (
    <View style={styles.testRow}>
      <Button
        size="sm"
        variant="outline"
        fullWidth={false}
        loading={testPhase === "testing"}
        onPress={test}
      >
        {t("settings.onDevice.test")}
      </Button>
      {testPhase === "passed" ? (
        // Announced, not just shown: the verdict is the answer to the tap, and
        // the deleted SettingsScreen verdict carried the live region — losing
        // it in the move silenced the outcome for screen-reader users.
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.verdict, styles.verdictPassed]}
        >
          {t("settings.onDevice.testPassed")}
        </Text>
      ) : null}
      {testPhase === "failed" ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.verdict, styles.verdictFailed]}
        >
          {t("settings.onDevice.testFailure")}
        </Text>
      ) : null}
    </View>
  );
}

// ── The remote engine's configuration ───────────────────────────────────

function RemoteEngineConfig() {
  const { t } = useTranslation();

  // The saved config hydrates the form; `apiKey` stays masked — the stored
  // key is never re-rendered, only replaced.
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [hasSavedConfig, setHasSavedConfig] = useState(false);
  const [testPhase, setTestPhase] = useState<TestPhase>("idle");
  // One enum, in the same shape as `downloadPhase` and `TestPhase`, instead
  // of a phase + a failed flag whose "clearing AND failed" combination is
  // meaningless.
  const [clearPhase, setClearPhase] = useState<"idle" | "clearing" | "failed">(
    "idle",
  );
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let stale = false;
    void loadRemoteModelConfig()
      .then((config) => {
        if (stale || config === null) {
          return;
        }
        // Fill only what the user has not already replaced: the cold-start
        // read can resolve after they started typing (the kv-store opens its
        // database and runs the legacy migration scan first), and overwriting
        // their draft would throw away keystrokes for values they
        // deliberately changed.
        setBaseUrl((current) => (current === "" ? config.baseUrl : current));
        setModel((current) => (current === "" ? config.model : current));
        setHasSavedConfig(true);
      })
      .catch(() => {
        // A read that failed leaves the empty form: the user can still type
        // and save, which is a fresh write. Nothing here can act on the
        // failure — the same discipline `useStoredPreference`'s callers apply.
      });
    return () => {
      stale = true;
    };
  }, []);

  // Validity from the SAME schema the runner loads through — one definition
  // of "a usable config", shared by the form and the runtime.
  const draft: RemoteModelConfig = useMemo(
    () => ({ baseUrl: normalizeRemoteBaseUrl(baseUrl), model: model.trim() }),
    [baseUrl, model],
  );
  const draftValid = remoteConfigSchema.safeParse(draft).success;
  const isTesting = testPhase === "testing";
  const isClearing = clearPhase === "clearing";

  const clear = useCallback(() => {
    setClearPhase("clearing");
    void clearRemoteModelConfig()
      .then(() => {
        if (isMountedRef.current) {
          setBaseUrl("");
          setModel("");
          setApiKey("");
          setHasSavedConfig(false);
          setTestPhase("idle");
          setClearPhase("idle");
        }
      })
      .catch(() => {
        // A removal that failed leaves the form as it was — the config is
        // still stored, and showing it as cleared would hide a live
        // credential behind a "removed" control. The hint says both halves:
        // the removal failed AND the service is still saved.
        if (isMountedRef.current) {
          setClearPhase("failed");
        }
      });
  }, []);

  const test = useCallback(() => {
    // The test runs what the runner would run, against what is SAVED — save
    // first, then test, is the only honest order.
    setTestPhase("testing");
    // A fresh save supersedes any earlier failed removal: a stale "couldn't
    // remove" note beside a passing save would tell the user a problem they
    // abandoned is still the current one.
    setClearPhase("idle");
    void saveRemoteModelConfig(draft, apiKey === "" ? null : apiKey)
      .then(() => {
        if (isMountedRef.current) {
          // The config is stored the moment the save resolves; the ping that
          // follows only verifies it. A failed ping must not hide the
          // Remove-service control (or the "key already saved" hint) for a
          // config that IS there — the recognition gate reads the stored
          // config, not the ping verdict.
          setHasSavedConfig(true);
        }
        return createRemoteRunModel();
      })
      .then(async (runModel) => {
        if (runModel === null) {
          throw new Error("no config");
        }
        // A one-token completion: proves reachability, auth, and the model
        // name in one round trip.
        await runModel({ system: "ping", user: "ping", grammar: "" });
        if (isMountedRef.current) {
          setTestPhase("passed");
        }
      })
      .catch(() => {
        if (isMountedRef.current) {
          setTestPhase("failed");
        }
      });
  }, [draft, apiKey]);

  return (
    <View style={styles.configStack}>
      <FormField
        label={t("settings.engine.baseUrl")}
        hint={t("settings.engine.baseUrlHint")}
        placeholder="https://"
        value={baseUrl}
        onChangeText={setBaseUrl}
        autoCapitalize="none"
      />
      <FormField
        label={t("settings.engine.model")}
        hint={t("settings.engine.modelHint")}
        placeholder="deepseek-chat"
        value={model}
        onChangeText={setModel}
        autoCapitalize="none"
      />
      <FormField
        label={t("settings.engine.apiKey")}
        hint={t("settings.engine.apiKeyHint")}
        placeholder="sk-…"
        value={apiKey}
        onChangeText={setApiKey}
        autoCapitalize="none"
        autoComplete="off"
        textContentType="password"
        secureTextEntry
      />
      <View style={styles.testRow}>
        <Button
          size="sm"
          variant={draftValid ? "primary" : "secondary"}
          fullWidth={false}
          disabled={!draftValid || isClearing}
          loading={isTesting}
          onPress={test}
        >
          {t("settings.engine.save")}
        </Button>
        {testPhase === "passed" ? (
          <Text
            accessibilityLiveRegion="polite"
            style={[styles.verdict, styles.verdictPassed]}
          >
            {t("settings.engine.testPassed")}
          </Text>
        ) : null}
        {testPhase === "failed" ? (
          <Text
            accessibilityLiveRegion="polite"
            style={[styles.verdict, styles.verdictFailed]}
          >
            {t("settings.engine.testFailure")}
          </Text>
        ) : null}
      </View>
      {hasSavedConfig ? (
        <View style={styles.clearStack}>
          <Button
            size="sm"
            variant="dangerGhost"
            fullWidth={false}
            disabled={isTesting}
            loading={isClearing}
            onPress={clear}
          >
            {t("settings.engine.clear")}
          </Button>
          {clearPhase === "failed" ? (
            <Text
              accessibilityLiveRegion="polite"
              style={styles.clearFailedHint}
            >
              {t("settings.engine.clearFailed")}
            </Text>
          ) : null}
        </View>
      ) : null}
      <View
        style={[
          styles.noticeCard,
          {
            backgroundColor: TONES.caution.surface,
            borderColor: TONES.caution.border,
          },
        ]}
      >
        <Text style={[styles.notice, { color: TONES.caution.ink }]}>
          {t("settings.engine.remotePrivacy")}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: SPACING.md,
  },
  configStack: {
    gap: SPACING.md,
  },
  modelRow: {
    gap: SPACING.sm,
  },
  progressStack: {
    gap: SPACING.sm,
    paddingLeft: RADIO_ROW_INDENT,
  },
  modelSelectRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: SPACING.md,
    minHeight: MIN_INTERACTIVE_SIZE,
  },
  pressed: {
    opacity: PRESSED_OPACITY_SURFACE,
  },
  modelName: {
    color: COLORS.ink,
    fontSize: FONT_SIZE.bodySm,
    fontWeight: FONT_WEIGHT.semibold,
  },
  costLine: {
    ...screenStyles.metaLine,
    paddingLeft: RADIO_ROW_INDENT,
  },
  hint: {
    ...screenStyles.metaLine,
  },
  downloadError: {
    ...screenStyles.metaLineDanger,
  },
  modelActions: {
    paddingLeft: RADIO_ROW_INDENT,
  },
  testRow: {
    alignItems: "center",
    flexDirection: "row",
    flex: 1,
    flexWrap: "wrap",
    gap: SPACING.md,
  },
  verdict: {
    ...screenStyles.metaLine,
    flex: 1,
  },
  verdictPassed: {
    color: COLORS.brand,
    fontWeight: FONT_WEIGHT.semibold,
  },
  verdictFailed: {
    color: COLORS.danger,
    fontWeight: FONT_WEIGHT.semibold,
  },
  noticeCard: {
    borderRadius: RADIUS.xs,
    borderWidth: 1,
    marginTop: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.sm,
  },
  notice: {
    // Same type as `metaLine`; the colour arrives inline from the caution
    // tone (see the style prop), so the ink matches the card it sits in.
    ...screenStyles.metaLine,
  },
  clearStack: {
    alignItems: "flex-start",
  },
  // Anchored to the Remove action it explains, in the shared error-hint voice.
  clearFailedHint: {
    ...screenStyles.metaLineDanger,
    marginTop: SPACING.xs,
  },
});
