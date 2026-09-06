import { Pressable, StyleSheet, Text, View } from "react-native";

import { COLORS } from "@/theme/colors";
import { PRESSED_OPACITY_SURFACE } from "@/theme/interaction";
import { RADIUS } from "@/theme/sizes";
import { SPACING } from "@/theme/spacing";
import { FONT_SIZE, FONT_WEIGHT, LINE_HEIGHT } from "@/theme/typography";

type EngineOptionCardProps = {
  selected: boolean;
  title: string;
  hint: string;
  onSelect: () => void;
  children?: React.ReactNode;
  testID?: string;
};

// One engine choice, as a selectable row: the whole card is the target, the
// selected state paints the brand-soft fill (the same selected language the
// ChoiceChipGroup uses), and the engine's configuration grows inside it.
//
// A radio rather than a chip pair: this is a single choice with structure
// hanging off it, not two equal toggles — and `accessibilityRole="radio"`
// says what a screen reader should announce.
export function EngineOptionCard({
  selected,
  title,
  hint,
  onSelect,
  children,
  testID,
}: EngineOptionCardProps) {
  return (
    <View style={[styles.card, selected && styles.cardSelected]}>
      <Pressable
        accessibilityLabel={title}
        accessibilityRole="radio"
        accessibilityState={{ selected }}
        onPress={onSelect}
        style={({ pressed }) => [styles.optionRow, pressed && styles.pressed]}
        testID={testID}
      >
        {/* The mark: a ring that fills when selected — the same stroke family
            as the checkmarks elsewhere in the app, rather than a platform
            checkbox the icon set has no glyph for. */}
        <View style={styles.radioRing}>
          {selected ? <View style={styles.radioDot} /> : null}
        </View>
        <View style={styles.optionCopy}>
          <Text style={styles.optionTitle}>{title}</Text>
          <Text style={styles.optionHint}>{hint}</Text>
        </View>
      </Pressable>
      {selected && children ? (
        <View style={styles.configArea}>{children}</View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    paddingHorizontal: SPACING.lg,
  },
  cardSelected: {
    backgroundColor: COLORS.brandSoft,
    borderColor: COLORS.brandSoftBorder,
  },
  optionRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: SPACING.md,
    paddingVertical: SPACING.md,
  },
  pressed: {
    opacity: PRESSED_OPACITY_SURFACE,
  },
  radioRing: {
    alignItems: "center",
    borderColor: COLORS.outlineBorder,
    borderRadius: 10,
    borderWidth: 1.5,
    height: 20,
    justifyContent: "center",
    width: 20,
  },
  radioDot: {
    backgroundColor: COLORS.brand,
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  optionCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  optionTitle: {
    color: COLORS.ink,
    fontSize: FONT_SIZE.body,
    fontWeight: FONT_WEIGHT.semibold,
  },
  optionHint: {
    color: COLORS.muted,
    fontSize: FONT_SIZE.micro,
    lineHeight: LINE_HEIGHT.tight,
  },
  configArea: {
    paddingBottom: SPACING.lg,
  },
});
