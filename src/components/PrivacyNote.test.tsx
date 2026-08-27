import { describe, expect, it } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";

import { PrivacyNote } from "@/components/PrivacyNote";

describe("PrivacyNote", () => {
  it("renders the reassurance message", async () => {
    await render(
      <PrivacyNote message="Screenshots never leave your device." />,
    );

    expect(
      screen.getByText("Screenshots never leave your device."),
    ).toBeOnTheScreen();
  });
});
