import { forwardRef, useImperativeHandle, useRef } from "react";
import { Platform, View } from "react-native";
import { PagerView, type PagerViewRef } from "@expo/ui/community/pager-view";

import {
  type SwipePagerHandle,
  type SwipePagerProps,
} from "@/components/swipe-pager-contract";
import { TransitionPager } from "@/components/TransitionPager";
import { screenStyles } from "@/theme/screen-styles";

export { type SwipePagerHandle } from "@/components/swipe-pager-contract";

// @expo/ui's PagerView drives paging through SwiftUI scroll APIs that are
// gated behind `#available(iOS 17)` — on earlier iOS the modifiers silently
// pass through, `setPage` does nothing, and `onPageSelected` never fires,
// which would dead-end onboarding (the first-run gate) and the multi-account
// wizard. The app's deployment floor is iOS 16.4, so those devices fall back
// to the slide-transition pager: no finger swipe, but the chevron/`goTo`
// navigation stays fully functional. Checked once at module scope — the OS
// version can't change mid-session.
const needsTransitionFallback =
  Platform.OS === "ios" && parseInt(String(Platform.Version), 10) < 17;

// The @expo/ui-backed pager: native paging + native TextInput gesture
// priority, so horizontal swipes don't hijack text selection.
const NativePager = forwardRef<SwipePagerHandle, SwipePagerProps>(
  function NativePager(
    {
      count,
      initialIndex,
      onIndexChange,
      renderPage,
      scrollEnabled = true,
      style,
    },
    ref,
  ) {
    const pagerRef = useRef<PagerViewRef>(null);
    useImperativeHandle(ref, () => ({
      goTo: (targetIndex: number) => {
        pagerRef.current?.setPage(targetIndex);
      },
    }));

    return (
      <PagerView
        ref={pagerRef}
        initialPage={initialIndex}
        scrollEnabled={scrollEnabled}
        onPageSelected={(event) => onIndexChange(event.nativeEvent.position)}
        style={style ?? screenStyles.flex}
      >
        {Array.from({ length: count }, (_, pageIndex) => (
          <View key={pageIndex} style={screenStyles.flex}>
            {renderPage(pageIndex)}
          </View>
        ))}
      </PagerView>
    );
  },
);

// Horizontal pager. Uses @expo/ui's PagerView where available (see the iOS 17
// note above) and TransitionPager on the pre-17 fallback path. Both variants
// implement the same contract, so the choice is a module-scope alias rather
// than a wrapper component re-deciding it on every render.
export const SwipePager = needsTransitionFallback
  ? TransitionPager
  : NativePager;
