import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/Button";
import { FormField } from "@/components/FormField";
import { formatBytes } from "@/features/on-device-model/format-bytes";
import {
  type OnDeviceModel,
  type OnDeviceModelId,
  ON_DEVICE_MODELS,
} from "@/features/on-device-model/on-device-catalog";
import {
  deleteModel,
  downloadModel,
  modelPresence,
} from "@/features/on-device-model/model-download";
import { verifyOnDeviceModel } from "@/features/on-device-model/model-context";
import {
  loadOnDeviceModelId,
  saveOnDeviceModelId,
} from "@/features/on-device-model/on-device-model-store";
import {
  DownloadByteReadout,
  DownloadProgressBar,
} from "@/features/recognition/DownloadProgressBar";
import { EngineOptionCard } from "@/features/recognition/EngineOptionCard";
import {
  type RecognitionEngine,
  loadRecognitionEngine,
  saveRecognitionEngine,
} from "@/features/recognition/engine-store";
import {
  type RemoteModelConfig,
  loadRemoteModelConfig,
  normalizeRemoteBaseUrl,
  remoteConfigSchema,
  saveRemoteModelConfig,
  clearRemoteModelConfig,
} from "@/features/recognition/remote-model-config-store";
import { createRemoteRunModel } from "@/features/recognition/remote-runner";
import { COLORS } from "@/theme/colors";
import { PRESSED_OPACITY_SURFACE } from "@/theme/interaction";
import { TONES } from "@/theme/tones";
import { RADIUS } from "@/theme/sizes";
import { SPACING } from "@/theme/spacing";
import { FONT_SIZE, LINE_HEIGHT } from "@/theme/typography";

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

type RemoteTestPhase = "idle" | "testing" | "passed" | "failed";

