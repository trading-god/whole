import { describe, expect, it, jest } from "@jest/globals";
import { screen } from "@testing-library/react-native";

import { AccountRow } from "@/features/accounts/AccountRow";
import type { AssetAccount } from "@/features/assets/asset-schema";
import { ratesForBaseOnly } from "@/features/assets/currency-conversion";
import { renderWithProviders } from "@/test-support/render";

jest.mock("@/features/assets/asset-repository", () => ({
  sumBalancesByKindInCurrency: (
    accounts: { balances: { balance: number }[] }[],
  ) => ({
    total: accounts.reduce(
      (sum, account) =>
        sum +
        account.balances.reduce((subtotal, row) => subtotal + row.balance, 0),
      0,
    ),
  }),
}));

jest.mock("@/features/assets/asset-privacy-store", () => ({
  ASSET_AMOUNT_MASK: "****",
  maskAssetAmount: (balance: string, hidden: boolean) =>
    hidden ? "••••" : balance,
}));

// These tests exercise AccountRow's rendered semantics, not the native gesture
// recognizer. A minimal chainable surface keeps the row importable in jest-expo.
const mockGesture = {
  activeOffsetX: jest.fn(() => mockGesture),
  failOffsetY: jest.fn(() => mockGesture),
  onBegin: jest.fn(() => mockGesture),
  onUpdate: jest.fn(() => mockGesture),
  onEnd: jest.fn(() => mockGesture),
};

jest.mock("react-native-gesture-handler", () => {
  const { View } =
    jest.requireActual<typeof import("react-native")>("react-native");
  return {
    Gesture: {
      Pan: () => mockGesture,
      Race: () => mockGesture,
      Tap: () => mockGesture,
    },
    GestureDetector: View,
  };
});

jest.mock("react-native-reanimated", () => {
  const { View } =
    jest.requireActual<typeof import("react-native")>("react-native");
  return {
    __esModule: true,
    default: { View },
    Easing: { ease: "ease", out: (value: unknown) => value },
    useAnimatedReaction: jest.fn(),
    useAnimatedStyle: () => ({}),
    useSharedValue: (value: unknown) => ({ value }),
    withTiming: (value: unknown) => value,
  };
});

jest.mock("react-native-worklets", () => ({
  scheduleOnRN: (
    callback: (...args: unknown[]) => unknown,
    ...args: unknown[]
  ) => callback(...args),
}));

const account: AssetAccount = {
  id: "account-1",
  name: "Daily account",
  accountLastFourDigits: "1234",
  kind: "cash",
  balances: [{ balance: 1234.56, currency: "SGD" }],
};

const renderRow = (overrides: Partial<AssetAccount> = {}) =>
  renderWithProviders(
    <AccountRow
      account={{ ...account, ...overrides }}
      displayCurrency="SGD"
      rates={ratesForBaseOnly("SGD")}
      isBalanceHidden={false}
      isCompact={false}
      isFirst
      isActive={false}
      onActivate={jest.fn()}
      onOpenAccount={jest.fn()}
      onRemove={jest.fn()}
    />,
  );

describe("AccountRow", () => {
  it("renders initials and exposes the complete account summary", async () => {
    await renderRow();

    expect(
      screen.getByText("DA", { includeHiddenElements: true }),
    ).toBeOnTheScreen();
    const row = screen.getByRole("button", {
      name: "Daily account, **** 1234",
    });
    expect(row).toHaveAccessibilityValue({ text: "S$1,234.56, SGD" });
    expect(row.props.accessibilityHint).toBe("View account details");
  });

  it("announces liabilities with their signed balance", async () => {
    await renderRow({ balances: [{ balance: -200, currency: "SGD" }] });

    expect(
      screen.getByRole("button", { name: "Daily account, **** 1234" }),
    ).toHaveAccessibilityValue({ text: "-S$200.00, Owed SGD" });
  });

  it("falls back to the account name when no last four is stored", async () => {
    await renderRow({ accountLastFourDigits: undefined });

    expect(
      screen.getByRole("button", { name: "Daily account" }),
    ).toHaveAccessibilityValue({ text: "S$1,234.56, SGD" });
  });
});
