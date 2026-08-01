import type { ReactNode } from "react";
import {
  type AccessibilityRole,
  type AccessibilityState,
  Pressable,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";

type ButtonBaseProps = {
  baseStyle: StyleProp<ViewStyle>;
  pressedStyle: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityRole?: AccessibilityRole;
  accessibilityState?: AccessibilityState;
  hitSlop?: PressableProps["hitSlop"];
  testID?: string;
  onPress?: () => void;
  children: ReactNode;
} & Omit<PressableProps, "style" | "onPress" | "children">;

export function ButtonBase({
  baseStyle,
  pressedStyle,
  style,
  disabled,
  accessibilityLabel,
  accessibilityHint,
  accessibilityRole = "button",
  accessibilityState,
  hitSlop,
  testID,
  onPress,
  children,
  ...rest
}: ButtonBaseProps) {
  return (
    <Pressable
      {...rest}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityRole={accessibilityRole}
      accessibilityState={{ ...accessibilityState, disabled: !!disabled }}
      hitSlop={hitSlop}
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [
        baseStyle,
        pressed && !disabled && pressedStyle,
        style,
      ]}
    >
      {children}
    </Pressable>
  );
}
