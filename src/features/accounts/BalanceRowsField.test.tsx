import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, screen } from "@testing-library/react-native";

import { BalanceRowsField } from "@/features/accounts/BalanceRowsField";
import { renderWithProviders } from "@/test-support/render";

const rows = [
  { id: 1, balance: "100", currency: "SGD" as const },
  { id: 2, balance: "200", currency: "USD" as const },
];

describe("BalanceRowsField", () => {
  it("renders compact destructive remove controls without overlapping currency taps", async () => {
    const onRemove = jest.fn();
    await renderWithProviders(
      <BalanceRowsField
        balanceRows={rows}
        onAdd={jest.fn()}
        onUpdate={jest.fn()}
        onRemove={onRemove}
      />,
    );

    const removeButtons = screen.getAllByRole("button", {
      name: "Remove this currency",
    });
    expect(removeButtons).toHaveLength(2);
    expect(removeButtons[0].props.hitSlop).toEqual({
      bottom: 7,
      left: 0,
      right: 14,
      top: 7,
    });

    await fireEvent.press(removeButtons[1]);
    expect(onRemove).toHaveBeenCalledWith(1);
  });

  it("keeps the only balance row non-removable", async () => {
    await renderWithProviders(
      <BalanceRowsField
        balanceRows={[rows[0]]}
        onAdd={jest.fn()}
        onUpdate={jest.fn()}
        onRemove={jest.fn()}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Remove this currency" }),
    ).toBeNull();
  });
});
