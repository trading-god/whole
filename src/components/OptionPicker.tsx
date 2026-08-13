import { useState } from "react";
import {
  type TextStyle,
  type ViewStyle,
  Pressable,
  StyleSheet,
  Text,
} from "react-native";

import { Icon } from "@/components/Icon";
import { optionSheetStyles } from "@/components/option-sheet-styles";
import { ScrimModal } from "@/components/ScrimModal";
import { COLORS } from "@/theme/colors";
import { MIN_INTERACTIVE_SIZE } from "@/theme/layout";
import { scrimCardBase } from "@/theme/screen-styles";
import { CHIP_RADIUS } from "@/theme/sizes";
import { SPACING } from "@/theme/spacing";
import { FONT_SIZE, FONT_WEIGHT, LETTER_SPACING } from "@/theme/typography";

export type PickerOption<Value extends string> = {
  value: Value;
  label: string;
};

export type OptionPickerVariant = "onDark" | "onDarkMuted" | "onLight";

type OptionPickerProps<Value extends string> = {
  value: Value;
  // Option list, ordered by the caller.
  options: readonly PickerOption<Value>[];
  onChange: (value: Value) => void;
  // Dialog title and trigger announcement label.
  dialogTitle: string;
  // Trigger surface. `onDark` (default) is the accent switcher on the home
  // balance card's eyebrow; `onDarkMuted` is its quiet twin for the chart
  // footer, where the trigger must read as a caption rather than an action;
  // `onLight` is the compact unit-suffix capsule inside a form input's
  // trailing slot. The option sheet is shared by all three.
  variant?: OptionPickerVariant;
};

// Single-select control: a compact inline trigger plus a centered option sheet
// (via `ScrimModal`, the same scrim-dismiss component the cleanup modal uses).
// Shared by the currency switcher and the chart-range switcher so the option
// list, selection affordance, and dismissal behave identically wherever a
// "pick one of these" control appears.
export function OptionPicker<Value extends string>({
  value,
  options,
  onChange,
  dialogTitle,
  variant = "onDark",
}: OptionPickerProps<Value>) {
  const [isOpen, setIsOpen] = useState(false);

  const trigger = TRIGGER_VARIANT[variant];
  const selected = options.find((option) => option.value === value);

  const handleSelect = (next: Value) => {
    onChange(next);
    setIsOpen(false);
  };

  return (
    <>
      <Pressable
        accessibilityLabel={dialogTitle}
        accessibilityRole="button"
        hitSlop={trigger.hitSlop}
        onPress={() => setIsOpen(true)}
        style={trigger.style}
      >
        {/* Falls back to the raw value so the trigger never renders empty if a
            caller passes a value that isn't in its own option list. */}
        <Text style={trigger.textStyle}>{selected?.label ?? value}</Text>
        <Icon name="chevron-down" size="sm" color={trigger.chevron} />
      </Pressable>

      <ScrimModal
        accessibilityLabel={dialogTitle}
        accessibilityRole="radiogroup"
        cardStyle={styles.card}
        onDismiss={() => setIsOpen(false)}
        visible={isOpen}
      >
        <Text style={styles.title}>{dialogTitle}</Text>
        {options.map((option) => {
          const isSelected = option.value === value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ selected: isSelected }}
              onPress={() => handleSelect(option.value)}
              style={({ pressed }) => [
                optionSheetStyles.option,
                isSelected && optionSheetStyles.optionSelected,
                pressed && optionSheetStyles.optionPressed,
              ]}
            >
              <Text
                style={[
                  optionSheetStyles.optionText,
                  isSelected && optionSheetStyles.optionTextSelected,
                ]}
              >
                {option.label}
              </Text>
              {isSelected ? (
                <Icon name="check" size="sm" color={COLORS.brand} />
              ) : null}
            </Pressable>
          );
        })}
      </ScrimModal>
    </>
  );
}

// Shared bases for the trigger variants — the on-dark pair differ only in
// horizontal inset, and all three labels only in color and weight, so the
// geometry and the eyebrow size / caption tracking each live once.
const triggerBase: ViewStyle = {
  alignItems: "center",
  flexDirection: "row",
  gap: 2,
  justifyContent: "center",
  minHeight: MIN_INTERACTIVE_SIZE,
};

const triggerTextBase: TextStyle = {
  fontSize: FONT_SIZE.eyebrow,
  letterSpacing: LETTER_SPACING.caption,
};

const styles = StyleSheet.create({
  trigger: {
    ...triggerBase,
    paddingHorizontal: SPACING.xs,
  },
  // Flush twin of `trigger` for the quiet on-dark surface: the chart footer
  // aligns its label with the card's content edge, so the trigger carries no
  // horizontal inset of its own and `hitSlop` (raised by the same 4pt) keeps
  // the touch target identical. Owned here rather than cancelled with a
  // negative margin at the call site, so a change to the trigger's padding
  // can't silently push the footer label out of alignment.
  triggerFlush: triggerBase,
  // Compact unit-suffix capsule for light form surfaces. Sized to sit beside an
  // amount input without raising the row height; `hitSlop` restores the full
  // touch target. Its 10/6/28 padding/height are visual calibration for the
  // capsule, not layout-rhythm values, so they stay literal.
  triggerOnLight: {
    alignItems: "center",
    backgroundColor: COLORS.surfaceMuted,
    borderRadius: CHIP_RADIUS,
    flexDirection: "row",
    gap: 2,
    minHeight: 28,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  triggerText: {
    ...triggerTextBase,
    color: COLORS.accentOnDark,
    fontWeight: FONT_WEIGHT.semibold,
  },
  // Quiet on-dark trigger: caption-colored and unweighted, so the chart footer
  // still reads as a label rather than competing with the delta beside it.
  triggerTextOnDarkMuted: {
    ...triggerTextBase,
    color: COLORS.mutedOnDark,
  },
  triggerTextOnLight: {
    ...triggerTextBase,
    color: COLORS.ink,
    fontWeight: FONT_WEIGHT.bold,
  },
  card: {
    ...scrimCardBase,
    maxWidth: 320,
    padding: SPACING.lg,
  },
  title: {
    color: COLORS.muted,
    fontSize: FONT_SIZE.eyebrow,
    fontWeight: FONT_WEIGHT.semibold,
    letterSpacing: LETTER_SPACING.caption,
    marginBottom: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingTop: 4,
  },
});

// Per-variant trigger surface values (trigger style, label style, chevron tint,
// touch-target inset) co-located so adding a fourth surface is a one-row change.
const TRIGGER_VARIANT: Record<
  OptionPickerVariant,
  {
    style: ViewStyle;
    textStyle: TextStyle;
    chevron: string;
    hitSlop: number;
  }
> = {
  onDark: {
    style: styles.trigger,
    textStyle: styles.triggerText,
    chevron: COLORS.mutedOnDark,
    hitSlop: 8,
  },
  onDarkMuted: {
    style: styles.triggerFlush,
    textStyle: styles.triggerTextOnDarkMuted,
    chevron: COLORS.mutedOnDark,
    hitSlop: 12,
  },
  onLight: {
    style: styles.triggerOnLight,
    textStyle: styles.triggerTextOnLight,
    chevron: COLORS.muted,
    hitSlop: 10,
  },
};
