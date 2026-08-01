import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type TextStyle,
  type ViewStyle,
  Modal,
  Pressable,
  StyleSheet,
  Text,
} from "react-native";

import { Icon } from "@/components/Icon";
import { type Currency } from "@/features/assets/currencies";
import { COLORS } from "@/theme/colors";
import { PRESSED_OPACITY_SURFACE } from "@/theme/interaction";
import { MIN_INTERACTIVE_SIZE } from "@/theme/layout";
import { modalOverlay } from "@/theme/screen-styles";
import { CARD_RADIUS, CHIP_RADIUS } from "@/theme/sizes";
import { SPACING } from "@/theme/spacing";
import { FONT_SIZE, FONT_WEIGHT, LETTER_SPACING } from "@/theme/typography";

type CurrencyPickerVariant = "onDark" | "onLight";

type CurrencyPickerProps = {
  value: Currency;
  // Option list, ordered by the caller (locale-default first, then alpha).
  currencies: readonly Currency[];
  onChange: (currency: Currency) => void;
  // Trigger surface. `onDark` (default) is the inline switcher on the home
  // balance card's dark eyebrow; `onLight` is the compact unit-suffix capsule
  // used inside a form input's trailing slot. The option sheet is shared.
  variant?: CurrencyPickerVariant;
  // Dialog title and trigger announcement label. Defaults to the home
  // "display currency" string; form contexts pass a plain "currency" label.
  dialogTitle?: string;
};

// Currency switcher with a centered option sheet. The trigger has two surface
// variants — `onDark` for the home balance card eyebrow, `onLight` for the
// compact "unit suffix" placed beside a form amount input. The sheet reuses
// the light card surface like the new-account cleanup modal.
export function CurrencyPicker({
  value,
  currencies,
  onChange,
  variant = "onDark",
  dialogTitle,
}: CurrencyPickerProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

  const title = dialogTitle ?? t("home.displayCurrency");
  const trigger = TRIGGER_VARIANT[variant];

  const handleSelect = (currency: Currency) => {
    onChange(currency);
    setIsOpen(false);
  };

  return (
    <>
      <Pressable
        accessibilityLabel={title}
        accessibilityRole="button"
        hitSlop={trigger.hitSlop}
        onPress={() => setIsOpen(true)}
        style={trigger.style}
      >
        <Text style={trigger.textStyle}>{value}</Text>
        <Icon name="chevron-down" size="sm" color={trigger.chevron} />
      </Pressable>

      <Modal
        animationType="fade"
        onRequestClose={() => setIsOpen(false)}
        transparent
        visible={isOpen}
      >
        <Pressable
          accessibilityLabel={title}
          style={styles.overlay}
          onPress={() => setIsOpen(false)}
        >
          {/* Swallow taps inside the card so only the scrim dismisses the
              sheet, not taps on the title or option whitespace. */}
          <Pressable
            accessibilityRole="radiogroup"
            style={styles.card}
            onPress={() => undefined}
          >
            <Text style={styles.title}>{title}</Text>
            {currencies.map((currency) => {
              const isSelected = currency === value;
              return (
                <Pressable
                  key={currency}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected }}
                  onPress={() => handleSelect(currency)}
                  style={({ pressed }) => [
                    styles.option,
                    isSelected && styles.optionSelected,
                    pressed && styles.optionPressed,
                  ]}
                >
                  <Text
                    style={[
                      styles.optionText,
                      isSelected && styles.optionTextSelected,
                    ]}
                  >
                    {currency}
                  </Text>
                  {isSelected ? (
                    <Icon name="check" size="sm" color={COLORS.brand} />
                  ) : null}
                </Pressable>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

// Shared text base for both trigger variants — they differ only in color and
// weight, so the eyebrow size and caption tracking live once.
const triggerTextBase: TextStyle = {
  fontSize: FONT_SIZE.eyebrow,
  letterSpacing: LETTER_SPACING.caption,
};

const styles = StyleSheet.create({
  trigger: {
    alignItems: "center",
    flexDirection: "row",
    gap: 2,
    justifyContent: "center",
    minHeight: MIN_INTERACTIVE_SIZE,
    paddingHorizontal: SPACING.xs,
  },
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
  triggerTextOnLight: {
    ...triggerTextBase,
    color: COLORS.ink,
    fontWeight: FONT_WEIGHT.bold,
  },
  overlay: { ...modalOverlay },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: CARD_RADIUS,
    maxWidth: 320,
    padding: SPACING.lg,
    width: "100%",
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
  option: {
    alignItems: "center",
    borderRadius: CHIP_RADIUS,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
  },
  optionSelected: {
    backgroundColor: COLORS.brandSoft,
  },
  optionPressed: {
    opacity: PRESSED_OPACITY_SURFACE,
  },
  optionText: {
    color: COLORS.ink,
    fontSize: FONT_SIZE.bodyLg,
    fontWeight: FONT_WEIGHT.semibold,
  },
  optionTextSelected: {
    color: COLORS.brand,
  },
});

// Per-variant trigger surface values (trigger style, label style, chevron tint,
// touch-target inset) co-located so adding a third surface is a one-row change.
const TRIGGER_VARIANT: Record<
  CurrencyPickerVariant,
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
  onLight: {
    style: styles.triggerOnLight,
    textStyle: styles.triggerTextOnLight,
    chevron: COLORS.muted,
    hitSlop: 10,
  },
};
