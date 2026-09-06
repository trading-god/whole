import { useEffect, useState } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { formatBytes } from "@/features/on-device-model/format-bytes";
import { BUNDLED_MODEL } from "@/features/on-device-model/on-device-catalog";
import { COLORS } from "@/theme/colors";
import { RADIUS } from "@/theme/sizes";
import { FONT_SIZE, LINE_HEIGHT } from "@/theme/typography";

// The download progress bar: track, brand fill. Animated width (native driver)
// so the bar moves smoothly between progress ticks instead of stepping — the
// one motion this flow needs, and the one that answers the user's "is it
// moving?" glance.
type DownloadProgressBarProps = {
  /** 0..1 across the whole model. */
  fraction: number;
};

export function DownloadProgressBar({ fraction }: DownloadProgressBarProps) {
  const clamped = Math.max(0, Math.min(1, fraction));
  const [width] = useState(() => new Animated.Value(clamped));
  useEffect(() => {
    Animated.timing(width, {
      toValue: clamped,
      duration: 200,
      useNativeDriver: false,
    }).start();
  }, [clamped, width]);

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{
        min: 0,
        max: 100,
        now: Math.round(clamped * 100),
      }}
      style={styles.track}
    >
      <Animated.View
        style={[
          styles.fill,
          {
            width: width.interpolate({
              inputRange: [0, 1],
              outputRange: ["0%", "100%"],
            }),
          },
        ]}
      />
    </View>
  );
}

/** The byte readout beside the bar: "1.5 GB of 3.1 GB" via the partial copy. */
export function DownloadByteReadout({ sizeBytes }: { sizeBytes: number }) {
  const { t } = useTranslation();
  return (
    <Text style={styles.readout}>
      {t("settings.engine.partialDownload", {
        size: formatBytes(sizeBytes),
        total: formatBytes(BUNDLED_MODEL.sizeBytes),
      })}
    </Text>
  );
}

const styles = StyleSheet.create({
  track: {
    backgroundColor: COLORS.surfaceMuted,
    borderRadius: RADIUS.xs,
    height: 8,
    overflow: "hidden",
    width: "100%",
  },
  fill: {
    backgroundColor: COLORS.brand,
    borderRadius: RADIUS.xs,
    height: "100%",
  },
  readout: {
    color: COLORS.muted,
    fontSize: FONT_SIZE.micro,
    lineHeight: LINE_HEIGHT.tight,
  },
});
