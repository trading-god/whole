import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, screen } from "@testing-library/react-native";

import OnboardingScreen from "@/features/onboarding/OnboardingScreen";
import { deferred } from "@/test-support/deferred";
import { renderWithProviders } from "@/test-support/render";

const mockReplace = jest.fn();
const mockComplete = jest.fn();
const mockMarkOnboardingCompleted = jest.fn<() => Promise<void>>();
const mockSaveUserName = jest.fn<(name: string) => Promise<void>>();

jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

jest.mock("@/features/onboarding/onboarding-context", () => ({
  useCompleteOnboarding: () => mockComplete,
}));

jest.mock("@/features/onboarding/onboarding-store", () => ({
  markOnboardingCompleted: () => mockMarkOnboardingCompleted(),
}));

jest.mock("@/features/user/user-store", () => {
  const { z } = jest.requireActual("zod") as typeof import("zod");
  return {
    USER_NAME_MAX_LENGTH: 30,
    userNameSchema: z.string().trim().min(1).max(30),
    saveUserName: (name: string) => mockSaveUserName(name),
  };
});

beforeEach(() => {
  jest.clearAllMocks();
  mockMarkOnboardingCompleted.mockResolvedValue(undefined);
  mockSaveUserName.mockResolvedValue(undefined);
});

describe("OnboardingScreen", () => {
  it("configures the optional name for keyboard autofill", async () => {
    await renderWithProviders(<OnboardingScreen />);

    const name = screen.getByLabelText("Name");
    expect(name.props.autoComplete).toBe("name");
    expect(name.props.textContentType).toBe("name");
  });

  it("keeps the finish action visible and guards duplicate completion", async () => {
    const pending = deferred<void>();
    mockMarkOnboardingCompleted.mockReturnValue(pending.promise);
    await renderWithProviders(<OnboardingScreen />);

    const finishLabel = screen.getByText("Get started");
    await fireEvent.press(finishLabel);

    expect(screen.getByTestId("button-spinner")).toBeOnTheScreen();
    expect(finishLabel.parent?.props.accessibilityState).toEqual({
      busy: true,
      disabled: true,
    });
    await fireEvent.press(finishLabel.parent!);
    expect(mockMarkOnboardingCompleted).toHaveBeenCalledTimes(1);

    await act(() => {
      pending.resolve();
    });

    expect(mockComplete).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith("/");
  });
});
