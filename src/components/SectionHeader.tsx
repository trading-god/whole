import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

import { COLORS } from "@/theme/colors";
import { useResponsiveLayout } from "@/theme/layout";
import { SPACING } from "@/theme/spacing";
import { FONT_SIZE, FONT_WEIGHT, LETTER_SPACING } from "@/theme/typography";

type SectionHeaderProps = {
  title: string;
  detail?: ReactNode;
  stacked?: boolean;
};

export function SectionHeader({
  title,
  detail,
  stacked = false,
}: SectionHeaderProps) {
  const { isCompact } = useResponsiveLayout();
  const usesStackedLayout = stacked || isCompact;

  return (
    <View style={[styles.header, usesStackedLayout && styles.headerStacked]}>
      <Text style={styles.title}>{title}</Text>
      {detail ? (
        <View
          style={[styles.detail, usesStackedLayout && styles.detailStacked]}
        >
          {detail}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Carries the rhythm a section header sets against the card it introduces.
  // Owned by the component rather than exported for call sites to apply: every
  // one of them wrapped it in an identical spacing View, so a new section
  // header could ship without one and silently lose the spacing.
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: SPACING.md,
    justifyContent: "space-between",
    marginBottom: SPACING.md,
    marginTop: SPACING.xxl,
    // Optical: nudges the header off the card edge below it without shifting
    // the section onto a different horizontal grid.
    paddingHorizontal: 2,
  },
  headerStacked: {
    alignItems: "flex-start",
    flexDirection: "column",
    gap: 6,
  },
  title: {
    color: COLORS.ink,
    flexShrink: 1,
    fontSize: FONT_SIZE.titleSm,
    fontWeight: FONT_WEIGHT.bold,
    letterSpacing: LETTER_SPACING.tight,
    minWidth: 0,
  },
  detail: {
    flexShrink: 0,
  },
  detailStacked: {
    alignSelf: "stretch",
  },
});
