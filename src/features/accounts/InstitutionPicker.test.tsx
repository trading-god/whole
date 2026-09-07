import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";

import { InstitutionPicker } from "@/features/accounts/InstitutionPicker";
import { deferred } from "@/test-support/deferred";
import { renderWithProviders } from "@/test-support/render";

const mockUseResponsiveLayout = jest.fn(() => ({ isCompact: false }));

jest.mock("@/theme/layout", () => ({
  MIN_INTERACTIVE_SIZE: 48,
  useResponsiveLayout: () => mockUseResponsiveLayout(),
}));

const institutions = [
  {
    id: "group-1",
    name: "DBS",
  },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockUseResponsiveLayout.mockReturnValue({ isCompact: false });
});

describe("InstitutionPicker", () => {
  it("exposes a 48pt trigger and its expanded state", async () => {
    const { toJSON } = await renderWithProviders(
      <InstitutionPicker
        institutions={institutions}
        selectedInstitutionId=""
        onChange={jest.fn()}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Institution" });
    expect(trigger.props.accessibilityState).toEqual({ expanded: false });
    expect(JSON.stringify(toJSON())).toContain('"minHeight":48');

    await fireEvent.press(trigger);

    expect(
      screen.getByRole("button", { name: "Institution" }).props
        .accessibilityState,
    ).toEqual({ expanded: true });
  });

  it("guards creation with a loading state and selects the new institution once", async () => {
    const pending = deferred<string | undefined>();
    const onCreate = jest.fn(() => pending.promise);
    const onChange = jest.fn();
    await renderWithProviders(
      <InstitutionPicker
        institutions={institutions}
        selectedInstitutionId=""
        onChange={onChange}
        onCreate={onCreate}
      />,
    );

    await fireEvent.press(screen.getByRole("button", { name: "Institution" }));
    await fireEvent.press(
      screen.getByRole("button", { name: "Create institution" }),
    );
    await fireEvent.changeText(
      screen.getByLabelText("Institution name"),
      "  OCBC  ",
    );

    const createLabel = screen.getByText("Create institution");
    await fireEvent.press(createLabel);

    expect(onCreate).toHaveBeenCalledWith("OCBC");
    expect(screen.getByTestId("button-spinner")).toBeOnTheScreen();
    expect(createLabel.parent?.props.accessibilityState).toEqual({
      busy: true,
      disabled: true,
    });
    await fireEvent.press(createLabel.parent!);
    expect(onCreate).toHaveBeenCalledTimes(1);

    await act(() => {
      pending.resolve("group-2");
    });

    expect(onChange).toHaveBeenCalledWith("group-2");
  });

  it("says so when creating the institution fails, and keeps the typed name", async () => {
    const onCreate = jest.fn(() => Promise.reject(new Error("write failed")));
    const onChange = jest.fn();
    await renderWithProviders(
      <InstitutionPicker
        institutions={institutions}
        selectedInstitutionId=""
        onChange={onChange}
        onCreate={onCreate}
      />,
    );

    await fireEvent.press(screen.getByRole("button", { name: "Institution" }));
    await fireEvent.press(
      screen.getByRole("button", { name: "Create institution" }),
    );
    await fireEvent.changeText(
      screen.getByLabelText("Institution name"),
      "OCBC",
    );
    await fireEvent.press(screen.getByText("Create institution"));

    await waitFor(() => {
      expect(
        screen.getByText("Couldn't create the institution. Try again."),
      ).toBeOnTheScreen();
    });
    // Nothing was written, so nothing is selected and the sheet stays open on
    // what the user typed — closing would read as success.
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("OCBC")).toBeOnTheScreen();
  });
});
