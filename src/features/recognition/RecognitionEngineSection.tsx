import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Alert, StyleSheet, Text, View } from "react-native";

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
  modelPresence,
  observeModelPresence,
  pauseModelDownload,
  resumeModelDownload,
  startModelDownload,
} from "@/features/on-device-model/model-download";
import {
  selectOnDeviceModel,
  verifyOnDeviceModel,
} from "@/features/on-device-model/model-context";
import {
  loadOnDeviceModelId,
  saveOnDeviceModelId,
} from "@/features/on-device-model/on-device-model-store";
import { useModelDownload } from "@/features/on-device-model/use-model-download";
import {
  DownloadByteReadout,
  DownloadProgressBar,
} from "@/features/recognition/DownloadProgressBar";
import {
  EngineOptionCard,
  RadioOptionRow,
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
import { screenStyles } from "@/theme/screen-styles";
import { TONES } from "@/theme/tones";
import { RADIUS } from "@/theme/sizes";
import { SPACING } from "@/theme/spacing";
import { FONT_WEIGHT } from "@/theme/typography";

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
  // Presence is disk state the download module owns: the subscription — not
  // a download-phase proxy, not a manual refresh after the delete — is what
  // keeps this copy current. It fires on subscribe and after every change of
  // the model's file (a settle's rename, a delete), so the row is a pure
  // view over the same disk the recognition gate reads. The reducer keeps
  // the old object on an unchanged status, so the subscribe-time callback
  // costs no re-render.
  useEffect(
    () =>
      observeModelPresence(model.id, (next) => {
        setPresence((prev) => (prev.status === next.status ? prev : next));
      }),
    [model.id],
  );

  // The download status lives OUTSIDE the row (model-download): the transfer
  // must survive this component unmounting — the user leaving the settings
  // screen, the engine card collapsing, or the app backgrounding — and a row
  // re-mounting mid-download must find it still running, progress included.
  // Unmounting cancels only the SUBSCRIPTION, never the download.
  const download = useModelDownload(model.id);

  // Deleting is confirm-then-do: the weights are the gigabytes the user
  // deliberately downloaded, and a stray tap on a small ghost button must not
  // undo that. The native alert pattern the multi-account replace confirm
  // already uses (cancel + destructive); the destructive button keeps the
  // trigger's own label so the action has one name through the flow. The
  // confirm handler only deletes — refreshing the row is the presence
  // subscription's job.
  const deleteWeights = useCallback(() => {
    Alert.alert(
      t("settings.engine.deleteModelTitle", { model: model.name }),
      t("settings.engine.deleteModelMessage", {
        size: formatBytes(model.sizeBytes),
      }),
      [
        { style: "cancel", text: t("common.cancel") },
        {
          style: "destructive",
          text: t("settings.engine.deleteModel"),
          onPress: () => {
            deleteModel(model.id);
          },
        },
      ],
    );
  }, [model.id, model.name, model.sizeBytes, t]);

  // One row head, three bodies. The head — radio, name, and the cost line —
  // is the shared `RadioOptionRow` at its compact size, identical across the
  // download lifecycle (absent → downloading → present), so it renders once
  // here and only the body below it switches; an accessibility or layout
  // change to the head then can't drift between states. The body indents to
  // sit under the copy column (RADIO_ROW_INDENT) — progress, actions, and
  // error copy share that one left edge.
  let body: ReactNode;
  if (download.phase === "downloading" || download.phase === "paused") {
    // One control, two labels: pause and resume are the same toggle, its
    // colour stating which way it pushes — brand to continue the download,
    // neutral to hold it. The paused row KEEPS its bar: the bytes on disk
    // are real, and hiding them would read as "restarts from zero" — the
    // opposite of the truth.
    const paused = download.phase === "paused";
    body = (
      <>
        <View style={styles.progressStack}>
          <DownloadProgressBar fraction={download.fraction} />
          <DownloadByteReadout
            fraction={download.fraction}
            totalBytes={model.sizeBytes}
          />
          <Text style={styles.hint}>
            {paused
              ? t("settings.engine.paused")
              : t("settings.engine.downloading")}
          </Text>
        </View>
        <Button
          size="xs"
          variant={paused ? "primary" : "secondary"}
          onPress={
            paused
              ? () => resumeModelDownload(model.id)
              : () => pauseModelDownload(model.id)
          }
        >
          {paused
            ? t("settings.engine.resumeDownload")
            : t("settings.engine.pauseDownload")}
        </Button>
      </>
    );
  } else if (presence.status === "present") {
    body = selected ? <ModelActionsRow onDelete={deleteWeights} /> : null;
  } else {
    // Absent or partial: the download offer. A failed pass re-offers the
    // download, which starts over from the beginning — the downloader
    // replaces whatever partial file is there.
    body = (
      <>
        {download.phase === "failed" ? (
          <Text style={styles.downloadError}>
            {t("settings.engine.downloadFailed")}
          </Text>
        ) : null}
        <Button
          accessibilityHint={t("settings.engine.downloadHint", {
            model: model.name,
            size: formatBytes(model.sizeBytes),
          })}
          size="xs"
          variant="primary"
          onPress={() => startModelDownload(model.id)}
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
      <RadioOptionRow
        compact
        selected={selected}
        label={model.name}
        hint={modelCosts}
        onSelect={onSelect}
      />
      <View style={styles.modelBody}>{body}</View>
    </View>
  );
}

// The present model's actions: Test and Delete as two equal-width blocks
// sharing the row (ButtonGroup), the verdict on its own line below — the
// failure copy runs two lines, and inline between the buttons it would rag
// the row. The pair's colour IS the semantics: brand for the action you
// want (verify the model works), the danger hairline for the one you
// shouldn't want (AGENTS.md: red is reserved for destructive).
function ModelActionsRow({ onDelete }: { onDelete: () => void }) {
  const { t } = useTranslation();
  const [testPhase, setTestPhase] = useState<TestPhase>("idle");
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);
  // The Test button probes the SELECTED model's context — only a present,
  // selected row renders this component, so the verdict answers the row the
  // user is looking at.
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
    <>
      <ButtonGroup>
        <Button
          size="xs"
          variant="primary"
          loading={testPhase === "testing"}
          onPress={test}
        >
          {t("settings.onDevice.test")}
        </Button>
        <Button size="xs" variant="dangerOutline" onPress={onDelete}>
          {t("settings.engine.deleteModel")}
        </Button>
      </ButtonGroup>
      {testPhase === "passed" ? (
        // Announced, not just shown: the verdict is the answer to the tap, and
        // the deleted SettingsScreen verdict carried the live region — losing
        // it in the move silenced the outcome for screen-reader users.
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.verdictLine, styles.verdictPassed]}
        >
          {t("settings.onDevice.testPassed")}
        </Text>
      ) : null}
      {testPhase === "failed" ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.verdictLine, styles.verdictFailed]}
        >
          {t("settings.onDevice.testFailure")}
        </Text>
      ) : null}
    </>
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
      {/* `required` on the two fields the schema demands (FieldShell paints
          the red mark); the API key is deliberately optional — a local
          endpoint (Ollama, LM Studio) needs none, and the hint already says
          where the key lives once given. */}
      <FormField
        label={t("settings.engine.baseUrl")}
        required
        hint={t("settings.engine.baseUrlHint")}
        placeholder="https://"
        value={baseUrl}
        onChangeText={setBaseUrl}
        autoCapitalize="none"
      />
      <FormField
        label={t("settings.engine.model")}
        required
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
      {/* The form's one action: the section's brand block, grey while the
          draft cannot save — the button itself is the affordance that says
          what is still missing. */}
      <Button
        size="xs"
        variant="primary"
        disabled={!draftValid || isClearing}
        loading={isTesting}
        onPress={test}
      >
        {t("settings.engine.save")}
      </Button>
      {testPhase === "passed" ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.verdictLine, styles.verdictPassed]}
        >
          {t("settings.engine.testPassed")}
        </Text>
      ) : null}
      {testPhase === "failed" ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.verdictLine, styles.verdictFailed]}
        >
          {t("settings.engine.testFailure")}
        </Text>
      ) : null}
      {hasSavedConfig ? (
        <>
          <Button
            size="xs"
            variant="dangerOutline"
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
        </>
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
  // The row's trailing content sits under the copy column (see
  // RADIO_ROW_INDENT): progress, actions, and error copy share that one
  // left edge, and the gap keeps the rhythm the row itself uses.
  modelBody: {
    gap: SPACING.sm,
    paddingLeft: RADIO_ROW_INDENT,
  },
  progressStack: {
    gap: SPACING.sm,
  },
  hint: {
    ...screenStyles.metaLine,
  },
  downloadError: {
    ...screenStyles.metaLineDanger,
  },
  // A test verdict on its own line under the action row: the failure copy
  // runs two lines, so it gets the full row width rather than sharing one.
  verdictLine: {
    ...screenStyles.metaLine,
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
  // Anchored to the Remove action it explains, in the shared error-hint voice.
  // The stack's gap does the spacing; no margin of its own.
  clearFailedHint: {
    ...screenStyles.metaLineDanger,
  },
});
