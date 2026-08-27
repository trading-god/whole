import { memo } from "react";

import { MediaViewer } from "expo-media-viewer";

// A single screenshot that taps to open a fullscreen pinch-to-zoom viewer.
// Centralizes the expo-media-viewer integration (single-item list + renderLayout)
// so a library API change lands in one place instead of per call site. Callers
// layer their own overlay (scrim, badge, replace button) on top as siblings.
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
      items={[{ id: "screenshot", type: "image", source: uri }]}
      renderLayout={({ renderItem }) =>
        renderItem(0, { frame: { width: "100%", height: "100%" } }) ?? null
      }
    />
  );
});
