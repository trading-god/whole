import { Pressable, StyleSheet, Text, View } from "react-native";

import { COLORS } from "@/theme/colors";
import { PRESSED_OPACITY_SURFACE } from "@/theme/interaction";
import { MIN_INTERACTIVE_SIZE } from "@/theme/layout";
import { screenStyles } from "@/theme/screen-styles";
import { RADIUS } from "@/theme/sizes";
import { SPACING } from "@/theme/spacing";
import { FONT_SIZE, FONT_WEIGHT } from "@/theme/typography";

type EngineOptionCardProps = {
  selected: boolean;
  title: string;
  hint: string;
  onSelect: () => void;
  children?: React.ReactNode;
  testID?: string;
};

// The radio mark's outer footprint. The dot that fills a selected mark is
// exactly half of it. Exported so the config stack below a radio row can
// align under the mark that explains it (RADIO_ROW_INDENT).
export const RADIO_MARK_SIZE = 24;
const RADIO_DOT_SIZE = RADIO_MARK_SIZE / 2;

// How far a radio row's trailing content (progress, cost lines, actions)
// indents to sit under the copy column: the mark plus the row's horizontal
// gap. Derived from RADIO_MARK_SIZE so resizing the mark carries the indent
// with it instead of leaving every config row misaligned.
export const RADIO_ROW_INDENT = RADIO_MARK_SIZE + SPACING.md;

/**
 * The radio mark: a ring that fills when selected — the same stroke family as
 * the checkmarks elsewhere in the app, rather than a platform checkbox the
 * icon set has no glyph for.
 *
 * Shared by the engine cards and the model rows inside them. Both levels keep
 * the same legible geometry while their surrounding layout conveys hierarchy.
 */
export function RadioMark({ selected }: { selected: boolean }) {
  return (
    <View style={styles.radioRing}>
      {selected ? <View style={styles.radioDot} /> : null}
    </View>
  );
}

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
        accessibilityHint={hint}
        accessibilityRole="radio"
        accessibilityState={{ selected }}
        onPress={onSelect}
        style={({ pressed }) => [styles.optionRow, pressed && styles.pressed]}
        testID={testID}
      >
        <RadioMark selected={selected} />
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
    minHeight: MIN_INTERACTIVE_SIZE,
    paddingVertical: SPACING.md,
  },
  pressed: {
    opacity: PRESSED_OPACITY_SURFACE,
  },
  radioRing: {
    alignItems: "center",
    borderColor: COLORS.outlineBorder,
    borderRadius: RADIUS.sm,
    borderWidth: 1.5,
    height: RADIO_MARK_SIZE,
    justifyContent: "center",
    width: RADIO_MARK_SIZE,
  },
  radioDot: {
    backgroundColor: COLORS.brand,
    borderRadius: RADIO_DOT_SIZE / 2,
    height: RADIO_DOT_SIZE,
    width: RADIO_DOT_SIZE,
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
    ...screenStyles.metaLine,
  },
  configArea: {
    paddingBottom: SPACING.lg,
  },
});
