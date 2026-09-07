import { useEffect, useState } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { formatBytes } from "@/features/on-device-model/format-bytes";
import { COLORS } from "@/theme/colors";
import { screenStyles } from "@/theme/screen-styles";
import { RADIUS } from "@/theme/sizes";

// The download progress bar: track, brand fill. Animated width (native driver)
// so the bar moves smoothly between progress ticks instead of stepping — the
// one motion this flow needs, and the one that answers the user's "is it
// moving?" glance.
type DownloadProgressBarProps = {
  /** 0..1 across the whole file. */
  fraction: number;
};

export function DownloadProgressBar({ fraction }: DownloadProgressBarProps) {
  const { t } = useTranslation();
  const clamped = Math.max(0, Math.min(1, fraction));
  const percentage = Math.round(clamped * 100);
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
      accessibilityLabel={t("settings.engine.downloadProgress")}
      accessibilityRole="progressbar"
      accessibilityValue={{
        min: 0,
        max: 100,
        now: percentage,
        text: t("settings.engine.downloadProgressValue", {
          percentage,
        }),
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

/** The byte readout beside the bar: "{{size}} of {{total}}" via the partial copy. */
export function DownloadByteReadout({
  sizeBytes,
  totalBytes,
}: {
  sizeBytes: number;
  totalBytes: number;
}) {
  const { t } = useTranslation();
  return (
    <Text style={styles.readout}>
      {t("settings.engine.partialDownload", {
        size: formatBytes(sizeBytes),
        total: formatBytes(totalBytes),
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
    ...screenStyles.metaLine,
  },
});
