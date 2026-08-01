import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";

import { IconButton } from "@/components/IconButton";
import { useReturnToOverview } from "@/navigation/useReturnToOverview";
import { COLORS } from "@/theme/colors";
import { ICON_BUTTON_SIZES } from "@/theme/sizes";
import { SPACING } from "@/theme/spacing";
import { FONT_SIZE, FONT_WEIGHT } from "@/theme/typography";

type ScreenHeaderProps = {
  title: string;
};

// Shared secondary-screen header: back chevron + centered title + balancing
// spacer. Delegates back navigation to useReturnToOverview so screens and the
// header share one return-to-overview rule. Horizontal padding matches the
// screen content padding so the back button and title align with the body.
export function ScreenHeader({ title }: ScreenHeaderProps) {
  const { t } = useTranslation();
  const returnToOverview = useReturnToOverview();

  return (
    <View style={styles.navigation}>
      <View style={styles.navigationAction}>
        <IconButton
          name="chevron-left"
          size="md"
          variant="outline"
          accessibilityLabel={t("common.backToAssetOverview")}
          hitSlop={12}
          onPress={returnToOverview}
        />
      </View>
      <Text
        ellipsizeMode="tail"
        numberOfLines={2}
        style={styles.navigationTitle}
      >
        {title}
      </Text>
      <View style={styles.navigationAction} />
    </View>
  );
}

const styles = StyleSheet.create({
  navigation: {
    alignItems: "center",
    flexDirection: "row",
    gap: SPACING.sm,
    minHeight: 64,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.sm,
  },
  navigationAction: {
    // Width matches the md IconButton rendered on the opposite side so the
    // centered title stays balanced against the back chevron.
    alignItems: "flex-start",
    flexShrink: 0,
    width: ICON_BUTTON_SIZES.md,
  },
  navigationTitle: {
    color: COLORS.ink,
    flex: 1,
    fontSize: FONT_SIZE.subtitle,
    fontWeight: FONT_WEIGHT.bold,
    minWidth: 0,
    textAlign: "center",
  },
});
