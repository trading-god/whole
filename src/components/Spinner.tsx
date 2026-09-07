import { useEffect, useState } from "react";
import { Animated, Easing } from "react-native";

import { Icon } from "@/components/Icon";
import { COLORS } from "@/theme/colors";

// One spinner, the same shape on both platforms.
//
// React Native's `ActivityIndicator` draws the PLATFORM's spinner, and those
// are different shapes: iOS renders the petal wheel, Android an arc. The same
// button therefore spun differently depending on the phone, which is not a
// difference this app has any reason to inherit — so the arc is drawn here from
// the icon set the rest of the UI already uses.
//
// `useNativeDriver` keeps the rotation off the JS thread, so it keeps turning
// while the thing it is waiting on is parsing a response.
const SPIN_DURATION_MS = 900;

export type SpinnerProps = {
  size?: number;
  color?: string;
  testID?: string;
  // Standalone spinners (a screen's loading placeholder, a busy nav chevron)
  // have no labelled control around them, so they announce themselves through
  // this label. Spinners inside a Button stay unlabelled — the button already
  // carries the action's name and `busy` state.
  accessibilityLabel?: string;
};

export function Spinner({
  size = 20,
  color = COLORS.ink,
  testID = "spinner",
  accessibilityLabel,
}: SpinnerProps) {
  // `useState` with a lazy initialiser rather than `useRef(...).current`:
  // reading a ref during render is what React Compiler refuses, and it bails
  // out of memoizing the whole component when it sees one. Both create the
  // value exactly once.
  const [turn] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const animation = Animated.loop(
      Animated.timing(turn, {
        toValue: 1,
        duration: SPIN_DURATION_MS,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    animation.start();
    return () => animation.stop();
  }, [turn]);

  return (
    <Animated.View
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityLabel ? "progressbar" : undefined}
      testID={testID}
      style={{
        transform: [
          {
            rotate: turn.interpolate({
              inputRange: [0, 1],
              outputRange: ["0deg", "360deg"],
            }),
          },
        ],
      }}
    >
      <Icon name="loader-circle" size={size} color={color} />
    </Animated.View>
  );
}
