import { memo } from "react";

import { MediaViewer, type MediaViewerConfig } from "expo-media-viewer";

// The viewer's iOS chrome closes with a text button whose title is a bare
// English "Close" — the module reads it through NSLocalizedString without
// shipping any translation, so in a Chinese UI it was the one English control
// on screen. An icon says the same thing in no language. The prop is added by
// `patches/expo-media-viewer@0.7.2.patch`; Android already draws an icon.
const VIEWER_CONFIG: MediaViewerConfig = {
  viewer: { closeIconName: "xmark" },
};

// A single screenshot that taps to open a fullscreen pinch-to-zoom viewer.
// Centralizes the expo-media-viewer integration (single-item list + renderLayout)
// so a library API change lands in one place instead of per call site. Callers
// layer their own overlay (badge, replace button) on top as siblings.
//
// `memo`-ized so a re-render of the uploader (recognizing state, error hint)
// doesn't reach the heavier MediaViewer: `uri` is a primitive, so the shallow
// compare only lets a genuinely different screenshot through.
export const ScreenshotMediaViewer = memo(function ScreenshotMediaViewer({
  uri,
}: {
  uri: string;
}) {
  return (
    <MediaViewer
      config={VIEWER_CONFIG}
      items={[{ id: "screenshot", type: "image", source: uri }]}
      renderLayout={({ renderItem }) =>
        renderItem(0, { frame: { width: "100%", height: "100%" } }) ?? null
      }
    />
  );
});
