import { describe, expect, it } from "@jest/globals";
import { Platform } from "react-native";

import {
  BUTTON_VARIANTS,
  type ButtonVariant,
  DISABLED_BUTTON,
  buttonContainerStyle,
} from "@/components/button-variants";
import { COLORS } from "@/theme/colors";

const VARIANTS = Object.keys(BUTTON_VARIANTS) as ButtonVariant[];

// `Button` and `IconButton` both derive their appearance from this table, so a
// variant that is incomplete here is incomplete in two components at once.
describe("BUTTON_VARIANTS", () => {
  it.each(VARIANTS)("gives %s a full appearance", (variant) => {
    const style = BUTTON_VARIANTS[variant];

    expect(style.backgroundColor).toBeTruthy();
    expect(style.labelColor).toBeTruthy();
    expect(style.iconColor).toBeTruthy();
    expect(style.pressedStyle).toBeTruthy();
  });

  // Filled variants dim on press so the fill stays recognizable; the
  // transparent ones float a wash instead, because dimming nothing reads as
  // nothing happening.
  it.each(["primary", "secondary", "danger"] as const)(
    "dims %s on press",
    (variant) => {
      expect(BUTTON_VARIANTS[variant].pressedStyle.opacity).toBeDefined();
    },
  );

  it.each(["outline", "ghost", "onDark"] as const)(
    "floats a wash under %s on press",
    (variant) => {
      expect(BUTTON_VARIANTS[variant].backgroundColor).toBe("transparent");
      expect(
        BUTTON_VARIANTS[variant].pressedStyle.backgroundColor,
      ).toBeTruthy();
    },
  );

  // `brand` only reaches 2.7:1 against `brandDark`, so the dark-surface variant
  // has to use the accent instead. Pinned because the two look similar enough
  // in a diff to be "simplified" back into one.
  it("tints the dark-surface variant with the accent, not the brand", () => {
    expect(BUTTON_VARIANTS.onDark.iconColor).toBe(COLORS.accentOnDark);
    expect(BUTTON_VARIANTS.onDark.iconColor).not.toBe(COLORS.brand);
  });

  it("is the only variant with a border", () => {
    const bordered = VARIANTS.filter((v) => BUTTON_VARIANTS[v].border);

    expect(bordered).toEqual(["outline"]);
  });
});

describe("DISABLED_BUTTON", () => {
  it("is a neutral fill with no border", () => {
    expect(DISABLED_BUTTON.backgroundColor).toBe(COLORS.disabledBg);
    expect(DISABLED_BUTTON.labelColor).toBe(COLORS.disabledText);
    expect(DISABLED_BUTTON.border).toBeUndefined();
  });
});

describe("buttonContainerStyle", () => {
  const base = { elevated: false, disabled: false };

  it("carries the background through", () => {
    expect(
      buttonContainerStyle({ backgroundColor: COLORS.brand }, base),
    ).toMatchObject({ backgroundColor: COLORS.brand });
  });

  it("spreads a border into React Native's own props", () => {
    expect(
      buttonContainerStyle(
        {
          backgroundColor: "transparent",
          border: { color: COLORS.outlineBorder, width: 1 },
        },
        base,
      ),
    ).toMatchObject({
      borderColor: COLORS.outlineBorder,
      borderWidth: 1,
    });
  });

  // The border is always DRAWN, transparent when the variant has none — so a
  // control keeps its size across every appearance it can take.
  //
  // React Native lays an auto-width element out as content + padding + border,
  // so a variant that omits the border is 2pt narrower than one that draws it.
  // That is invisible until something toggles between them, and then the
  // control visibly jumps: a preset chip going from outline to primary on
  // selection, or an outline button shrinking the moment it goes disabled.
  it("still reserves the border when the variant has none", () => {
    const style = buttonContainerStyle({ backgroundColor: COLORS.brand }, base);

    expect(style.borderWidth).toBe(1);
    expect(style.borderColor).toBe("transparent");
  });

  it("gives every variant the same border width", () => {
    const widths = VARIANTS.map(
      (variant) =>
        buttonContainerStyle(BUTTON_VARIANTS[variant], base).borderWidth,
    );

    expect(new Set(widths).size).toBe(1);
  });

  // The same control, enabled and disabled, must not change size either.
  it("keeps the border width across the disabled swap", () => {
    const enabled = buttonContainerStyle(BUTTON_VARIANTS.outline, base);
    const disabled = buttonContainerStyle(DISABLED_BUTTON, {
      elevated: false,
      disabled: true,
    });

    expect(disabled.borderWidth).toBe(enabled.borderWidth);
  });

  it("adds the elevated shadow when asked", () => {
    const style = buttonContainerStyle(
      { backgroundColor: COLORS.brand },
      { elevated: true, disabled: false },
    );

    // Each platform expresses elevation its own way; both mean "raised".
    expect(
      Platform.OS === "android" ? style.elevation : style.shadowOpacity,
    ).toBeDefined();
  });

  // A disabled control is not raised: the shadow would promise a press the
  // button will not accept.
  it("drops the shadow while disabled", () => {
    const style = buttonContainerStyle(
      { backgroundColor: COLORS.disabledBg },
      { elevated: true, disabled: true },
    );

    expect(style.elevation).toBeUndefined();
    expect(style.shadowOpacity).toBeUndefined();
  });
});
