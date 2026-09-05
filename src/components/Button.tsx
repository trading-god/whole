import type { ReactNode } from "react";
import {
  type AccessibilityState,
  type PressableProps,
  type StyleProp,
  Text,
  type ViewStyle,
} from "react-native";

import { ButtonBase } from "@/components/ButtonBase";
import { Icon, type IconName } from "@/components/Icon";
import { Spinner } from "@/components/Spinner";
import {
  BUTTON_VARIANTS,
  DISABLED_BUTTON,
  buttonContainerStyle,
  type ButtonVariant,
} from "@/components/button-variants";
import {
  BUTTON_HORIZONTAL_PADDING,
  BUTTON_HITSLOP,
  BUTTON_SIZES,
  RADIUS,
  type Size,
} from "@/theme/sizes";
import { SPACING } from "@/theme/spacing";
import { FONT_SIZE, FONT_WEIGHT } from "@/theme/typography";

export type ButtonProps = {
  children?: ReactNode;
  size?: Size;
  variant?: ButtonVariant;
  icon?: IconName;
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
  xs: { fontSize: FONT_SIZE.micro, fontWeight: FONT_WEIGHT.bold },
  sm: { fontSize: FONT_SIZE.bodySm, fontWeight: FONT_WEIGHT.bold },
  md: { fontSize: FONT_SIZE.body, fontWeight: FONT_WEIGHT.extrabold },
  lg: { fontSize: FONT_SIZE.bodyLg, fontWeight: FONT_WEIGHT.extrabold },
};

// Leading icon glyph size per button size — the icon sits beside the label, so
// its glyph tracks the label scale rather than the icon-button's square size.
const BUTTON_LEADING_ICON_SIZE: Record<Size, number> = {
  xs: 14,
  sm: 16,
  md: 20,
  lg: 24,
};

export function Button({
  children,
  size = "md",
  variant = "primary",
  icon,
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
  // `loading` means an async action is in flight (a save, say): the variant's
  // appearance and shadow stay, and only the press is blocked — greying out
  // would flash the button through enabled → disabled → enabled. Only a button
  // that is genuinely unavailable (disabled and not loading) drops to grey.
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
    // A chip-sized control with a full-sized gutter reads as a wide button
    // rather than a chip, which defeats the size.
    paddingHorizontal: size === "xs" ? SPACING.md : BUTTON_HORIZONTAL_PADDING,
    paddingVertical: SPACING.sm,
  };

  // Leading icon scaled to the button height so it reads with the label
  // rather than overpowering it (sm buttons get a 16pt glyph, lg a 24pt one).
  const iconSize = BUTTON_LEADING_ICON_SIZE[size];

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
      // Defaulted from the size, so a compact control never ships a
      // target smaller than `MIN_INTERACTIVE_SIZE`. A caller may still
      // widen it further; it just cannot accidentally forget it.
      hitSlop={hitSlop ?? BUTTON_HITSLOP[size]}
      testID={testID}
      onPress={onPress}
    >
      {/* The LEADING ICON SLOT: the spinner stands in the icon's place —
          same position, same size token, same gap — rather than being a
          second thing beside it. A button that already has an icon therefore
          does not change width mid-press. */}
      {loading ? (
        <Spinner
          testID="button-spinner"
          size={iconSize}
          color={visual.labelColor}
        />
      ) : icon ? (
        <Icon
          name={icon}
          size={iconSize}
          color={visual.labelColor}
          testID="button-icon"
        />
      ) : null}
      {/* Omitted entirely when there is no label, rather than rendered empty:
          an empty label box still takes the row's gap, which is what pushed
          the spinner off-centre on a spinner-only control. */}
      {children === undefined || children === null ? null : (
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
      )}
    </ButtonBase>
  );
}
