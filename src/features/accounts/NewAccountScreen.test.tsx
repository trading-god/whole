import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, screen } from "@testing-library/react-native";

import NewAccountScreen from "@/features/accounts/NewAccountScreen";
import { deferred } from "@/test-support/deferred";
import { renderWithProviders } from "@/test-support/render";

type SavedAccount = { name: string; groupId?: string };

const mockUpsertAssetAccounts =
  jest.fn<(accounts: SavedAccount[]) => Promise<void>>();
const mockFindOrCreateGroupByName =
  jest.fn<(name: string) => Promise<{ id: string; name: string }>>();
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
  findOrCreateGroupByName: (name: string) => mockFindOrCreateGroupByName(name),
  hasDuplicateAccountKeys: () => false,
  upsertAssetAccounts: (accounts: SavedAccount[]) =>
    mockUpsertAssetAccounts(accounts),
}));

// The uploader stands in for the picker and the recognizer: pressing it hands
// the screen a BATCH of outcomes, one per screenshot, exactly as a real
// multi-select pick would. That is the seam the batch flow has to be driven
// from — everything below it (the image picker, OCR, the model) is native.
jest.mock("@/features/accounts/AccountScreenshotUploader", () => {
  const { Text } = jest.requireActual(
    "react-native",
  ) as typeof import("react-native");
  return {
    AccountScreenshotUploader: ({
      onRecognized,
    }: {
      onRecognized: (outcomes: unknown[]) => unknown;
    }) => (
      <Text
        accessibilityRole="button"
        onPress={() =>
          void onRecognized([
            {
              accounts: [
                {
                  accountName: "Multiplier",
                  balances: [{ currency: "SGD", balance: 100 }],
                  kind: "cash",
                  institutionId: "dbs",
                },
              ],
              institutionId: "dbs",
              issue: null,
            },
            {
              // An institution no config knows: the engine could not place it,
              // so the only name there is is the one the MODEL answered — which
              // is exactly what a batch made the app start reading.
              accounts: [
                {
                  accountName: "Total Checking",
                  balances: [{ currency: "USD", balance: 200 }],
                  kind: "cash",
                  institutionId: "unknown",
                },
              ],
              institutionId: "unknown",
              institutionName: "Chase",
              issue: null,
            },
          ])
        }
      >
        Recognize two screenshots
      </Text>
    ),
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
  mockFindOrCreateGroupByName.mockImplementation((name) =>
    Promise.resolve({ id: `group-${name}`, name }),
  );
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

  // The point of the batch: two screenshots from two institutions become two
  // accounts filed under two groups. A single institution field above the
  // wizard could only ever have been right for one of them, which is why the
  // institution moved onto the draft.
  it("files each screenshot's accounts under its own institution", async () => {
    await renderWithProviders(<NewAccountScreen />);

    await fireEvent.press(screen.getByText("Recognize two screenshots"));
    await fireEvent.press(screen.getByText("Save all"));

    // One resolve per distinct NAME, not per account: a five-account
    // screenshot would otherwise create the same group five times, racing its
    // own findOrCreate.
    expect(
      mockFindOrCreateGroupByName.mock.calls.map(([name]) => name),
    ).toEqual(["DBS", "Chase"]);
    expect(
      mockUpsertAssetAccounts.mock.calls[0]?.[0].map((account) => [
        account.name,
        account.groupId,
      ]),
    ).toEqual([
      ["Multiplier", "group-DBS"],
      ["Total Checking", "group-Chase"],
    ]);
  });
});
