import { Pressable, StyleSheet, Text, View } from "react-native";

import { COLORS } from "@/theme/colors";
import { PRESSED_OPACITY_SURFACE } from "@/theme/interaction";
import { CHIP_HEIGHT, CHIP_RADIUS } from "@/theme/sizes";
import { SPACING } from "@/theme/spacing";
import { FONT_SIZE, FONT_WEIGHT } from "@/theme/typography";

type ChoiceChipOption<T extends string> = {
  label: string;
  value: T;
};

type ChoiceChipGroupProps<T extends string> = {
  options: readonly ChoiceChipOption<T>[];
  value: T;
  onChange: (value: T) => void;
};

export function ChoiceChipGroup<T extends string>({
  options,
  value,
  onChange,
}: ChoiceChipGroupProps<T>) {
  return (
    <View accessibilityRole="radiogroup" style={styles.group}>
      {options.map((option) => {
        const isSelected = option.value === value;

        return (
          <Pressable
            key={option.value}
            accessibilityLabel={option.label}
            accessibilityRole="radio"
            accessibilityState={{ selected: isSelected }}
            hitSlop={8}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              styles.chip,
              isSelected && styles.chipSelected,
              pressed && styles.chipPressed,
            ]}
          >
            <Text style={[styles.label, isSelected && styles.labelSelected]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: SPACING.sm,
  },
  chip: {
    alignItems: "center",
    backgroundColor: COLORS.surfaceMuted,
    borderColor: "transparent",
    borderRadius: CHIP_RADIUS,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: CHIP_HEIGHT,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  chipSelected: {
    backgroundColor: COLORS.brandSoft,
    borderColor: COLORS.brandSoftBorder,
  },
  chipPressed: {
    opacity: PRESSED_OPACITY_SURFACE,
  },
  label: {
    color: COLORS.muted,
    fontSize: FONT_SIZE.bodySm,
    fontWeight: FONT_WEIGHT.bold,
    textAlign: "center",
  },
  labelSelected: {
    color: COLORS.brand,
  },
});
