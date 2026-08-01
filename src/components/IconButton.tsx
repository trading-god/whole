import {
  type AccessibilityState,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { ButtonBase } from "@/components/ButtonBase";
import { Icon, type IconName, type IconSize } from "@/components/Icon";
import {
  BUTTON_VARIANTS,
  DISABLED_BUTTON,
  buttonContainerStyle,
  type ButtonVariant,
} from "@/components/button-variants";
import { PRESSED_SCALE_ICON } from "@/theme/interaction";
import { ICON_BUTTON_SIZES, type Size } from "@/theme/sizes";

export type IconButtonProps = {
  name: IconName;
  size?: Size;
  variant?: ButtonVariant;
  iconSize?: IconSize | number;
  disabled?: boolean;
  elevated?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel: string;
  accessibilityHint?: string;
  accessibilityRole?: "button" | "link";
  accessibilityState?: AccessibilityState;
  hitSlop?: PressableProps["hitSlop"];
  testID?: string;
  onPress?: () => void;
} & Omit<PressableProps, "style" | "onPress">;

export function IconButton({
  name,
  size = "md",
  variant = "primary",
  iconSize = "lg",
  disabled = false,
  elevated = false,
  style,
  accessibilityLabel,
  accessibilityHint,
  accessibilityRole = "button",
  accessibilityState,
  hitSlop,
  testID,
  onPress,
  ...rest
}: IconButtonProps) {
  const dimension = ICON_BUTTON_SIZES[size];
  const variantStyle = BUTTON_VARIANTS[variant];
  const visual = disabled ? DISABLED_BUTTON : variantStyle;

  const baseStyle: ViewStyle = {
    alignItems: "center",
    ...buttonContainerStyle(visual, { elevated, disabled }),
    borderRadius: dimension / 2,
    height: dimension,
    justifyContent: "center",
    width: dimension,
  };

  return (
    <ButtonBase
      {...rest}
      baseStyle={baseStyle}
      pressedStyle={
        disabled
          ? null
          : {
              ...variantStyle.pressedStyle,
              transform: [{ scale: PRESSED_SCALE_ICON }],
            }
      }
      style={style}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityRole={accessibilityRole}
      accessibilityState={accessibilityState}
      hitSlop={hitSlop}
      testID={testID}
      onPress={onPress}
    >
      <Icon name={name} size={iconSize} color={visual.iconColor} />
    </ButtonBase>
  );
}
