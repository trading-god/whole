import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";

import { SettingsScreen } from "@/features/settings/SettingsScreen";
import { deferred } from "@/test-support/deferred";
import { renderWithProviders } from "@/test-support/render";
import { onDeviceModel } from "@/features/on-device-model/on-device-catalog";
import { formatBytes } from "@/features/on-device-model/format-bytes";

const E2B = onDeviceModel("gemma-4-e2b");
const E4B = onDeviceModel("gemma-4-e4b");

const mockVerify = jest.fn<() => Promise<void>>();
const mockSelectOnDeviceModel = jest.fn<(id?: unknown) => Promise<void>>();
const mockModelPresence = jest.fn<(id?: unknown) => { status: string }>();
const mockStartModelDownload = jest.fn<(id: unknown) => void>();
const mockDeleteModel = jest.fn<(id: unknown) => void>();
// The module-level download store, faked at the same seam the component
// consumes: observeModelDownload reports the current snapshot immediately
// and on every publish, per model id — which is what re-mounting rows ride.
// The IDLE default is a shared, STABLE object: the component reads the
// snapshot through useSyncExternalStore, which compares by identity — a
// fresh literal per call would loop it forever.
const IDLE_SNAPSHOT = { phase: "idle", fraction: 0 } as const;
const mockSnapshots = new Map<string, { phase: string; fraction: number }>();
const mockDownloadListeners = new Map<
  string,
  Set<(snapshot: { phase: string; fraction: number }) => void>
>();
const emitDownloadSnapshot = (
  id: string,
  snapshot: { phase: string; fraction: number },
) => {
  mockSnapshots.set(id, snapshot);
  for (const listener of mockDownloadListeners.get(id) ?? []) {
    listener(snapshot);
  }
};
const mockLoadEngine = jest.fn<() => Promise<"on-device" | "remote">>();
const mockSaveEngine =
  jest.fn<(engine: "on-device" | "remote") => Promise<void>>();
const mockLoadRemoteConfig = jest.fn<() => Promise<unknown>>();
const mockSaveRemoteConfig =
  jest.fn<(config?: unknown, apiKey?: unknown) => Promise<void>>();
const mockClearRemoteConfig = jest.fn<() => Promise<void>>();
const mockCreateRemoteRunModel = jest.fn<() => Promise<unknown>>();
const mockRunRemoteModel = jest.fn<() => Promise<string>>();

jest.mock("@/features/on-device-model/model-context", () => ({
  verifyOnDeviceModel: () => mockVerify(),
  selectOnDeviceModel: (id: unknown) => mockSelectOnDeviceModel(id),
}));

// The engine section's three real state sources, mocked at their module
// seams: the disk (model-download), the preference (engine-store), and the
// SecureStore-backed config (remote-model-config-store). The remote runner is
// mocked for the service Test button.
jest.mock("@/features/on-device-model/model-download", () => ({
  modelPresence: (id: unknown) => mockModelPresence(id),
  modelDownloadState: (id: unknown) =>
    mockSnapshots.get(id as string) ?? IDLE_SNAPSHOT,
  observeModelDownload: (
    id: unknown,
    listener: (snapshot: { phase: string; fraction: number }) => void,
  ) => {
    const key = id as string;
    const set = mockDownloadListeners.get(key) ?? new Set();
    set.add(listener);
    mockDownloadListeners.set(key, set);
    listener(mockSnapshots.get(key) ?? IDLE_SNAPSHOT);
    return () => {
      set.delete(listener);
      if (set.size === 0) {
        mockDownloadListeners.delete(key);
      }
    };
  },
  startModelDownload: (id: unknown) => mockStartModelDownload(id),
  deleteModel: (id: unknown) => mockDeleteModel(id),
  reattachModelDownloads: () => Promise.resolve(),
}));

const mockLoadOnDeviceModelId =
  jest.fn<() => Promise<"gemma-4-e2b" | "gemma-4-e4b">>();
const mockSaveOnDeviceModelId =
  jest.fn<(id: "gemma-4-e2b" | "gemma-4-e4b") => Promise<void>>();
jest.mock("@/features/on-device-model/on-device-model-store", () => ({
  loadOnDeviceModelId: () => mockLoadOnDeviceModelId(),
  saveOnDeviceModelId: (id: "gemma-4-e2b" | "gemma-4-e4b") =>
    mockSaveOnDeviceModelId(id),
}));

jest.mock("@/features/recognition/engine-store", () => ({
  loadRecognitionEngine: () => mockLoadEngine(),
  saveRecognitionEngine: (engine: "on-device" | "remote") =>
    mockSaveEngine(engine),
}));

