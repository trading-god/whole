import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";
import Animated, {
  Extrapolation,
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

import { COLORS } from "@/theme/colors";
import { SPACING } from "@/theme/spacing";

type StepIndicatorProps = {
  count: number;
  current: number;
};

// Inactive dot is an 8pt circle; the active dot expands into a 24pt capsule.
// Height stays constant so the row never shifts vertically as a dot widens.
const DOT_HEIGHT = 8;
const INACTIVE_WIDTH = 8;
const ACTIVE_WIDTH = 24;

const STEP_TRANSITION_MS = 250;

// A single dot whose width and color follow the continuous `current` value.
// Each dot peaks (widest, brand-colored) when `current === index` and tapers
// on either side, so as the indicator animates between steps the active dot
// contracts while the next expands — a smooth handoff rather than a hard swap.
function Dot({
  index,
  current,
}: {
  index: number;
  current: SharedValue<number>;
}) {
  const inputRange = [index - 1, index, index + 1];

  const style = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(current.value, inputRange, [
      COLORS.subtle,
      COLORS.brand,
      COLORS.subtle,
    ]),
    width: interpolate(
      current.value,
      inputRange,
      [INACTIVE_WIDTH, ACTIVE_WIDTH, INACTIVE_WIDTH],
      Extrapolation.CLAMP,
    ),
  }));

  return <Animated.View style={[styles.dot, style]} />;
}

// Animated progress dots for a multi-step flow. The active step is a brand
// capsule; the rest are subtle circles. `current` animates continuously (see
// `Dot`), so passing a new `current` produces a smooth widen/contract rather
// than an instant snap. Exposes the step count to assistive tech via
// `accessibilityValue` text rather than per-dot labels.
export function StepIndicator({ count, current }: StepIndicatorProps) {
  const { t } = useTranslation();
  // Initialized to the first `current` so the initial step renders active
  // without a one-frame tween from 0.
  const currentSV = useSharedValue(current);

  useEffect(() => {
    currentSV.value = withTiming(current, { duration: STEP_TRANSITION_MS });
  }, [current, currentSV]);

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{
        text: t("common.stepIndicator", {
          current: current + 1,
          total: count,
        }),
      }}
      style={styles.container}
    >
      {Array.from({ length: count }, (_, index) => (
        <Dot key={index} index={index} current={currentSV} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    flexDirection: "row",
    gap: SPACING.xs,
  },
  dot: {
    borderRadius: DOT_HEIGHT / 2,
    height: DOT_HEIGHT,
  },
});