export function RecognitionEngineSection() {
  const { t } = useTranslation();

  // ── The engine choice ────────────────────────────────────────────────
  const [engine, setEngine] = useState<RecognitionEngine>("on-device");
  useEffect(() => {
    let stale = false;
    void loadRecognitionEngine("on-device").then((stored) => {
      if (!stale) {
        setEngine(stored);
      }
    });
    return () => {
      stale = true;
    };
  }, []);
  const chooseEngine = useCallback((next: RecognitionEngine) => {
    setEngine(next);
    void saveRecognitionEngine(next).catch(() => {});
  }, []);

  return (
    <View style={styles.section} testID="recognition-engine-section">
      <EngineOptionCard
        selected={engine === "on-device"}
        title={t("settings.engine.onDevice")}
        hint={t("settings.engine.onDeviceHint")}
        onSelect={() => chooseEngine("on-device")}
        testID="engine-on-device-card"
      >
        <OnDeviceEngineConfig />
      </EngineOptionCard>
      <View style={styles.engineGap} />
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
  // The selected model, from the same store the recognition gate reads.
  const [modelId, setModelId] = useState<OnDeviceModelId>("gemma-4-e2b");
  useEffect(() => {
    let stale = false;
    void loadOnDeviceModelId().then((stored) => {
      if (!stale) {
        setModelId(stored);
      }
    });
    return () => {
      stale = true;
    };
  }, []);

  const chooseModel = useCallback((next: OnDeviceModelId) => {
    setModelId(next);
    void saveOnDeviceModelId(next).catch(() => {});
  }, []);

  return (
    <View style={styles.configStack}>
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

  const [presence, setPresence] = useState(() => modelPresence(model.id));
  const refreshPresence = useCallback(() => {
    setPresence(modelPresence(model.id));
  }, [model.id]);

  const [downloadPhase, setDownloadPhase] = useState<
    "idle" | "downloading" | "failed"
  >("idle");
  const [downloadFraction, setDownloadFraction] = useState(0);
  const [downloadError, setDownloadError] = useState(false);

  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const startDownload = useCallback(() => {
    setDownloadPhase("downloading");
    setDownloadError(false);
    setDownloadFraction(
      presence.status === "partial" ? presence.sizeBytes / model.sizeBytes : 0,
    );
    void downloadModel(model.id, ({ fraction }) => {
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
          setDownloadError(true);
          refreshPresence();
        }
      });
  }, [model.id, model.sizeBytes, presence, refreshPresence]);

  const deleteWeights = useCallback(() => {
    deleteModel(model.id);
    refreshPresence();
  }, [model.id, refreshPresence]);

  // A download of the unselected model still matters — the row keeps its
  // own lifecycle regardless of selection.
  if (downloadPhase === "downloading") {
    return (
      <View style={styles.modelRow} testID={`model-row-${model.id}`}>
        <PressableRow
          selected={selected}
          onSelect={onSelect}
          name={model.name}
        />
        <View style={styles.configStack}>
          <DownloadProgressBar fraction={downloadFraction} />
          <DownloadByteReadout
            sizeBytes={Math.round(downloadFraction * model.sizeBytes)}
            totalBytes={model.sizeBytes}
          />
          <Text style={styles.hint}>{t("settings.engine.downloading")}</Text>
        </View>
      </View>
    );
  }

  if (presence.status === "present") {
    return (
      <View style={styles.modelRow} testID={`model-row-${model.id}`}>
        <PressableRow
          selected={selected}
          onSelect={onSelect}
          name={model.name}
        />
        <View style={styles.costLine}>
          <Text style={styles.statusLine}>
            {t("settings.engine.modelCosts", {
              size: formatBytes(model.sizeBytes),
              ram: formatBytes(model.ramBytes),
            })}
          </Text>
        </View>
        {selected ? (
          <View style={styles.modelActions}>
            <ModelTestButton />
            <Button
              size="xs"
              variant="ghost"
              fullWidth={false}
              onPress={deleteWeights}
            >
              {t("settings.engine.deleteModel")}
            </Button>
          </View>
        ) : null}
      </View>
    );
  }

  // Absent or partial: the download offer, with what it costs stated up
  // front. A failed pass re-offers the download — bytes already on disk are
  // kept, so the retry resumes rather than restarts.
  return (
    <View style={styles.modelRow} testID={`model-row-${model.id}`}>
      <PressableRow selected={selected} onSelect={onSelect} name={model.name} />
      <Text style={styles.costLine}>
        {t("settings.engine.modelCosts", {
          size: formatBytes(model.sizeBytes),
          ram: formatBytes(model.ramBytes),
        })}
      </Text>
      {downloadError ? (
        <Text style={styles.downloadError}>
          {t("settings.engine.downloadFailed")}
        </Text>
      ) : null}
      <Button size="sm" variant="primary" onPress={startDownload}>
        {t("settings.engine.download")}
      </Button>
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
}: {
  selected: boolean;
  onSelect: () => void;
  name: string;
}) {
  return (
    <Pressable
      accessibilityLabel={name}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onSelect}
      style={({ pressed }) => [
        styles.modelSelectRow,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.radioRing}>
        {selected ? <View style={styles.radioDot} /> : null}
      </View>
      <Text style={styles.modelName}>{name}</Text>
    </Pressable>
  );
}

// The Test button for the SELECTED model — the context it probes is the
// one bound to the current model id, so only the selected row offers it.
function ModelTestButton() {
  const { t } = useTranslation();
  const [testPhase, setTestPhase] = useState<
    "idle" | "testing" | "passed" | "failed"
  >("idle");
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
        disabled={testPhase === "testing"}
        loading={testPhase === "testing"}
        onPress={test}
      >
        {t("settings.onDevice.test")}
      </Button>
      {testPhase === "passed" ? (
        <Text style={[styles.verdict, styles.verdictPassed]}>
          {t("settings.onDevice.testPassed")}
        </Text>
      ) : null}
      {testPhase === "failed" ? (
        <Text style={[styles.verdict, styles.verdictFailed]}>
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
  const [testPhase, setTestPhase] = useState<RemoteTestPhase>("idle");
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let stale = false;
    void loadRemoteModelConfig().then((config) => {
      if (!stale && config !== null) {
        setBaseUrl(config.baseUrl);
        setModel(config.model);
        setHasSavedConfig(true);
      }
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

  const clear = useCallback(() => {
    void clearRemoteModelConfig().then(() => {
      if (isMountedRef.current) {
        setBaseUrl("");
        setModel("");
        setApiKey("");
        setHasSavedConfig(false);
        setTestPhase("idle");
      }
    });
  }, []);

  const test = useCallback(() => {
    // The test runs what the runner would run, against what is SAVED — save
    // first, then test, is the only honest order.
    setTestPhase("testing");
    void saveRemoteModelConfig(draft, apiKey === "" ? null : apiKey)
      .then(() => createRemoteRunModel())
      .then(async (runModel) => {
        if (runModel === null) {
          throw new Error("no config");
        }
        // A one-token completion: proves reachability, auth, and the model
        // name in one round trip.
        await runModel({ system: "ping", user: "ping", grammar: "" });
        if (isMountedRef.current) {
          setTestPhase("passed");
          setHasSavedConfig(true);
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
        hint={hasSavedConfig ? t("settings.engine.apiKeyHint") : undefined}
        placeholder="sk-…"
        value={apiKey}
        onChangeText={setApiKey}
        autoCapitalize="none"
      />
      <View style={styles.testRow}>
        <Button
          size="sm"
          variant={draftValid ? "primary" : "secondary"}
          fullWidth={false}
          disabled={!draftValid}
          onPress={draftValid ? test : undefined}
        >
          {testPhase === "testing"
            ? t("settings.engine.testing")
            : t("settings.engine.save")}
        </Button>
        {testPhase === "passed" ? (
          <Text style={[styles.verdict, styles.verdictPassed]}>
            {t("settings.engine.testPassed")}
          </Text>
        ) : null}
        {testPhase === "failed" ? (
          <Text style={[styles.verdict, styles.verdictFailed]}>
            {t("settings.engine.testFailure")}
          </Text>
        ) : null}
      </View>
      {hasSavedConfig ? (
        <Button size="sm" variant="ghost" fullWidth={false} onPress={clear}>
          {t("settings.engine.clear")}
        </Button>
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
    gap: 0,
  },
  engineGap: {
    height: SPACING.md,
  },
  configStack: {
    gap: SPACING.md,
  },
  modelRow: {
    gap: SPACING.sm,
  },
  modelSelectRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: SPACING.md,
  },
  pressed: {
    opacity: PRESSED_OPACITY_SURFACE,
  },
  modelName: {
    color: COLORS.ink,
    fontSize: FONT_SIZE.bodySm,
    fontWeight: "600",
  },
  radioRing: {
    alignItems: "center",
    borderColor: COLORS.outlineBorder,
    borderRadius: 8,
    borderWidth: 1.5,
    height: 16,
    justifyContent: "center",
    width: 16,
  },
  radioDot: {
    backgroundColor: COLORS.brand,
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  costLine: {
    color: COLORS.muted,
    fontSize: FONT_SIZE.micro,
    lineHeight: LINE_HEIGHT.tight,
    paddingLeft: SPACING.md + 16 + SPACING.md,
  },
  statusLine: {
    color: COLORS.muted,
    fontSize: FONT_SIZE.micro,
    lineHeight: LINE_HEIGHT.tight,
  },
  hint: {
    color: COLORS.subtle,
    fontSize: FONT_SIZE.micro,
    lineHeight: LINE_HEIGHT.tight,
  },
  downloadError: {
    color: COLORS.danger,
    fontSize: FONT_SIZE.micro,
    lineHeight: LINE_HEIGHT.tight,
  },
  modelActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: SPACING.md,
    paddingLeft: SPACING.md + 16 + SPACING.md,
  },
  testRow: {
    alignItems: "center",
    flexDirection: "row",
    flex: 1,
    flexWrap: "wrap",
    gap: SPACING.md,
  },
  verdict: {
    color: COLORS.muted,
    flex: 1,
    fontSize: FONT_SIZE.bodySm,
    lineHeight: LINE_HEIGHT.body,
  },
  verdictPassed: {
    color: COLORS.brand,
    fontWeight: "600",
  },
  verdictFailed: {
    color: COLORS.danger,
    fontWeight: "600",
  },
  noticeCard: {
    borderRadius: RADIUS.xs,
    borderWidth: 1,
    marginTop: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.sm,
  },
  notice: {
    fontSize: FONT_SIZE.bodySm,
    lineHeight: LINE_HEIGHT.body,
  },
});