// Storage-only: the schema and normalizer the form's validity runs on are
// imported by the component from the native-free `remote-config-schema`
// directly, so the real ones run unmocked here — only the storage calls are
// faked.
jest.mock("@/features/recognition/remote-model-config-store", () => ({
  loadRemoteModelConfig: () => mockLoadRemoteConfig(),
  saveRemoteModelConfig: (config: unknown, apiKey: unknown) =>
    mockSaveRemoteConfig(config, apiKey),
  clearRemoteModelConfig: () => mockClearRemoteConfig(),
}));

jest.mock("@/features/recognition/remote-runner", () => ({
  createRemoteRunModel: () => mockCreateRemoteRunModel(),
}));

// `ScreenHeader`'s back chevron reads it; the screen itself no longer does.
jest.mock("@/lib/useReturnToOverview", () => ({
  useReturnToOverview: () => jest.fn(),
}));

// The display-currency row reads and writes the shared preference store,
// which sits on kv-store and so on the native sqlite module. One module seam,
// mocked wholesale (AGENTS.md): the screen only needs a value back.
jest.mock("@/features/assets/display-currency-store", () => ({
  loadDisplayCurrency: (fallback: string) => Promise.resolve(fallback),
  saveDisplayCurrency: () => Promise.resolve(),
}));

const press = async (label: string) => {
  await fireEvent.press(screen.getByText(label));
};

const showRemoteEngine = async () => {
  mockLoadEngine.mockResolvedValue("remote");
  await renderWithProviders(<SettingsScreen />);
  await waitFor(() => {
    expect(screen.getByText("Base URL")).toBeOnTheScreen();
  });
};

const fillValidRemoteDraft = async () => {
  await fireEvent.changeText(
    screen.getByLabelText("Base URL"),
    "https://api.example.com/v1/",
  );
  await fireEvent.changeText(screen.getByLabelText("Model"), "example-model");
  await fireEvent.changeText(screen.getByLabelText("API key"), "secret-key");
};

beforeEach(() => {
  // `clearAllMocks`, not `resetAllMocks`: resetting would also reset the
  // jest-expo native-module mocks — expo-localization's `getLocales` among
  // them — and the locale resolver would then crash on the undefined it
  // returns. Every mock this suite drives is re-implemented below anyway.
  jest.clearAllMocks();
  mockVerify.mockResolvedValue(undefined);
  mockSelectOnDeviceModel.mockResolvedValue(undefined);
  mockModelPresence.mockReturnValue({ status: "present" });
  mockLoadOnDeviceModelId.mockResolvedValue("gemma-4-e2b");
  mockSaveOnDeviceModelId.mockResolvedValue(undefined);
  mockStartModelDownload.mockImplementation((id) => {
    // The default download behavior: the start lands the transfer in the
    // downloading snapshot; tests that need more drive it by hand.
    emitDownloadSnapshot(id as string, { phase: "downloading", fraction: 0 });
  });
  mockSnapshots.clear();
  mockDownloadListeners.clear();
  mockLoadEngine.mockResolvedValue("on-device");
  mockSaveEngine.mockResolvedValue(undefined);
  mockLoadRemoteConfig.mockResolvedValue(null);
  mockSaveRemoteConfig.mockResolvedValue(undefined);
  mockClearRemoteConfig.mockResolvedValue(undefined);
  mockRunRemoteModel.mockResolvedValue("pong");
  mockCreateRemoteRunModel.mockResolvedValue(mockRunRemoteModel);
});

