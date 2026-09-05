import { StyleSheet, Text, View } from "react-native";

import { Icon } from "@/components/Icon";
import { COLORS } from "@/theme/colors";
import { SPACING } from "@/theme/spacing";
import { FONT_SIZE, LINE_HEIGHT } from "@/theme/typography";

type PrivacyNoteProps = {
  message: string;
};

// Shared "privacy reassurance" row: a check badge + a muted message, for a
// screen that needs one line of reassurance inline. The settings screen makes
// the same promise in a boxed `TONES.safe` panel instead — that one is the
// subject of the card, not an aside beside a control.
export function PrivacyNote({ message }: PrivacyNoteProps) {
  return (
    <View style={styles.privacyRow}>
      <View style={styles.privacyIcon}>
        <Icon name="check" size={12} color={COLORS.brand} />
      </View>
      <Text style={styles.privacyText}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  privacyRow: {
    alignItems: "center",
    flexDirection: "row",
    marginTop: SPACING.md,
    paddingHorizontal: SPACING.xs,
  },
  privacyIcon: {
    alignItems: "center",
    backgroundColor: COLORS.brandSoft,
    borderRadius: 8,
    height: 16,
    justifyContent: "center",
    width: 16,
  },
  privacyText: {
    color: COLORS.muted,
    flex: 1,
    fontSize: FONT_SIZE.micro,
    lineHeight: LINE_HEIGHT.tight,
    marginLeft: SPACING.sm,
  },
});
