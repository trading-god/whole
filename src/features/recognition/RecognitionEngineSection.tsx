import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/Button";
import { FormField } from "@/components/FormField";
import { formatBytes } from "@/features/on-device-model/format-bytes";
import { BUNDLED_MODEL } from "@/features/on-device-model/on-device-catalog";
import {
  deleteModel,
  downloadModel,
  modelPresence,
} from "@/features/on-device-model/model-download";
import { bundledModelStorageBytes } from "@/features/on-device-model/model-source";
import { verifyOnDeviceModel } from "@/features/on-device-model/model-context";
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
import { TONES } from "@/theme/tones";
import { RADIUS } from "@/theme/sizes";
import { SPACING } from "@/theme/spacing";
import { FONT_SIZE, LINE_HEIGHT } from "@/theme/typography";

// The recognition engine section: which model answers the annotation turn.
//
// TWO engines behind one choice — the downloaded on-device model, or the
// user's own OpenAI-compatible endpoint — each with its configuration living
// INSIDE its card (radio-card pattern: select to expand, one engine's config
// never crowds the other's). The section owns no engine state of its own:
// everything renders from the three real sources (engine preference in
// kv-store, model files on disk, remote config in SecureStore), so the card
// and the recognition gate cannot disagree.

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
        hint={t("settings.engine.onDeviceHint", {
          size: formatBytes(bundledModelStorageBytes()),
        })}
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
  const { t } = useTranslation();

  // The model's state on disk. `modelPresence` is the truth — re-read after
  // every download/delete because those are the only writers.
  const [presence, setPresence] = useState(() => modelPresence());
  const refreshPresence = useCallback(() => {
    setPresence(modelPresence());
  }, []);

  const [downloadPhase, setDownloadPhase] = useState<
    "idle" | "downloading" | "failed"
  >("idle");
  const [downloadFraction, setDownloadFraction] = useState(0);
  const [downloadError, setDownloadError] = useState(false);

  // The settings screen's Test button over the downloaded weights.
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

  const startDownload = useCallback(() => {
    setDownloadPhase("downloading");
    setDownloadError(false);
    setDownloadFraction(
      presence.status === "partial"
        ? presence.sizeBytes / BUNDLED_MODEL.sizeBytes
        : 0,
    );
    void downloadModel(({ fraction }) => {
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
        // (AGENTS.md), and the recovery does not depend on which shard or
        // which byte range failed: retry the download.
        if (isMountedRef.current) {
          setDownloadPhase("failed");
          setDownloadError(true);
          refreshPresence();
        }
      });
  }, [presence, refreshPresence]);

  const deleteWeights = useCallback(() => {
    deleteModel();
    refreshPresence();
  }, [refreshPresence]);

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

  if (downloadPhase === "downloading") {
    return (
      <View style={styles.configStack} testID="engine-download-progress">
        <DownloadProgressBar fraction={downloadFraction} />
        <View style={styles.downloadRow}>
          <DownloadByteReadout
            sizeBytes={Math.round(downloadFraction * BUNDLED_MODEL.sizeBytes)}
          />
        </View>
        <Text style={styles.hint}>{t("settings.engine.downloading")}</Text>
      </View>
    );
  }

  if (presence.status === "present") {
    return (
      <View style={styles.configStack}>
        <Text style={styles.statusLine}>
          {t("settings.engine.downloaded", {
            size: formatBytes(BUNDLED_MODEL.sizeBytes),
          })}
        </Text>
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
        <Button
          size="sm"
          variant="ghost"
          fullWidth={false}
          onPress={deleteWeights}
        >
          {t("settings.engine.deleteModel")}
        </Button>
      </View>
    );
  }

  // Absent or partial: the download offer, with what it costs stated up
  // front. A failed pass re-offers the download — the shards already on
  // disk are kept, so the retry resumes rather than restarts.
  return (
    <View style={styles.configStack}>
      {presence.status === "partial" ? (
        <DownloadByteReadout sizeBytes={presence.sizeBytes} />
      ) : null}
      {downloadError ? (
        <Text style={styles.downloadError}>
          {t("settings.engine.downloadFailed")}
        </Text>
      ) : null}
      <Text style={styles.hint}>
        {t("settings.engine.downloadHint", {
          size: formatBytes(BUNDLED_MODEL.sizeBytes),
        })}
      </Text>
      <Button size="sm" variant="primary" onPress={startDownload}>
        {t("settings.engine.download")}
      </Button>
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
  testRow: {
    alignItems: "center",
    flexDirection: "row",
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
  downloadRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: SPACING.md,
    justifyContent: "space-between",
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
