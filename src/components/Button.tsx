import type { ReactNode } from "react";
import {
  type AccessibilityState,
  type PressableProps,
  type StyleProp,
  Text,
  type ViewStyle,
} from "react-native";

import { ButtonBase } from "@/components/ButtonBase";
import {
  BUTTON_VARIANTS,
  DISABLED_BUTTON,
  buttonContainerStyle,
  type ButtonVariant,
} from "@/components/button-variants";
import { BUTTON_SIZES, RADIUS, type Size } from "@/theme/sizes";
import { SPACING } from "@/theme/spacing";
import { FONT_SIZE, FONT_WEIGHT } from "@/theme/typography";

export type { ButtonVariant };

export type ButtonProps = {
  children: ReactNode;
  size?: Size;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  elevated?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityRole?: "button" | "link";
  accessibilityState?: AccessibilityState;
  hitSlop?: PressableProps["hitSlop"];
  testID?: string;
  onPress?: () => void;
} & Omit<PressableProps, "style" | "onPress" | "children">;

const LABEL_BY_SIZE: Record<
  Size,
  {
    fontSize: number;
    fontWeight: typeof FONT_WEIGHT.bold | typeof FONT_WEIGHT.extrabold;
  }
> = {
  sm: { fontSize: FONT_SIZE.bodySm, fontWeight: FONT_WEIGHT.bold },
  md: { fontSize: FONT_SIZE.body, fontWeight: FONT_WEIGHT.extrabold },
  lg: { fontSize: FONT_SIZE.bodyLg, fontWeight: FONT_WEIGHT.extrabold },
};

export function Button({
  children,
  size = "md",
  variant = "primary",
  disabled = false,
  loading = false,
  elevated = false,
  fullWidth = true,
  style,
  accessibilityLabel,
  accessibilityHint,
  accessibilityRole = "button",
  accessibilityState,
  hitSlop,
  testID,
  onPress,
  ...rest
}: ButtonProps) {
  const variantStyle = BUTTON_VARIANTS[variant];
  // `loading` 表示异步操作进行中（如保存）：保留 variant 外观与阴影，仅阻止
  // 按压交互，避免按钮在"可用 → 禁用 → 可用"之间灰化闪烁。只有真正不可用
  // （disabled 且非 loading）才降级为中性灰底。
  const visuallyDisabled = disabled && !loading;
  const visual = visuallyDisabled ? DISABLED_BUTTON : variantStyle;

  const baseStyle: ViewStyle = {
    alignSelf: fullWidth ? "stretch" : "flex-start",
    alignItems: "center",
    ...buttonContainerStyle(visual, {
      elevated,
      disabled: visuallyDisabled,
    }),
    borderRadius: RADIUS[size],
    flexDirection: "row",
    gap: SPACING.sm,
    justifyContent: "center",
    minHeight: BUTTON_SIZES[size],
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
  };

  return (
    <ButtonBase
      {...rest}
      baseStyle={baseStyle}
      pressedStyle={visuallyDisabled ? null : variantStyle.pressedStyle}
      style={style}
      disabled={disabled || loading}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityRole={accessibilityRole}
      accessibilityState={
        loading ? { busy: true, ...accessibilityState } : accessibilityState
      }
      hitSlop={hitSlop}
      testID={testID}
      onPress={onPress}
    >
      <Text
        style={{
          color: visual.labelColor,
          flexShrink: 1,
          textAlign: "center",
          ...LABEL_BY_SIZE[size],
        }}
      >
        {children}
      </Text>
    </ButtonBase>
  );
}
