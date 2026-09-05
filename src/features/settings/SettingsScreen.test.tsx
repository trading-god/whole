import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";

import { SettingsScreen } from "@/features/settings/SettingsScreen";
import { renderWithProviders } from "@/test-support/render";
import { TONES } from "@/theme/tones";

const mockVerify = jest.fn<() => Promise<void>>();

jest.mock("@/features/on-device-model/model-context", () => ({
  verifyOnDeviceModel: () => mockVerify(),
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
});

// Labels are asserted in ENGLISH: `useLocales()` resolves to `en` under
// jest-expo, so that is the copy this suite actually renders.
describe("SettingsScreen", () => {
  it("describes the bundled model and the privacy promise", async () => {
    await renderWithProviders(<SettingsScreen />);

    expect(screen.getByText("Recognition runs on this device")).toBeTruthy();
    expect(
      screen.getByText(/Nothing about your accounts ever leaves this device/),
    ).toBeTruthy();
    // The card describes the model by name and size — the two things a user
    // weighing the storage cost can act on.
    expect(screen.getByText(/Gemma 4 E2B/)).toBeTruthy();
    expect(screen.getByText(/GB/)).toBeTruthy();
  });

  it("renders the privacy notice in the safe tone", async () => {
    await renderWithProviders(<SettingsScreen />);

    const notice = screen.getByTestId("on-device-notice");
    expect(notice.props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ backgroundColor: TONES.safe.surface }),
      ]),
    );
  });

  // The verdict is a line of text beside the button, and the button keeps its
  // label: a button that turns into "Working" for a moment reads as a switch.
  it("reports a passing model test beside the button", async () => {
    await renderWithProviders(<SettingsScreen />);

    await press("Test");

    await waitFor(() => {
      expect(screen.getByText("The on-device model is working")).toBeTruthy();
    });
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

  it("offers the display currency and the app version", async () => {
    await renderWithProviders(<SettingsScreen />);

    expect(screen.getByText("Display currency")).toBeTruthy();
    expect(screen.getByText(/^Version/)).toBeTruthy();
  });

  it("does not touch state after the screen is gone", async () => {
    // The load takes seconds, so a user can leave before it settles. Both the
    // verdict and the timer that expires it have to notice.
    let settle: () => void = () => {};
    mockVerify.mockReturnValue(
      new Promise<void>((resolve) => {
        settle = resolve;
      }),
    );

    const { unmount } = await renderWithProviders(<SettingsScreen />);
    await press("Test");
    unmount();

    // Only what the settled verdict does, so unrelated timers the renderer
    // armed while mounted are not counted.
    const armTimer = jest.spyOn(global, "setTimeout");
    settle();
    await act(async () => {});

    // Nothing is armed after the screen is gone, so nothing is left to call
    // `setTestPhase` on a component that no longer exists.
    expect(armTimer).not.toHaveBeenCalled();
    armTimer.mockRestore();
  });
});
