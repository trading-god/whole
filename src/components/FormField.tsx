import { type ReactNode } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

import { FieldShell } from "@/components/FieldShell";
import { COLORS } from "@/theme/colors";
import { useResponsiveLayout } from "@/theme/layout";
import { SPACING } from "@/theme/spacing";
import { FONT_SIZE, FONT_WEIGHT, LETTER_SPACING } from "@/theme/typography";

type FormFieldProps = {
  label?: string;
  placeholder: string;
  value: string;
  onChangeText: (value: string) => void;
  required?: boolean;
  keyboardType?: "default" | "url" | "decimal-pad" | "number-pad";
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  maxLength?: number;
  prefix?: string;
  trailing?: ReactNode;
  trailingLayout?: "inline" | "responsive";
  accessibilityLabel?: string;
  editable?: boolean;
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
            onChangeText={onChangeText}
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
    </FieldShell>
  );
}

const styles = StyleSheet.create({
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
