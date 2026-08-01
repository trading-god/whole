import { useWindowDimensions } from "react-native";

export const MIN_INTERACTIVE_SIZE = 48;

const COMPACT_VIEWPORT_WIDTH = 360;
const LARGE_FONT_SCALE = 1.3;

// Layout changes follow available space and the user's font scale rather than a
// specific locale, so switching languages does not introduce a separate set of
// responsive rules.
export function useResponsiveLayout() {
  const { fontScale, width } = useWindowDimensions();

  return {
    isCompact: width <= COMPACT_VIEWPORT_WIDTH || fontScale >= LARGE_FONT_SCALE,
  };
}
