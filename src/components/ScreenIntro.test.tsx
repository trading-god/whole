import { describe, expect, it } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";

import { ScreenIntro } from "@/components/ScreenIntro";

describe("ScreenIntro", () => {
  it("renders the title and the subtitle", async () => {
    await render(
      <ScreenIntro title="Add account" subtitle="From a screenshot" />,
    );

    expect(screen.getByText("Add account")).toBeOnTheScreen();
    expect(screen.getByText("From a screenshot")).toBeOnTheScreen();
  });
});
