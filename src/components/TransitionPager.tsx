import {
  forwardRef,
  startTransition,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  SlideInLeft,
  SlideInRight,
  SlideOutLeft,
  SlideOutRight,
} from "react-native-reanimated";

import {
  type SwipePagerHandle,
  type SwipePagerProps,
} from "@/components/swipe-pager-contract";
import { screenStyles } from "@/theme/screen-styles";

const STEP_SLIDE_MS = 280;

type Direction = "forward" | "back";

// Slide-transition pager without touch paging: renders only the active page
// inside a keyed Animated.View that slides in/out on change. Serves as
// SwipePager's iOS < 17 fallback (the SwiftUI scroll APIs @expo/ui's PagerView
// needs are 17+). Callers drive changes via the `goTo` ref + chevron buttons;
// `count`/`scrollEnabled` are accepted for API parity with the native pager
// but unused here.
export const TransitionPager = forwardRef<SwipePagerHandle, SwipePagerProps>(
  function TransitionPager(
    { initialIndex, onIndexChange, renderPage, style },
    ref,
  ) {
    // Uncontrolled, matching the native pager: `initialIndex` seeds the
    // position and `goTo` owns it afterwards, so both implementations answer
    // "which page is showing" the same way and a caller can't have one of them
    // silently ignore an index it pushed down.
    const [index, setIndex] = useState(initialIndex);
    const [direction, setDirection] = useState<Direction>("forward");
    useImperativeHandle(ref, () => ({
      goTo: (targetIndex: number) => {
        // `setDirection` runs as an urgent update and the page change lands
        // in a transition, so the outgoing keyed view re-renders with the new
        // direction BEFORE it unmounts — its SlideOut then matches the
        // incoming SlideIn. In one batched commit the exiting view would keep
        // the previous transition's direction and animate the wrong way on
        // every reversal.
        setDirection(targetIndex > index ? "forward" : "back");
        startTransition(() => {
          setIndex(targetIndex);
          onIndexChange(targetIndex);
        });
      },
    }));

    const entering = useMemo(
      () =>
        (direction === "forward" ? SlideInRight : SlideInLeft).duration(
          STEP_SLIDE_MS,
        ),
      [direction],
    );
    const exiting = useMemo(
      () =>
        (direction === "forward" ? SlideOutLeft : SlideOutRight).duration(
          STEP_SLIDE_MS,
        ),
      [direction],
    );

    return (
      <View style={[styles.container, style ?? screenStyles.flex]}>
        <Animated.View
          key={index}
          entering={entering}
          exiting={exiting}
          style={styles.page}
        >
          {renderPage(index)}
        </Animated.View>
      </View>
    );
  },
);

const styles = StyleSheet.create({
  // Clips the sliding pages to the pager's own box so an outgoing page never
  // paints over its neighbours (the wizard nav sits directly below).
  container: {
    overflow: "hidden",
  },
  // Pages are stacked, not laid out in flow: mid-transition the outgoing and
  // incoming pages are mounted together, and two in-flow `flex: 1` pages would
  // each collapse to half the container's height for the length of the slide.
  page: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
});
