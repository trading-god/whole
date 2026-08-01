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
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: SPACING.md,
    justifyContent: "space-between",
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
