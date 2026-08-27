import { describe, expect, it } from "@jest/globals";
import { screen } from "@testing-library/react-native";
import { Text } from "react-native";

import { FieldShell } from "@/components/FieldShell";
import { renderWithProviders } from "@/test-support/render";

describe("FieldShell", () => {
  it("renders its label and its control", async () => {
    await renderWithProviders(
      <FieldShell label="Account name">
        <Text>control</Text>
      </FieldShell>,
    );

    expect(screen.getByText("Account name")).toBeOnTheScreen();
    expect(screen.getByText("control")).toBeOnTheScreen();
  });

  // Both slots are optional: a caller may render a standalone heading, or a
  // control whose label lives on the control itself as an accessibilityLabel.
  it("renders a heading with no control", async () => {
    await renderWithProviders(<FieldShell label="Balances" />);

    expect(screen.getByText("Balances")).toBeOnTheScreen();
  });

  it("renders a control with no visible label", async () => {
    await renderWithProviders(
      <FieldShell>
        <Text>control</Text>
      </FieldShell>,
    );

    expect(screen.getByText("control")).toBeOnTheScreen();
  });

  it("marks a required field with an asterisk", async () => {
    await renderWithProviders(<FieldShell label="Account name" required />);

    expect(screen.getByText("*")).toBeOnTheScreen();
  });

  // The asterisk alone is silent to a screen reader, so the label carries the
  // word too.
  it("spells out required for a screen reader", async () => {
    await renderWithProviders(<FieldShell label="Account name" required />);

    expect(screen.getByLabelText(/Account name, .+/)).toBeOnTheScreen();
  });

  it("adds no required affordance by default", async () => {
    await renderWithProviders(<FieldShell label="Account name" />);

    expect(screen.queryByText("*")).toBeNull();
  });
});
