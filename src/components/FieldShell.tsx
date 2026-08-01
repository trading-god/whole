import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";

import { COLORS } from "@/theme/colors";
import { SPACING } from "@/theme/spacing";
import { FONT_SIZE, FONT_WEIGHT } from "@/theme/typography";

type FieldShellProps = {
  label?: string;
  required?: boolean;
  children?: ReactNode;
};

// Shared labeled field container (label + required mark + control slot) used
// by FormField (text input) and the ChoiceChip pickers, so the field padding
// and label typography have one owner across control types. `label` and
// `children` are optional so a caller can render a standalone heading (label
// only) or a control without a visible label (label omitted — the caller then
// provides an accessibilityLabel on the control itself).
export function FieldShell({
  label,
  required = false,
  children,
}: FieldShellProps) {
  const { t } = useTranslation();

  return (
    <View style={styles.field}>
      {label ? (
        <Text
          style={styles.fieldLabel}
          accessibilityLabel={
            required ? `${label}, ${t("common.required")}` : undefined
          }
        >
          {label}
          {required ? <Text style={styles.requiredMark}> *</Text> : null}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    paddingVertical: SPACING.md,
  },
  fieldLabel: {
    color: COLORS.muted,
    fontSize: FONT_SIZE.micro,
    fontWeight: FONT_WEIGHT.semibold,
    marginBottom: SPACING.sm,
  },
  requiredMark: {
    color: COLORS.danger,
  },
});
