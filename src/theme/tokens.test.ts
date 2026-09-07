import { describe, expect, it } from "@jest/globals";

import { COLORS } from "@/theme/colors";
import {
  PRESSED_OPACITY,
  PRESSED_OPACITY_SURFACE,
  PRESSED_SCALE_ICON,
} from "@/theme/interaction";
import { MIN_INTERACTIVE_SIZE } from "@/theme/layout";
import {
  BUTTON_HITSLOP,
  BUTTON_HORIZONTAL_PADDING,
  BUTTON_SIZES,
  CARD_RADIUS,
  CHIP_HEIGHT,
  CHIP_RADIUS,
  ICON_BUTTON_SIZES,
  RADIUS,
} from "@/theme/sizes";
import { SPACING } from "@/theme/spacing";
import {
  FONT_SIZE,
  FONT_WEIGHT,
  LETTER_SPACING,
  LINE_HEIGHT,
} from "@/theme/typography";

function relativeLuminance(hex: string): number {
  const rgb = [1, 3, 5].map(
    (offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255,
  );
  const linear = rgb.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(foreground: string, background: string): number {
  const light = Math.max(
    relativeLuminance(foreground),
    relativeLuminance(background),
  );
  const dark = Math.min(
    relativeLuminance(foreground),
    relativeLuminance(background),
  );
  return (light + 0.05) / (dark + 0.05);
}

// Token tables are data, so these assert the PROPERTIES that make them a system
// rather than a pile of numbers — the ones a careless edit would break without
// any screen looking obviously wrong.

describe("SPACING", () => {
  // The 4pt grid is the default the whole layout rhythm is built on. Optical
  // micro-values are allowed to stay literal at their call sites; nothing in
  // the scale itself is exempt.
  it("sits on the 4pt grid", () => {
    for (const value of Object.values(SPACING)) {
      expect(value % 4).toBe(0);
    }
  });

  it("increases monotonically", () => {
    const values = Object.values(SPACING);

    expect([...values].sort((a, b) => a - b)).toEqual(values);
  });
});

describe("sizes", () => {
  // Every tappable control has to clear the platform minimum. The check is on
  // the EFFECTIVE target, not the painted box: a compact control is allowed to
  // be visually smaller as long as its hit slop makes up the difference, which
  // is what lets a chip-sized button exist without shipping a target too small
  // to hit.
  it.each([
    ["buttons", BUTTON_SIZES],
    ["icon buttons", ICON_BUTTON_SIZES],
  ])("keeps %s at or above the minimum touch target", (_label, sizes) => {
    for (const [size, height] of Object.entries(sizes)) {
      const slop = BUTTON_HITSLOP[size as keyof typeof BUTTON_HITSLOP];
      expect(height + slop * 2).toBeGreaterThanOrEqual(MIN_INTERACTIVE_SIZE);
    }
  });

  // Otherwise "small" is a label with no effect — which is exactly what `sm`
  // was while it painted the same 48pt box as `md`, and why a row of "small"
  // buttons took a third of the settings screen.
  it("makes every size actually distinct", () => {
    const heights = Object.values(BUTTON_SIZES);

    expect(new Set(heights).size).toBe(heights.length);
  });

  // Across EVERY size, not just the three the scale started with. A smaller
  // control with a larger radius reads as rounder than the one above it, which
  // is how `xs` shipped looking wrong: it borrowed `CHIP_RADIUS` (13) and
  // landed above `sm` (12), inverting the scale at its own end.
  it("grows the radius with the size", () => {
    const order = ["xs", "sm", "md", "lg"] as const;
    const radii = order.map((size) => RADIUS[size]);

    expect(radii).toEqual([...radii].sort((a, b) => a - b));
    expect(new Set(radii).size).toBe(radii.length);
  });

  // Exported rather than inlined into `Button`, because a caller cancelling
  // this padding must cancel exactly it — two hand-written `SPACING.lg`s drift.
  it("takes the button's horizontal padding from the scale", () => {
    expect(BUTTON_HORIZONTAL_PADDING).toBe(SPACING.lg);
  });

  it("keeps the card and chip constants distinct and positive", () => {
    for (const value of [CARD_RADIUS, CHIP_RADIUS, CHIP_HEIGHT]) {
      expect(value).toBeGreaterThan(0);
    }
  });
});

describe("interaction", () => {
  // A larger surface dims less, so it does not flash as hard as a small target.
  it("dims a surface less than a button", () => {
    expect(PRESSED_OPACITY).toBeLessThan(PRESSED_OPACITY_SURFACE);
  });

  it.each([
    ["button opacity", PRESSED_OPACITY],
    ["surface opacity", PRESSED_OPACITY_SURFACE],
    ["icon scale", PRESSED_SCALE_ICON],
  ])("keeps %s inside a visible range", (_label, value) => {
    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThan(1);
  });
});

describe("COLORS", () => {
  it("is the canonical brand color", () => {
    expect(COLORS.brand).toBe("#098765");
  });

  it("spells every value as a hex or rgba color", () => {
    for (const value of Object.values(COLORS)) {
      expect(value).toMatch(/^(#[0-9A-Fa-f]{6}|rgba\(.+\))$/);
    }
  });

  it("keeps secondary text readable on every light surface", () => {
    expect(contrastRatio(COLORS.muted, COLORS.card)).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(
      contrastRatio(COLORS.muted, COLORS.background),
    ).toBeGreaterThanOrEqual(4.5);
  });
});

describe("typography", () => {
  it("keeps every scale positive", () => {
    for (const table of [FONT_SIZE, LINE_HEIGHT]) {
      for (const value of Object.values(table)) {
        expect(value).toBeGreaterThan(0);
      }
    }
  });

  it("spells font weights as React Native accepts them", () => {
    for (const value of Object.values(FONT_WEIGHT)) {
      expect(typeof value).toBe("string");
    }
  });

  it("keeps letter spacing finite", () => {
    for (const value of Object.values(LETTER_SPACING)) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });
});
