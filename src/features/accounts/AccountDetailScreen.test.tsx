import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";

import AccountDetailScreen from "@/features/accounts/AccountDetailScreen";
import { deferred } from "@/test-support/deferred";
import { renderWithProviders } from "@/test-support/render";

const mockListAssetAccounts = jest.fn<() => Promise<unknown[]>>();
const mockListAssetAccountGroups = jest.fn<() => Promise<unknown[]>>();
const mockUpdateAssetAccount = jest.fn<() => Promise<{ ok: true }>>();
const mockInvalidateAccounts = jest.fn<() => Promise<void>>();
const mockReturnToOverview = jest.fn();

jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({}),
}));

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: "account-1" }),
}));

jest.mock("@/lib/useReturnToOverview", () => ({
  useReturnToOverview: () => mockReturnToOverview,
}));

jest.mock("@/features/assets/accounts-query", () => ({
  invalidateAccounts: () => mockInvalidateAccounts(),
}));

jest.mock("@/features/assets/asset-repository", () => ({
  listAssetAccounts: () => mockListAssetAccounts(),
  listAssetAccountGroups: () => mockListAssetAccountGroups(),
  updateAssetAccount: () => mockUpdateAssetAccount(),
  findOrCreateGroupByName: jest.fn(),
}));

jest.mock("@/features/accounts/AccountScreenshotUploader", () => {
  const { Text } = jest.requireActual(
    "react-native",
  ) as typeof import("react-native");
  return {
    AccountScreenshotUploader: () => <Text>Screenshot uploader</Text>,
  };
});

jest.mock("@/features/accounts/AccountEditorFields", () => {
  const { Text } = jest.requireActual(
    "react-native",
  ) as typeof import("react-native");
  return {
    AccountEditorFields: () => <Text>Account fields</Text>,
  };
});

jest.mock("@/features/accounts/SourceImageCleanupModal", () => ({
  SourceImageCleanupModal: () => null,
}));

const account = {
  id: "account-1",
  name: "Everyday Account",
  accountLastFourDigits: "1234",
  balances: [{ balance: 100, currency: "SGD" }],
  kind: "cash",
};

beforeEach(() => {
  jest.clearAllMocks();
  mockListAssetAccounts.mockResolvedValue([account]);
  mockListAssetAccountGroups.mockResolvedValue([]);
  mockUpdateAssetAccount.mockResolvedValue({ ok: true });
  mockInvalidateAccounts.mockResolvedValue(undefined);
});

describe("AccountDetailScreen", () => {
  it("uses the shared spinner while loading", async () => {
    mockListAssetAccounts.mockReturnValue(new Promise(() => undefined));
    mockListAssetAccountGroups.mockReturnValue(new Promise(() => undefined));

    await renderWithProviders(<AccountDetailScreen />);

    expect(screen.getByTestId("spinner")).toBeOnTheScreen();
  });

  it("keeps Save changes visible and guards duplicate saves", async () => {
    const pending = deferred<{ ok: true }>();
    mockUpdateAssetAccount.mockReturnValue(pending.promise);
    await renderWithProviders(<AccountDetailScreen />);
    await waitFor(() => {
      expect(screen.getByText("Everyday Account")).toBeOnTheScreen();
    });

    const saveLabel = screen.getByText("Save changes");
    await fireEvent.press(saveLabel);

    expect(screen.getByTestId("button-spinner")).toBeOnTheScreen();
    expect(saveLabel.parent?.props.accessibilityState).toEqual({
      busy: true,
      disabled: true,
    });
    await fireEvent.press(saveLabel.parent!);
    expect(mockUpdateAssetAccount).toHaveBeenCalledTimes(1);

    await act(() => {
      pending.resolve({ ok: true });
    });

    expect(mockReturnToOverview).toHaveBeenCalledTimes(1);
  });
});
