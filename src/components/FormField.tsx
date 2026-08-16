import { type ReactNode } from "react";
import {
  Platform,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from "react-native";

import { FieldShell } from "@/components/FieldShell";
import { screenStyles } from "@/theme/screen-styles";
import { COLORS } from "@/theme/colors";
import { useResponsiveLayout } from "@/theme/layout";
import { SPACING } from "@/theme/spacing";
import { FONT_SIZE, FONT_WEIGHT, LETTER_SPACING } from "@/theme/typography";

// A numeric keyboard that can type a minus sign. iOS's `decimal-pad` has no
// minus key at all, so with it a negative balance is literally untypeable —
// and a credit card's balance is negative (net worth is assets minus
// liabilities). Android's `numeric` already offers both the sign and the
// decimal separator.
//
// The platform branch lives here, next to the keyboard-type union it belongs
// to, so callers just name the intent.
export const SIGNED_DECIMAL_KEYBOARD = Platform.select({
  ios: "numbers-and-punctuation",
  default: "numeric",
} as const);

type FormFieldProps = {
  label?: string;
  placeholder: string;
  value: string;
  onChangeText: (value: string) => void;
  required?: boolean;
  // React Native's own union, not a copy of it: the parallel literal list had
  // to be widened by hand the moment `SIGNED_DECIMAL_KEYBOARD` needed a second
  // value, and nothing kept it in step with what `TextInput` actually accepts.
  keyboardType?: TextInputProps["keyboardType"];
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  maxLength?: number;
  prefix?: string;
  trailing?: ReactNode;
  trailingLayout?: "inline" | "responsive";
  accessibilityLabel?: string;
  editable?: boolean;
  // Shown under the input when what the user typed cannot be used. The form
  // still decides what "valid" means; this is only how the field says so.
  error?: string;
  // Focus is state the FORM needs, not just the input: a half-typed balance is
  // not wrong until the user has left the field (see `classifyBalanceRow`).
  onFocus?: () => void;
  onBlur?: () => void;
};

// Shared labeled text field used by the add-account and settings screens.
// The label/required shell comes from FieldShell (shared with the ChoiceChip
// pickers); this adds the TextInput, prefix, and trailing-control slot. `label`
// is optional — when omitted (e.g. the multi-currency balance rows, which sit
// under a single shared heading), pass `accessibilityLabel` so the input still
// announces itself to assistive tech.
export function FormField({
  label,
  placeholder,
  value,
  onChangeText,
  required = false,
  keyboardType = "default",
  autoCapitalize = "sentences",
  maxLength,
  prefix,
  trailing,
  trailingLayout = "inline",
  accessibilityLabel,
  editable,
  error,
  onFocus,
  onBlur,
}: FormFieldProps) {
  const { isCompact } = useResponsiveLayout();
  const stacksTrailing = trailingLayout === "responsive" && isCompact;

  return (
    <FieldShell label={label} required={required}>
      <View
        style={[styles.inputShell, stacksTrailing && styles.inputShellStacked]}
      >
        <View style={styles.inputRow}>
          {prefix ? <Text style={styles.inputPrefix}>{prefix}</Text> : null}
          <TextInput
            accessibilityLabel={accessibilityLabel ?? label}
            autoCapitalize={autoCapitalize}
            autoCorrect={false}
            editable={editable}
            keyboardType={keyboardType}
            maxLength={maxLength}
            onBlur={onBlur}
            onChangeText={onChangeText}
            onFocus={onFocus}
            placeholder={placeholder}
            placeholderTextColor={COLORS.subtle}
            selectionColor={COLORS.brand}
            style={styles.input}
            value={value}
          />
        </View>
        {trailing ? (
          <View
            style={[
              styles.fieldTrailing,
              stacksTrailing && styles.fieldTrailingStacked,
            ]}
          >
            {trailing}
          </View>
        ) : null}
      </View>
      {error ? (
        // The shared inline-error style, so a field's blocking message renders
        // identically to the screen-level ones beside it, and announced like
        // them.
        <Text
          accessibilityLiveRegion="polite"
          style={[screenStyles.errorHint, styles.error]}
        >
          {error}
        </Text>
      ) : null}
    </FieldShell>
  );
}

const styles = StyleSheet.create({
  // Spacing only — the type and colour come from `screenStyles.errorHint`.
  error: {
    marginTop: SPACING.xs,
  },
  inputShell: {
    alignItems: "center",
    flexDirection: "row",
    minWidth: 0,
  },
  inputShellStacked: {
    alignItems: "stretch",
    flexDirection: "column",
  },
  inputRow: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    minWidth: 0,
  },
  inputPrefix: {
    color: COLORS.subtle,
    fontSize: FONT_SIZE.subtitle,
    letterSpacing: LETTER_SPACING.prefix,
    marginRight: SPACING.sm,
  },
  input: {
    color: COLORS.ink,
    flex: 1,
    fontSize: FONT_SIZE.subtitle,
    fontWeight: FONT_WEIGHT.semibold,
    minHeight: 24,
    minWidth: 0,
    padding: 0,
  },
  fieldTrailing: {
    flexShrink: 0,
    marginLeft: SPACING.sm,
  },
  fieldTrailingStacked: {
    alignSelf: "flex-end",
    marginLeft: 0,
    marginTop: SPACING.sm,
  },
});
