import { describe, expect, it } from "@jest/globals";
import { render } from "@testing-library/react-native";
import type { ReactElement } from "react";

import { Icon, type IconName, type IconSize } from "@/components/Icon";
import { COLORS } from "@/theme/colors";

// The glyph itself comes from lucide; what this component owns is the NAME →
// glyph map and the two defaults, so that is what the cases below pin.
//
// Assertions read the RENDERED svg (`width`/`height`/`stroke`) rather than the
// props handed to lucide — that is what actually reaches the screen, and it
// survives lucide renaming its own prop surface.
const NAMES: IconName[] = [
  "plus",
  "eye",
  "eye-off",
  "trending-up",
  "trending-down",
  "chevron-down",
  "chevron-left",
  "chevron-right",
  "check",
  "arrow-up",
  "minus",
  "settings",
  "loader-circle",
];

const renderedSvg = async (element: ReactElement) => {
  const { toJSON } = await render(element);
  return toJSON() as unknown as {
    props: { width: number; height: number; stroke: string };
  };
};

describe("Icon", () => {
  it.each(NAMES)("renders the %s glyph", async (name) => {
    const { toJSON } = await render(<Icon name={name} />);

    expect(toJSON()).toBeTruthy();
  });

  it("defaults to the medium size and the ink color", async () => {
    const svg = await renderedSvg(<Icon name="check" />);

    expect(svg.props.width).toBe(20);
    expect(svg.props.stroke).toBe(COLORS.ink);
  });

  // Explicitly typed tuples rather than `as const`: Jest's `it.each` callback
  // takes mutable parameters, and a readonly tuple will not assign to them.
  it.each<[IconSize, number]>([
    ["sm", 16],
    ["md", 20],
    ["lg", 24],
  ])("maps the %s token to %ipt", async (token, expected) => {
    const svg = await renderedSvg(<Icon name="check" size={token} />);

    expect(svg.props.width).toBe(expected);
    expect(svg.props.height).toBe(expected);
  });

  // A number passes through untouched, for the handful of places calibrated
  // against surrounding type rather than the token scale.
  it("takes a raw number as a size", async () => {
    const svg = await renderedSvg(<Icon name="check" size={13} />);

    expect(svg.props.width).toBe(13);
  });

  it("takes an explicit color", async () => {
    const svg = await renderedSvg(<Icon name="check" color={COLORS.brand} />);

    expect(svg.props.stroke).toBe(COLORS.brand);
  });
});
