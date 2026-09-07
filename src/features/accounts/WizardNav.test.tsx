import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { WizardNav } from "@/features/accounts/WizardNav";

jest.mock("@/features/accounts/StepIndicator", () => {
  const { Text } = jest.requireActual(
    "react-native",
  ) as typeof import("react-native");
  return {
    StepIndicator: ({ count, current }: { count: number; current: number }) => (
      <Text>{`${current + 1}/${count}`}</Text>
    ),
  };
});

describe("WizardNav", () => {
  it("renders navigation callbacks around the centered position", async () => {
    const onBack = jest.fn();
    const onNext = jest.fn();
    await render(
      <WizardNav
        count={3}
        current={1}
        backLabel="Previous account"
        nextLabel="Next account"
        onBack={onBack}
        onNext={onNext}
      />,
    );

    await fireEvent.press(
      screen.getByRole("button", { name: "Previous account" }),
    );
    await fireEvent.press(screen.getByRole("button", { name: "Next account" }));

    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(screen.getByText("2/3")).toBeOnTheScreen();
  });

  it("uses the shared spinner in place of the busy next action", async () => {
    await render(
      <WizardNav
        count={3}
        current={1}
        backLabel="Previous account"
        nextLabel="Next account"
        nextBusy
        onBack={jest.fn()}
        onNext={jest.fn()}
      />,
    );

    expect(screen.getByTestId("spinner")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Next account" })).toBeNull();
  });
});
