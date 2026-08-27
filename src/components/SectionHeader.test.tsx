import { describe, expect, it, jest } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";
import { Text } from "react-native";

import { SectionHeader } from "@/components/SectionHeader";

const mockUseResponsiveLayout = jest.fn();

jest.mock("@/theme/layout", () => ({
  useResponsiveLayout: () => mockUseResponsiveLayout(),
}));

const renderHeader = async (
  props: Parameters<typeof SectionHeader>[0],
  isCompact = false,
) => {
  mockUseResponsiveLayout.mockReturnValue({ isCompact });
  const { toJSON } = await render(<SectionHeader {...props} />);
  return toJSON() as unknown as { props: { style: Record<string, unknown>[] } };
};

const flexDirectionOf = (tree: {
  props: { style: Record<string, unknown>[] };
}) =>
  tree.props.style
    .filter(Boolean)
    .map((entry) => entry.flexDirection)
    .filter(Boolean)
    .at(-1);

describe("SectionHeader", () => {
  it("renders its title", async () => {
    await renderHeader({ title: "Accounts" });

    expect(screen.getByText("Accounts")).toBeOnTheScreen();
  });

  it("renders a detail slot beside the title", async () => {
    await renderHeader({ title: "Accounts", detail: <Text>3 total</Text> });

    expect(screen.getByText("3 total")).toBeOnTheScreen();
  });

  it("renders nothing extra when there is no detail", async () => {
    await renderHeader({ title: "Accounts" });

    expect(screen.queryByText("3 total")).toBeNull();
  });

  it("lays the header out in a row when there is room", async () => {
    const tree = await renderHeader({ title: "Accounts" });

    expect(flexDirectionOf(tree)).toBe("row");
  });

  // Two independent triggers: the caller can ask for the stacked treatment, and
  // a compact layout forces it regardless.
  it.each([
    ["the caller asks for it", { title: "Accounts", stacked: true }, false],
    ["the layout is compact", { title: "Accounts" }, true],
  ])("stacks when %s", async (_label, props, isCompact) => {
    const tree = await renderHeader(props, isCompact);

    expect(flexDirectionOf(tree)).toBe("column");
  });
});