// Labels are asserted in ENGLISH: `useLocales()` resolves to `en` under
// jest-expo, so that is the copy this suite actually renders.
describe("SettingsScreen", () => {
  it("offers the display currency and the app version", async () => {
    await renderWithProviders(<SettingsScreen />);

    expect(screen.getByText("Display currency")).toBeTruthy();
    expect(screen.getByText(/^Version/)).toBeTruthy();
  });

  describe("the recognition engine section", () => {
    it("shows both engines, the local one selected by default", async () => {
      await renderWithProviders(<SettingsScreen />);

      expect(screen.getByText("On-device model")).toBeTruthy();
      expect(screen.getByText("Cloud model service")).toBeTruthy();
      expect(screen.getByText(/Stronger results/)).toBeTruthy();
    });

    it("exposes separate radio groups with selected states and useful hints", async () => {
      await renderWithProviders(<SettingsScreen />);

      const engineGroup = screen.getByLabelText("Recognition engine");
      const modelGroup = screen.getByLabelText("On-device model choice");
      expect(engineGroup.props.accessibilityRole).toBe("radiogroup");
      expect(modelGroup.props.accessibilityRole).toBe("radiogroup");

      const localEngine = screen.getByLabelText("On-device model");
      const remoteEngine = screen.getByLabelText("Cloud model service");
      expect(localEngine.props.accessibilityState).toEqual({ selected: true });
      expect(remoteEngine.props.accessibilityState).toEqual({
        selected: false,
      });
      expect(remoteEngine.props.accessibilityHint).toContain("needs internet");

      const smallModel = screen.getByLabelText("Gemma 4 E2B");
      expect(smallModel.props.accessibilityRole).toBe("radio");
      expect(smallModel.props.accessibilityState).toEqual({ selected: true });
      expect(smallModel.props.accessibilityHint).toBe(
        `${formatBytes(E2B.sizeBytes)} storage · about ${formatBytes(E2B.ramBytes)} memory to run`,
      );
    });

    it("lists both models with their storage and memory costs", async () => {
      await renderWithProviders(<SettingsScreen />);

      // The E2B/E4B choice turns on these two numbers for the device, so
      // each row states them: the download's bill and the running bill.
      expect(screen.getByText("Gemma 4 E2B")).toBeTruthy();
      expect(screen.getByText("Gemma 4 E4B")).toBeTruthy();
      expect(
        screen.getByText(
          `${formatBytes(E2B.sizeBytes)} storage · about ${formatBytes(E2B.ramBytes)} memory to run`,
        ),
      ).toBeTruthy();
      expect(
        screen.getByText(
          `${formatBytes(E4B.sizeBytes)} storage · about ${formatBytes(E4B.ramBytes)} memory to run`,
        ),
      ).toBeTruthy();
    });

    it("switches the selected model when the other row's radio is chosen", async () => {
      await renderWithProviders(<SettingsScreen />);

      await fireEvent.press(screen.getByText("Gemma 4 E4B"));

      expect(mockSaveOnDeviceModelId).toHaveBeenCalledWith("gemma-4-e4b");
      // The switch also releases the loaded context, so the two models are
      // never warm at once (AGENTS.md) — the very next completion loads the
      // new weights.
      expect(mockSelectOnDeviceModel).toHaveBeenCalledWith("gemma-4-e4b");
    });

    it("shows the download offer when the selected model is absent", async () => {
      mockModelPresence.mockReturnValue({ status: "absent" });

      await renderWithProviders(<SettingsScreen />);

      // Both models are absent: both rows offer their download.
      expect(screen.getAllByText("Download")).toHaveLength(2);
    });

    it("offers a download per model row, the other model's presence notwithstanding", async () => {
      // E4B on disk, E2B not: the E2B row still offers its download — and
      // the E4B row does not.
      mockModelPresence.mockImplementation((id) =>
        id === "gemma-4-e4b" ? { status: "present" } : { status: "absent" },
      );

      await renderWithProviders(<SettingsScreen />);

      expect(screen.getAllByText("Download")).toHaveLength(1);
    });

    it("shows byte, percentage, and accessible progress while downloading", async () => {
      mockModelPresence.mockReturnValue({ status: "absent" });

      await renderWithProviders(<SettingsScreen />);
      await fireEvent.press(screen.getAllByText("Download")[0]);

      expect(screen.getByText("Downloading…")).toBeOnTheScreen();
      expect(
        screen.getByText(`0 B of ${formatBytes(E2B.sizeBytes)}`),
      ).toBeOnTheScreen();
      expect(screen.getByText("0%")).toBeOnTheScreen();

      await act(() => {
        emitDownloadSnapshot("gemma-4-e2b", {
          phase: "downloading",
          fraction: 0.42,
        });
      });

      await waitFor(() => {
        const progress = screen.getByLabelText("Model download progress");
        expect(progress.props.accessibilityRole).toBe("progressbar");
        expect(progress.props.accessibilityValue).toEqual({
          min: 0,
          max: 100,
          now: 42,
          text: "42% downloaded",
        });
        expect(
          screen.getByText(
            `${formatBytes(Math.round(E2B.sizeBytes * 0.42))} of ${formatBytes(E2B.sizeBytes)}`,
          ),
        ).toBeOnTheScreen();
        expect(screen.getByText("42%")).toBeOnTheScreen();
      });
    });

    it("runs a download to completion and lands on the downloaded state", async () => {
      // Initial render: absent. After the download settles, the presence
      // re-read reports present.
      mockModelPresence.mockReturnValue({ status: "absent" });
      mockStartModelDownload.mockImplementation((id) => {
        emitDownloadSnapshot(id as string, {
          phase: "downloading",
          fraction: 0,
        });
        mockModelPresence.mockReturnValue({ status: "present" });
        emitDownloadSnapshot(id as string, { phase: "idle", fraction: 0 });
      });

      await renderWithProviders(<SettingsScreen />);

      await fireEvent.press(screen.getAllByText("Download")[0]);

      // The downloaded state: the row swaps its download button for the
      // Test button, which only a present model offers.
      await waitFor(() => {
        expect(mockStartModelDownload).toHaveBeenCalledTimes(1);
        expect(screen.getByText("Test")).toBeTruthy();
      });
    });

    it("reports a failed download with the retry copy", async () => {
      mockModelPresence.mockReturnValue({ status: "absent" });
      mockStartModelDownload.mockImplementation((id) => {
        emitDownloadSnapshot(id as string, {
          phase: "downloading",
          fraction: 0,
        });
        emitDownloadSnapshot(id as string, { phase: "failed", fraction: 0 });
      });

      await renderWithProviders(<SettingsScreen />);

      await fireEvent.press(screen.getAllByText("Download")[0]);

      await waitFor(() => {
        expect(screen.getByText(/The download didn't finish/)).toBeTruthy();
      });
    });

    it("tests the downloaded model and reports the verdict beside the button", async () => {
      await renderWithProviders(<SettingsScreen />);

      await press("Test");

      await waitFor(() => {
        expect(screen.getByText("The on-device model is working")).toBeTruthy();
      });
      // The button keeps its label: one that turns into "Working" for a
      // moment reads as a switch.
      expect(screen.getByText("Test")).toBeTruthy();
    });

    it("reports a failing model test with localized advice", async () => {
      mockVerify.mockRejectedValue(new Error("out of memory"));

      await renderWithProviders(<SettingsScreen />);

      await press("Test");

      // The technical reason stays out of the UI: the copy is localized, and
      // the advice is the same whatever stage failed.
      await waitFor(() => {
        expect(
          screen.getByText(
            "The on-device model couldn't be verified. Restart the app, and free up memory and storage if it happens again.",
          ),
        ).toBeTruthy();
      });
    });

    it("deletes the model when asked", async () => {
      mockModelPresence.mockReturnValueOnce({ status: "present" });
      mockModelPresence.mockReturnValueOnce({ status: "absent" });

      await renderWithProviders(<SettingsScreen />);

      await press("Delete model");

      expect(mockDeleteModel).toHaveBeenCalledTimes(1);
    });

    it("switches engines when the remote card is chosen", async () => {
      await renderWithProviders(<SettingsScreen />);

      await fireEvent.press(screen.getByTestId("engine-remote-card"));

      expect(mockSaveEngine).toHaveBeenCalledWith("remote");
      // The remote form appears inside the now-selected card.
      await waitFor(() => {
        expect(screen.getByText("Base URL")).toBeTruthy();
      });
    });

    it("hydrates the remote form from the saved config", async () => {
      mockLoadEngine.mockResolvedValue("remote");
      mockLoadRemoteConfig.mockResolvedValue({
        baseUrl: "https://api.deepseek.com/v1",
        model: "deepseek-chat",
        apiKey: null,
      });

      await renderWithProviders(<SettingsScreen />);

      await waitFor(() => {
        expect(
          screen.getByDisplayValue("https://api.deepseek.com/v1"),
        ).toBeTruthy();
        expect(screen.getByDisplayValue("deepseek-chat")).toBeTruthy();
      });
    });

    it("keeps save unavailable until the remote draft is valid", async () => {
      await showRemoteEngine();

      const save = screen.getByText("Save service").parent;
      expect(save?.props.accessibilityState).toEqual({ disabled: true });

      await fireEvent.changeText(
        screen.getByLabelText("Base URL"),
        "http://api.example.com/v1",
      );
      await fireEvent.changeText(
        screen.getByLabelText("Model"),
        "example-model",
      );
      expect(save?.props.accessibilityState).toEqual({ disabled: true });

      await fireEvent.changeText(
        screen.getByLabelText("Base URL"),
        "https://api.example.com/v1",
      );
      await waitFor(() => {
        expect(
          screen.getByText("Save service").parent?.props.accessibilityState,
        ).toEqual({ disabled: false });
      });
    });

    it("configures the API key as a secure credential field", async () => {
      await showRemoteEngine();

      const apiKey = screen.getByLabelText("API key");
      expect(apiKey.props.secureTextEntry).toBe(true);
      expect(apiKey.props.textContentType).toBe("password");
      expect(apiKey.props.autoComplete).toBe("off");
      expect(apiKey.props.autoCapitalize).toBe("none");
    });

    it("saves a normalized remote config, blocks duplicate presses, and reports success", async () => {
      await showRemoteEngine();
      await fillValidRemoteDraft();
      const pendingSave = deferred<void>();
      mockSaveRemoteConfig.mockReturnValue(pendingSave.promise);

      await press("Save service");

      expect(mockSaveRemoteConfig).toHaveBeenCalledWith(
        {
          baseUrl: "https://api.example.com/v1",
          model: "example-model",
        },
        "secret-key",
      );
      // The label stays "Save service" while busy — the spinner says the rest
      // (the pattern every other busy button in the app now follows).
      const saveButton = screen.getByText("Save service").parent;
      expect(saveButton?.props.accessibilityState).toEqual({
        busy: true,
        disabled: true,
      });
      await fireEvent.press(saveButton!);
      expect(mockSaveRemoteConfig).toHaveBeenCalledTimes(1);

      await act(() => {
        pendingSave.resolve();
      });

      await waitFor(() => {
        expect(mockRunRemoteModel).toHaveBeenCalledWith({
          system: "ping",
          user: "ping",
          grammar: "",
        });
        expect(screen.getByText("The service responded")).toBeOnTheScreen();
        expect(screen.getByText("Remove service")).toBeOnTheScreen();
      });
    });

    it("reports a remote test failure while keeping the saved service removable", async () => {
      await showRemoteEngine();
      await fillValidRemoteDraft();
      mockRunRemoteModel.mockRejectedValue(new Error("unauthorized"));

      await press("Save service");

      await waitFor(() => {
        expect(
          screen.getByText(
            "The service didn't respond. Check the address, the model name, and the API key.",
          ),
        ).toBeOnTheScreen();
        expect(screen.getByText("Remove service")).toBeOnTheScreen();
      });
    });

    it("clears a saved remote service with a visible, guarded loading state", async () => {
      mockLoadRemoteConfig.mockResolvedValue({
        baseUrl: "https://api.deepseek.com/v1",
        model: "deepseek-chat",
        apiKey: "stored-secret",
      });
      const pendingClear = deferred<void>();
      mockClearRemoteConfig.mockReturnValue(pendingClear.promise);
      await showRemoteEngine();
      await waitFor(() => {
        expect(screen.getByText("Remove service")).toBeOnTheScreen();
      });

      await press("Remove service");

      // The label stays "Remove service" while busy — the spinner says the
      // rest.
      const removeButton = screen.getByText("Remove service").parent;
      expect(removeButton?.props.accessibilityState).toEqual({
        busy: true,
        disabled: true,
      });
      await fireEvent.press(removeButton!);
      expect(mockClearRemoteConfig).toHaveBeenCalledTimes(1);

      await act(() => {
        pendingClear.resolve();
      });

      await waitFor(() => {
        expect(screen.queryByText("Remove service")).toBeNull();
        expect(screen.getByLabelText("Base URL").props.value).toBe("");
        expect(screen.getByLabelText("Model").props.value).toBe("");
        expect(screen.getByLabelText("API key").props.value).toBe("");
      });
    });

    it("restores the remove action when clearing the remote service fails", async () => {
      mockLoadRemoteConfig.mockResolvedValue({
        baseUrl: "https://api.deepseek.com/v1",
        model: "deepseek-chat",
        apiKey: "stored-secret",
      });
      mockClearRemoteConfig.mockRejectedValue(new Error("keychain"));
      await showRemoteEngine();
      await waitFor(() => {
        expect(screen.getByText("Remove service")).toBeOnTheScreen();
      });

      await press("Remove service");

      await waitFor(() => {
        // The verdict says BOTH halves: the removal failed, and the service
        // is still saved — the button returning alone would read as a no-op.
        expect(
          screen.getByText(
            "Couldn't remove the service — it is still saved. Try again.",
          ),
        ).toBeOnTheScreen();
        expect(screen.getByText("Remove service")).toBeOnTheScreen();
      });
      expect(screen.getByDisplayValue("deepseek-chat")).toBeOnTheScreen();
    });

    it("shows the privacy trade in the caution tone when the remote engine is selected", async () => {
      mockLoadEngine.mockResolvedValue("remote");

      await renderWithProviders(<SettingsScreen />);

      // The opt-in stated in words, in the tone that carries "allowed, and
      // it has a cost" (AGENTS.md: never danger — that's destructive).
      await waitFor(() => {
        expect(
          screen.getByText(/never the screenshots themselves/),
        ).toBeTruthy();
      });
    });
  });
});
