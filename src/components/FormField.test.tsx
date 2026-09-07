import { describe, expect, it, jest } from "@jest/globals";
import { screen } from "@testing-library/react-native";

import { FormField } from "@/components/FormField";
import { renderWithProviders } from "@/test-support/render";

describe("FormField", () => {
  it("passes credential semantics to the native input", async () => {
    await renderWithProviders(
      <FormField
        accessibilityLabel="API key"
        autoComplete="off"
        onChangeText={jest.fn()}
        placeholder="sk-…"
        secureTextEntry
        textContentType="password"
        value="secret"
      />,
    );

    expect(screen.getByLabelText("API key").props).toMatchObject({
      autoComplete: "off",
      secureTextEntry: true,
      textContentType: "password",
    });
  });
});
