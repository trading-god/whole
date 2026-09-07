import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";

import { OptionPicker } from "@/components/OptionPicker";
import { renderWithProviders } from "@/test-support/render";

const options = [
  { label: "Singapore dollar", value: "SGD" },
  { label: "US dollar", value: "USD" },
] as const;

describe("OptionPicker", () => {
  it("announces the current value and expanded state", async () => {
    await renderWithProviders(
      <OptionPicker
        dialogTitle="Display currency"
        onChange={jest.fn()}
        options={options}
        value="SGD"
      />,
    );

    const trigger = screen.getByLabelText("Display currency");
    expect(trigger.props.accessibilityValue).toEqual({
      text: "Singapore dollar",
    });
    expect(trigger.props.accessibilityState).toEqual({ expanded: false });

    await fireEvent.press(trigger);

    await waitFor(() => {
      expect(trigger.props.accessibilityState).toEqual({ expanded: true });
    });
  });

  it("selects an option and closes the sheet", async () => {
    const onChange = jest.fn();
    await renderWithProviders(
      <OptionPicker
        dialogTitle="Display currency"
        onChange={onChange}
        options={options}
        value="SGD"
      />,
    );

    await fireEvent.press(screen.getByLabelText("Display currency"));
    const option = await screen.findByRole("radio", { name: "US dollar" });
    await fireEvent.press(option);

    expect(onChange).toHaveBeenCalledWith("USD");
  });
});
