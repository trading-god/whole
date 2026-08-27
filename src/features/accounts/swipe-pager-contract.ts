import type { ReactNode } from "react";
import { type StyleProp, type ViewStyle } from "react-native";

// The API the pager implementations share — the @expo/ui-backed native pager
// and the iOS < 17 slide-transition fallback. It lives in a module of its own
// (rather than inside one implementation) so no variant owns the contract the
// other has to import: retiring the fallback should not move the types.

export type SwipePagerHandle = {
  // Animated, button-driven page change. User swipes are reported via
  // `onIndexChange` instead, so the parent's mirrored index stays in step
  // whichever way the page changed.
  goTo: (index: number) => void;
};

export type SwipePagerProps = {
  count: number;
  // The page to open on. Every implementation reads it once, on mount, and is
  // uncontrolled afterwards: post-mount navigation goes through the `goTo` ref
  // method, and an out-of-band index reset comes with a remount (the
  // add-account wizard bumps a `session` key for exactly that).
  initialIndex: number;
  onIndexChange: (index: number) => void;
  renderPage: (index: number) => ReactNode;
  scrollEnabled?: boolean;
  // Sizes the pager. Pages fill it, so the pager needs a determinate height:
  // the default `flex: 1` works inside a flex parent, while a pager living in
  // a ScrollView (the add-account wizard) must pass an explicit height —
  // `flex` is meaningless against a content-sized scroll container.
  style?: StyleProp<ViewStyle>;
};
