import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, screen } from "@testing-library/react-native";

import NewAccountScreen from "@/features/accounts/NewAccountScreen";
import { deferred } from "@/test-support/deferred";
import { renderWithProviders } from "@/test-support/render";

const mockUpsertAssetAccounts = jest.fn<() => Promise<void>>();
const mockInvalidateAccounts = jest.fn<() => Promise<void>>();
const mockReturnToOverview = jest.fn();

jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({}),
}));

jest.mock("@/lib/useReturnToOverview", () => ({
  useReturnToOverview: () => mockReturnToOverview,
}));

jest.mock("@/features/assets/accounts-query", () => ({
  invalidateAccounts: () => mockInvalidateAccounts(),
}));

jest.mock("@/features/assets/asset-repository", () => ({
  listAssetAccountGroups: () => Promise.resolve([]),
  findOrCreateGroupByName: jest.fn(),
  hasDuplicateAccountKeys: () => false,
  upsertAssetAccounts: () => mockUpsertAssetAccounts(),
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
    AccountEditorFields: ({
      onChange,
      index,
    }: {
      onChange: Function;
      index: number;
    }) => (
      <Text
        accessibilityRole="button"
        onPress={() =>
          onChange(
            (previous: object) => ({
              ...previous,
              name: "Everyday Account",
              balances: [{ id: 1, balance: "100", currency: "SGD" }],
            }),
            index,
          )
        }
      >
        Fill valid account
      </Text>
    ),
  };
});

jest.mock("@/features/accounts/SourceImageCleanupModal", () => ({
  SourceImageCleanupModal: () => null,
}));

jest.mock("@/features/accounts/SwipePager", () => ({
  SwipePager: () => null,
}));

jest.mock("@/features/accounts/WizardNav", () => ({
  WizardNav: () => null,
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockUpsertAssetAccounts.mockResolvedValue(undefined);
  mockInvalidateAccounts.mockResolvedValue(undefined);
});

describe("NewAccountScreen", () => {
  it("keeps Save account visible and guards duplicate saves", async () => {
    const pending = deferred<void>();
    mockUpsertAssetAccounts.mockReturnValue(pending.promise);
    await renderWithProviders(<NewAccountScreen />);

    await fireEvent.press(screen.getByText("Fill valid account"));
    const saveLabel = screen.getByText("Save account");
    await fireEvent.press(saveLabel);

    expect(screen.getByTestId("button-spinner")).toBeOnTheScreen();
    expect(saveLabel.parent?.props.accessibilityState).toEqual({
      busy: true,
      disabled: true,
    });
    await fireEvent.press(saveLabel.parent!);
    expect(mockUpsertAssetAccounts).toHaveBeenCalledTimes(1);

    await act(() => {
      pending.resolve();
    });

    expect(mockReturnToOverview).toHaveBeenCalledTimes(1);
  });
});
