import { Children, type ReactNode } from "react";
import { type StyleProp, StyleSheet, View, type ViewStyle } from "react-native";

import { useResponsiveLayout } from "@/theme/layout";

type ButtonGroupProps = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
};

// Keeps actions side by side when space permits and gives every localized label
// the full row in compact layouts or at larger accessibility font sizes.
export function ButtonGroup({ children, style }: ButtonGroupProps) {
  const { isCompact } = useResponsiveLayout();

  return (
    <View style={[styles.group, isCompact && styles.groupCompact, style]}>
      {Children.map(children, (child) => (
        <View style={[styles.item, isCompact && styles.itemCompact]}>
          {child}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    alignItems: "stretch",
    flexDirection: "row",
    gap: 10,
  },
  groupCompact: {
    flexDirection: "column",
  },
  item: {
    flex: 1,
    minWidth: 0,
  },
  itemCompact: {
    flexBasis: "auto",
    flexGrow: 0,
    flexShrink: 0,
    width: "100%",
  },
});
