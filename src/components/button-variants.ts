import { type ViewStyle } from "react-native";

import { COLORS } from "@/theme/colors";
import { PRESSED_OPACITY } from "@/theme/interaction";
import { ELEVATED_SHADOW } from "@/theme/shadow";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "danger"
  | "dangerGhost"
  | "dangerOutline"
  | "outline"
  | "ghost"
  | "onDark";

type ButtonVariantStyle = {
  /** The container fill. */
  backgroundColor: string;
  /** The hairline; absent means no border, and disabled never draws one. */
  border?: { color: string; width: number };
  /** The label colour. */
  labelColor: string;
  /** The icon colour. */
  iconColor: string;
  /** The pressed-state feedback, layered over the container. */
  pressedStyle: ViewStyle;
};

/**
 * The whole design language of each variant: fill, border, label/icon colour,
 * pressed feedback. `Button` and `IconButton` read the same table, which is
 * what keeps the two consistent at the component-library level.
 *
 * - `primary` / `secondary` / `danger` — filled; pressing lowers the opacity
 *   so the fill is still readable. `danger` is for destructive actions (clear,
 *   delete), and its white-on-red carries the same weight as `primary`.
 * - `dangerGhost` — the low-emphasis destructive twin: danger ink without a
 *   filled red block competing with the primary action beside it.
 * - `dangerOutline` — the destructive twin of `outline`: the same hairline
 *   shape, danger ink on the border and label, for a destructive action that
 *   must sit in a row of outline buttons and still be told apart from them
 *   at a glance (delete-model beside test, remove-service beside save).
 * - `outline` — transparent over a hairline; pressing floats a pale fill in,
 *   which is what makes the press legible without a colour to dim.
 * - `ghost` — text only; pressing floats a soft brand-tinted fill in.
 * - `onDark` — the ghost for a dark surface. The icon tint is `accentOnDark`
 *   because `brand` on `brandDark` only reaches 2.7:1.
 */
export const BUTTON_VARIANTS: Record<ButtonVariant, ButtonVariantStyle> = {
  primary: {
    backgroundColor: COLORS.brand,
    labelColor: COLORS.white,
    iconColor: COLORS.white,
    pressedStyle: { opacity: PRESSED_OPACITY },
  },
  secondary: {
    backgroundColor: COLORS.secondaryFill,
    labelColor: COLORS.secondaryInk,
    iconColor: COLORS.secondaryInk,
    pressedStyle: { opacity: PRESSED_OPACITY },
  },
  danger: {
    backgroundColor: COLORS.danger,
    labelColor: COLORS.white,
    iconColor: COLORS.white,
    pressedStyle: { opacity: PRESSED_OPACITY },
  },
  dangerGhost: {
    backgroundColor: "transparent",
    labelColor: COLORS.danger,
    iconColor: COLORS.danger,
    pressedStyle: { backgroundColor: COLORS.surfaceMuted },
  },
  dangerOutline: {
    backgroundColor: "transparent",
    border: { color: COLORS.danger, width: 1 },
    labelColor: COLORS.danger,
    iconColor: COLORS.danger,
    pressedStyle: { backgroundColor: COLORS.surfaceMuted },
  },
  outline: {
    backgroundColor: "transparent",
    border: { color: COLORS.outlineBorder, width: 1 },
    labelColor: COLORS.ink,
    iconColor: COLORS.ink,
    pressedStyle: { backgroundColor: COLORS.surfaceMuted },
  },
  ghost: {
    backgroundColor: "transparent",
    labelColor: COLORS.brand,
    iconColor: COLORS.brand,
    pressedStyle: { backgroundColor: COLORS.brandSoft },
  },
  onDark: {
    backgroundColor: "transparent",
    labelColor: COLORS.accentOnDark,
    iconColor: COLORS.accentOnDark,
    pressedStyle: { backgroundColor: COLORS.accentOnDarkSoft },
  },
};

/**
 * The one disabled appearance every variant collapses to: a neutral grey fill
 * and grey label. The border goes transparent but keeps its place (see
 * `buttonContainerStyle`) — dropping it would shrink an outline button by 2pt
 * the moment it greys out. `Button` and `IconButton` both read it here, the
 * same way they read the table above.
 */
// One hairline for every variant, drawn or not — see `buttonContainerStyle`.
const BORDER_WIDTH = 1;

export const DISABLED_BUTTON: Omit<ButtonVariantStyle, "pressedStyle"> = {
  backgroundColor: COLORS.disabledBg,
  labelColor: COLORS.disabledText,
  iconColor: COLORS.disabledText,
};

// Container base fragment — background, border, and (optional) elevated
// shadow — shared by `Button` and `IconButton`. Each component spreads this
// under its own size/layout fields so the disabled/border/shadow rendering
// path lives in one place instead of being copied across both components.
// `disabled` is the value that downgrades the visual (Button passes
// `visuallyDisabled` so loading keeps the variant appearance; IconButton has
// no loading state and passes `disabled` directly).
export function buttonContainerStyle(
  visual: Pick<ButtonVariantStyle, "backgroundColor" | "border">,
  { elevated, disabled }: { elevated: boolean; disabled: boolean },
): ViewStyle {
  return {
    backgroundColor: visual.backgroundColor,
    // The border is ALWAYS drawn, transparent when the variant has none.
    //
    // React Native lays an auto-width control out as content + padding +
    // border, so omitting the border made a variant 2pt narrower than one that
    // drew it. Invisible on its own; visible the moment something toggles
    // between the two — a preset chip jumped 2pt wider going from outline to
    // primary on selection, and an outline button shrank the instant it went
    // disabled. Reserving the space keeps a control the same size across every
    // appearance it can take.
    borderColor: visual.border?.color ?? "transparent",
    borderWidth: visual.border?.width ?? BORDER_WIDTH,
    ...(elevated && !disabled ? ELEVATED_SHADOW : null),
  };
}
