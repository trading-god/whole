import { memo, type ReactNode, useMemo } from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import { MediaViewer, type MediaViewerConfig } from "expo-media-viewer";

import { RADIUS } from "@/theme/sizes";
import { SPACING } from "@/theme/spacing";

// The viewer's iOS chrome closes with a text button whose title is a bare
// English "Close" — the module reads it through NSLocalizedString without
// shipping any translation, so in a Chinese UI it was the one English control
// on screen. An icon says the same thing in no language. The prop is added by
// `patches/expo-media-viewer@0.7.2.patch`; Android already draws an icon.
const VIEWER_CONFIG: MediaViewerConfig = {
  viewer: { closeIconName: "xmark" },
};

// One thumbnail's box in the strip. Tall enough that an account row on a phone
// screenshot is still legible at a glance, narrow enough that three fit in the
// card and a fourth peeks in to say the strip scrolls.
const THUMB_WIDTH = 96;
const THUMB_HEIGHT = 168;

type ScreenshotMediaViewerProps = {
  uris: readonly string[];
  // A badge drawn over the thumbnail at `index` — recognizing, recognized, or
  // the reason that one screenshot could not be read. Per item, because in a
  // batch each screenshot has its own answer.
  renderBadge?: (index: number) => ReactNode;
};

// The screenshots a form was filled in from, tapping to a fullscreen
// pinch-to-zoom viewer. Centralizes the expo-media-viewer integration so a
// library API change lands in one place instead of per call site. Callers layer
// their own chrome (the replace button) on top as siblings.
//
// One item fills the card; several become a horizontal strip. It is the SAME
// viewer either way — `items` carries the whole batch, so opening any thumbnail
// gives the user a fullscreen pager over the rest, which is exactly what
// checking a five-screenshot batch against five filled-in forms needs. Rendering
// one viewer per thumbnail would have given five separate fullscreens, each
// stuck on its own image.
//
// `memo`-ized so a re-render of the uploader (recognizing state, error hint)
// doesn't reach the heavier MediaViewer.
export const ScreenshotMediaViewer = memo(function ScreenshotMediaViewer({
  uris,
  renderBadge,
}: ScreenshotMediaViewerProps) {
  // Built from `uris` alone, so a badge update — which arrives once per
  // screenshot while a batch is recognized, through `renderBadge`'s identity —
  // hands the native viewer the same item list rather than a fresh one.
  const items = useMemo(
    () =>
      uris.map((uri, index) => ({
        id: `screenshot-${index}`,
        type: "image" as const,
        source: uri,
      })),
    [uris],
  );

  return (
    <MediaViewer
      config={VIEWER_CONFIG}
      items={items}
      renderLayout={({ renderItem }) =>
        uris.length === 1 ? (
          renderItem(0, {
            frame: { width: "100%", height: "100%" },
            overlay: renderBadge?.(0),
          })
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.strip}
          >
            {uris.map((uri, index) => (
              <View key={uri} style={styles.thumb}>
                {renderItem(index, {
                  frame: {
                    width: THUMB_WIDTH,
                    height: THUMB_HEIGHT,
                    borderRadius: RADIUS.md,
                  },
                  overlay: renderBadge?.(index),
                })}
              </View>
            ))}
          </ScrollView>
        )
      }
    />
  );
});

const styles = StyleSheet.create({
  strip: {
    alignItems: "center",
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
  },
  thumb: {
    borderRadius: RADIUS.md,
    overflow: "hidden",
  },
});
