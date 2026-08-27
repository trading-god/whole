import { describe, expect, it, jest } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";
import { Text } from "react-native";

import { ButtonGroup } from "@/components/ButtonGroup";

// Compactness is decided by `useResponsiveLayout`, which this suite drives
// directly — the layout rule itself is covered in `theme/layout.test.ts`.
const mockUseResponsiveLayout = jest.fn();

jest.mock("@/theme/layout", () => ({
  useResponsiveLayout: () => mockUseResponsiveLayout(),
}));

const renderGroup = async (isCompact: boolean) => {
  mockUseResponsiveLayout.mockReturnValue({ isCompact });
  const { toJSON } = await render(
    <ButtonGroup>
      <Text>Cancel</Text>
      <Text>Save</Text>
    </ButtonGroup>,
  );
  return toJSON() as unknown as { props: { style: Record<string, unknown>[] } };
};

describe("ButtonGroup", () => {
  it("renders every action", async () => {
    await renderGroup(false);

    expect(screen.getByText("Cancel")).toBeOnTheScreen();
    expect(screen.getByText("Save")).toBeOnTheScreen();
  });

  it("keeps actions side by side when there is room", async () => {
    const tree = await renderGroup(false);

    expect(tree.props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ flexDirection: "row" }),
      ]),
    );
  });

  // Every localized label gets the full row in a compact layout or at a larger
  // accessibility font size — a stacked column, not a squeezed row.
  it("stacks actions in a compact layout", async () => {
    const tree = await renderGroup(true);

    expect(tree.props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ flexDirection: "column" }),
      ]),
    );
  });
});
