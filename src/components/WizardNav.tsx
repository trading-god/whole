import { ActivityIndicator, StyleSheet, View } from "react-native";

import { IconButton } from "@/components/IconButton";
import { StepIndicator } from "@/components/StepIndicator";
import { COLORS } from "@/theme/colors";
import { ICON_BUTTON_SIZES } from "@/theme/sizes";
import { SPACING } from "@/theme/spacing";

type WizardNavProps = {
  count: number;
  current: number;
  // Accessibility labels for the chevrons — screen-specific copy (e.g.
  // "Previous account" vs "Back").
  backLabel: string;
  nextLabel: string;
  onBack: () => void;
  onNext: () => void;
  backDisabled?: boolean;
  nextDisabled?: boolean;
  // Replaces the forward chevron with a spinner while an async finish runs.
  nextBusy?: boolean;
  // Hides the forward chevron entirely (e.g. the last wizard page, where the
  // bottom bar's save button takes over).
  nextHidden?: boolean;
};

// The shared wizard/pager navigation row: back chevron, centered step dots,
// forward chevron. Used by onboarding and the multi-account wizard so the
// pattern stays one system. The back chevron renders only past the first
// page; fixed-width sides sized to the md IconButton keep the dots centered
// whichever chevrons are visible.
export function WizardNav({
  count,
  current,
  backLabel,
  nextLabel,
  onBack,
  onNext,
  backDisabled,
  nextDisabled,
  nextBusy,
  nextHidden,
}: WizardNavProps) {
  return (
    <View style={styles.navRow}>
      <View style={styles.navSide}>
        {current > 0 ? (
          <IconButton
            accessibilityLabel={backLabel}
            disabled={backDisabled}
            name="chevron-left"
            onPress={onBack}
            size="md"
            variant="outline"
          />
        ) : null}
      </View>
      <StepIndicator count={count} current={current} />
      <View style={styles.navSide}>
        {nextBusy ? (
          <ActivityIndicator color={COLORS.brand} size="small" />
        ) : nextHidden ? null : (
          <IconButton
            accessibilityLabel={nextLabel}
            disabled={nextDisabled}
            elevated
            name="chevron-right"
            onPress={onNext}
            size="md"
            variant="primary"
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  navRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.sm,
  },
  // Fixed-width sides match the md IconButton so the indicator stays centered
  // whether or not a chevron is rendered.
  navSide: {
    alignItems: "center",
    height: ICON_BUTTON_SIZES.md,
    justifyContent: "center",
    width: ICON_BUTTON_SIZES.md,
  },
});
