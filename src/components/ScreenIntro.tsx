import { StyleSheet, Text, View } from "react-native";

import { COLORS } from "@/theme/colors";
import { SPACING } from "@/theme/spacing";
import {
  FONT_SIZE,
  FONT_WEIGHT,
  LETTER_SPACING,
  LINE_HEIGHT,
} from "@/theme/typography";

// The title + subtitle block every secondary screen opens with — add account,
// edit account, settings, and both onboarding steps. Owns its spacing and type
// rather than exporting three style fragments for each screen to assemble by
// hand: the block was identical at all five call sites, so a change to the
// intro treatment was a five-file edit with nothing enforcing the shape.
export function ScreenIntro({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <View style={styles.intro}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  intro: {
    paddingBottom: SPACING.xl,
    paddingTop: SPACING.md,
  },
  title: {
    color: COLORS.ink,
    fontSize: FONT_SIZE.pageTitle,
    fontWeight: FONT_WEIGHT.bold,
    letterSpacing: LETTER_SPACING.pageTitleTight,
  },
  subtitle: {
    color: COLORS.muted,
    fontSize: FONT_SIZE.body,
    lineHeight: LINE_HEIGHT.body,
    marginTop: SPACING.sm,
  },
});
