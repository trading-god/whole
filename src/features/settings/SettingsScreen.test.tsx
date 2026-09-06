import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";

import { SettingsScreen } from "@/features/settings/SettingsScreen";
import { renderWithProviders } from "@/test-support/render";
import { BUNDLED_MODEL } from "@/features/on-device-model/on-device-catalog";
import { formatBytes } from "@/features/on-device-model/format-bytes";

const mockVerify = jest.fn<() => Promise<void>>();
const mockModelPresence = jest.fn<() => { status: string }>();
const mockDownloadModel =
  jest.fn<
    (
      onProgress: (progress: { fraction: number; sizeBytes: number }) => void,
    ) => Promise<void>
  >();
const mockDeleteModel = jest.fn<() => void>();
const mockLoadEngine = jest.fn<() => Promise<"on-device" | "remote">>();
const mockSaveEngine =
  jest.fn<(engine: "on-device" | "remote") => Promise<void>>();
const mockLoadRemoteConfig = jest.fn<() => Promise<unknown>>();
const mockSaveRemoteConfig = jest.fn<() => Promise<void>>();
const mockClearRemoteConfig = jest.fn<() => Promise<void>>();
const mockCreateRemoteRunModel = jest.fn<() => Promise<unknown>>();

jest.mock("@/features/on-device-model/model-context", () => ({
  verifyOnDeviceModel: () => mockVerify(),
}));

// The engine section's three real state sources, mocked at their module
// seams: the disk (model-download), the preference (engine-store), and the
// SecureStore-backed config (remote-model-config-store). The remote runner is
// mocked for the service Test button.
jest.mock("@/features/on-device-model/model-download", () => ({
  modelPresence: () => mockModelPresence(),
  downloadModel: (
    onProgress: (progress: { fraction: number; sizeBytes: number }) => void,
  ) => mockDownloadModel(onProgress),
  deleteModel: () => mockDeleteModel(),
}));

jest.mock("@/features/recognition/engine-store", () => ({
  loadRecognitionEngine: () => mockLoadEngine(),
  saveRecognitionEngine: (engine: "on-device" | "remote") =>
    mockSaveEngine(engine),
}));

jest.mock("@/features/recognition/remote-model-config-store", () => {
  // The REAL schema and normalizer, re-declared here rather than mocked:
  // the form's validity IS their behavior, so faking them would test the
  // mock. Only the storage calls are faked. (A `requireActual` would pull
  // the real module's kv-store import — and its AsyncStorage native seam —
  // into the suite.)
  const { z } = jest.requireActual("zod") as typeof import("zod");
  return {
    normalizeRemoteBaseUrl: (input: string) => input.trim().replace(/\/+$/, ""),
    remoteConfigSchema: z.object({
      baseUrl: z
        .string()
        .trim()
        .regex(/^https:\/\/[^\s/]+([^\s]*[^\s/])?$/),
      model: z.string().trim().min(1),
    }),
    loadRemoteModelConfig: () => mockLoadRemoteConfig(),
    saveRemoteModelConfig: () => mockSaveRemoteConfig(),
    clearRemoteModelConfig: () => mockClearRemoteConfig(),
  };
});

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

beforeEach(() => {
  // `clearAllMocks`, not `resetAllMocks`: resetting would also reset the
  // jest-expo native-module mocks — expo-localization's `getLocales` among
  // them — and the locale resolver would then crash on the undefined it
  // returns. Every mock this suite drives is re-implemented below anyway.
  jest.clearAllMocks();
  mockVerify.mockResolvedValue(undefined);
  mockModelPresence.mockReturnValue({ status: "present" });
  mockDownloadModel.mockResolvedValue(undefined);
  mockLoadEngine.mockResolvedValue("on-device");
  mockSaveEngine.mockResolvedValue(undefined);
  mockLoadRemoteConfig.mockResolvedValue(null);
  mockSaveRemoteConfig.mockResolvedValue(undefined);
  mockClearRemoteConfig.mockResolvedValue(undefined);
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
    it("shows both engines with their costs, the local one selected by default", async () => {
      await renderWithProviders(<SettingsScreen />);

      expect(screen.getByText("On-device model")).toBeTruthy();
      // The size rides in the hint: a user weighing the storage cost sees the
      // number where the choice is made.
      expect(
        screen.getByText(
          `${formatBytes(BUNDLED_MODEL.sizeBytes)}, works offline, nothing leaves this phone`,
        ),
      ).toBeTruthy();
      expect(screen.getByText("Cloud model service")).toBeTruthy();
      expect(screen.getByText(/Stronger results/)).toBeTruthy();
    });

    it("shows the download offer when the model is absent", async () => {
      mockModelPresence.mockReturnValue({ status: "absent" });

      await renderWithProviders(<SettingsScreen />);

      expect(screen.getByText("Download")).toBeTruthy();
      expect(
        screen.getByText(/A Wi-Fi connection is recommended/),
      ).toBeTruthy();
    });

    it("runs a download to completion and lands on the downloaded state", async () => {
      // Initial render: absent. After the download resolves, the presence
      // re-read reports present.
      mockModelPresence.mockReturnValue({ status: "absent" });
      mockDownloadModel.mockImplementation(async () => {
        mockModelPresence.mockReturnValue({ status: "present" });
      });

      await renderWithProviders(<SettingsScreen />);

      await press("Download");

      await waitFor(() => {
        expect(screen.getByText("Downloaded")).toBeTruthy();
      });
      expect(mockDownloadModel).toHaveBeenCalledTimes(1);
    });

    it("reports a failed download with the retry copy", async () => {
      mockModelPresence.mockReturnValue({ status: "absent" });
      mockDownloadModel.mockRejectedValue(new Error("network"));

      await renderWithProviders(<SettingsScreen />);

      await press("Download");

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
      await waitFor(() => {
        expect(screen.getByText("Download")).toBeTruthy();
      });
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
