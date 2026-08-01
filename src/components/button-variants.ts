import { type ViewStyle } from "react-native";

import { COLORS } from "@/theme/colors";
import { PRESSED_OPACITY } from "@/theme/interaction";
import { ELEVATED_SHADOW } from "@/theme/shadow";

export type ButtonVariant =
  "primary" | "secondary" | "danger" | "outline" | "ghost";

export type ButtonVariantStyle = {
  /** 容器背景色。 */
  backgroundColor: string;
  /** 描边；缺省表示无边框，disabled 态不渲染。 */
  border?: { color: string; width: number };
  /** 文字颜色。 */
  labelColor: string;
  /** 图标颜色。 */
  iconColor: string;
  /** 按压时的视觉反馈，叠加在容器之上。 */
  pressedStyle: ViewStyle;
};

/**
 * 每个 variant 的完整设计语言：背景、描边、文字/图标色、按压反馈。
 * `Button` 与 `IconButton` 共用此配置，保证组件库层面一致。
 *
 * 设计语言：
 * - `primary` / `secondary` / `danger`：填充态，按压时降低不透明度，保留底色识别度。
 *   `danger` 用于破坏性操作（清空、删除），红底白字与 `primary` 同等视觉权重。
 * - `outline`：透明底 + 描边，按压时浮出浅底提供明确触感。
 * - `ghost`：纯文字态，按压时浮出品牌色柔光底，呼应品牌。
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
};

/**
 * disabled 态统一覆盖：中性灰底 + 中性灰字，不渲染描边。
 * `Button` 与 `IconButton` 在 disabled 时走此取值路径，与常态同构。
 */
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
    ...(visual.border
      ? { borderColor: visual.border.color, borderWidth: visual.border.width }
      : {}),
    ...(elevated && !disabled ? ELEVATED_SHADOW : null),
  };
}
