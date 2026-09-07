import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, screen } from "@testing-library/react-native";

import { AccountGroupRow } from "@/features/accounts/AccountGroupRow";
import type {
  AssetAccount,
  AssetAccountGroup,
} from "@/features/assets/asset-schema";
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

const group: AssetAccountGroup = { id: "group-1", name: "Harbour Bank" };
const accounts: AssetAccount[] = [
  {
    id: "account-1",
    name: "Daily account",
    kind: "cash",
    balances: [{ balance: 1234.56, currency: "SGD" }],
    groupId: group.id,
  },
  {
    id: "account-2",
    name: "Card",
    kind: "cash",
    balances: [{ balance: -200, currency: "SGD" }],
    groupId: group.id,
  },
];

const renderRow = async (
  props: Partial<Parameters<typeof AccountGroupRow>[0]> = {},
) => {
  const onToggle = jest.fn();
  await renderWithProviders(
    <AccountGroupRow
      group={group}
      accounts={accounts}
      displayCurrency="SGD"
      rates={ratesForBaseOnly("SGD")}
      isBalanceHidden={false}
      isExpanded
      onToggle={onToggle}
      isCompact={false}
      isFirst
      {...props}
    />,
  );
  return onToggle;
};

describe("AccountGroupRow", () => {
  it("exposes the group name, count, total, and expanded state", async () => {
    await renderRow();

    const row = screen.getByRole("button", { name: "Harbour Bank" });
    expect(row).toHaveAccessibilityValue({ text: "2 accounts, S$1,034.56" });
    expect(row.props.accessibilityState).toEqual({ expanded: true });
    expect(row.props.accessibilityHint).toBe("Collapse institution");
  });

  it("exposes its collapsed state and toggles when pressed", async () => {
    const onToggle = await renderRow({ isExpanded: false });
    const row = screen.getByRole("button", { name: "Harbour Bank" });

    expect(row.props.accessibilityState).toEqual({ expanded: false });
    expect(row.props.accessibilityHint).toBe("Expand institution");
    await fireEvent.press(row);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("keeps the hidden total in the accessibility value", async () => {
    await renderRow({ isBalanceHidden: true });

    expect(
      screen.getByRole("button", { name: "Harbour Bank" }),
    ).toHaveAccessibilityValue({ text: "2 accounts, ••••" });
  });
});
