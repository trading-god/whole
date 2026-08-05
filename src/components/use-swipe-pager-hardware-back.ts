import { useEffect, type RefObject } from "react";
import { BackHandler } from "react-native";

import { type SwipePagerHandle } from "@/components/swipe-pager-contract";

// Android hardware back for SwipePager screens: swallow while `busy` (so the
// hardware button matches the disabled chevrons), step back one page when not
// on the first, and otherwise fall through (`false`) so the router/system
// default applies. `enabled: false` opts a screen out entirely (no listener
// registered — e.g. the add-account screen outside multi-account mode).
// Harmless on iOS, where the event never fires.
export function useSwipePagerHardwareBack({
  pagerRef,
  index,
  busy,
  enabled = true,
}: {
  pagerRef: RefObject<SwipePagerHandle | null>;
  index: number;
  busy: boolean;
  enabled?: boolean;
}) {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        if (busy) {
          return true;
        }
        if (index > 0) {
          pagerRef.current?.goTo(index - 1);
          return true;
        }
        return false;
      },
    );
    return () => subscription.remove();
  }, [pagerRef, index, busy, enabled]);
}
