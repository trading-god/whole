import { describe, expect, it } from "@jest/globals";
import { Dimensions } from "react-native";
import { renderHook } from "@testing-library/react-native";

import { MIN_INTERACTIVE_SIZE, useResponsiveLayout } from "@/theme/layout";

// The hook reads the viewport through `Dimensions` (subscribed via
// `useSyncExternalStore` over the derived boolean), so the tests stage each
// viewport with `Dimensions.set` — the supported way to fake the window in a
// Jest environment, kept here rather than mocking the internal
// `useWindowDimensions` path the hook no longer uses.
const withViewport = async (width: number, fontScale: number) => {
  Dimensions.set({
    window: { width, height: 800, scale: 2, fontScale },
  });
  const { result } = await renderHook(() => useResponsiveLayout());
  return result.current;
};

// Layout responds to available space and the user's font scale rather than to
// a locale, so switching languages never introduces a second set of rules.
//
// `renderHook` is async in @testing-library/react-native v14, exactly like
// `render` — the promise is how React 19 gets to flush concurrently.
describe("useResponsiveLayout", () => {
  it("is not compact on a roomy viewport at the default font scale", async () => {
    expect((await withViewport(390, 1)).isCompact).toBe(false);
  });

  it("is compact on a narrow viewport", async () => {
    expect((await withViewport(360, 1)).isCompact).toBe(true);
  });

  it("is not compact just above the narrow viewport threshold", async () => {
    expect((await withViewport(361, 1)).isCompact).toBe(false);
  });

  // Either trigger alone is enough: a large font scale needs the compact layout
  // even on a wide screen, because the text is what runs out of room.
  it("is compact at a large font scale on a wide viewport", async () => {
    expect((await withViewport(430, 1.3)).isCompact).toBe(true);
  });

  it("is not compact just below the font-scale threshold", async () => {
    expect((await withViewport(430, 1.29)).isCompact).toBe(false);
  });
});

describe("MIN_INTERACTIVE_SIZE", () => {
  it("is the platform minimum touch target", () => {
    expect(MIN_INTERACTIVE_SIZE).toBe(48);
  });
});
