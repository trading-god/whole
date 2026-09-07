import { useSyncExternalStore } from "react";
import { Dimensions } from "react-native";

export const MIN_INTERACTIVE_SIZE = 48;

const COMPACT_VIEWPORT_WIDTH = 360;
const LARGE_FONT_SCALE = 1.3;

// `useWindowDimensions` re-renders on EVERY dimension event — it hands the
// subscriber a fresh object even when width and fontScale are unchanged, and
// on Android the keyboard's adjustResize fires such an event on every toggle,
// so each subscribed screen (settings, home) would re-render its whole tree
// per keystroke's worth of layout churn. Subscribing through
// `useSyncExternalStore` with the DERIVED boolean as the snapshot lets React
// bail out whenever `isCompact` itself did not change.
const compactListeners = new Set<() => void>();
Dimensions.addEventListener("change", () => {
  for (const listener of compactListeners) {
    listener();
  }
});

function subscribeToCompactness(listener: () => void): () => void {
  compactListeners.add(listener);
  return () => {
    compactListeners.delete(listener);
  };
}

function isCompactViewport(): boolean {
  const { fontScale, width } = Dimensions.get("window");
  return width <= COMPACT_VIEWPORT_WIDTH || fontScale >= LARGE_FONT_SCALE;
}

// Layout changes follow available space and the user's font scale rather than a
// specific locale, so switching languages does not introduce a separate set of
// responsive rules.
export function useResponsiveLayout() {
  const isCompact = useSyncExternalStore(
    subscribeToCompactness,
    isCompactViewport,
  );

  return { isCompact };
}
