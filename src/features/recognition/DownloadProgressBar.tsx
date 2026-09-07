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

/** 0..1 → 0..100, the one percentage derivation the bar and readout share. */
const fractionToPercent = (fraction: number) =>
  Math.round(Math.max(0, Math.min(1, fraction)) * 100);

type DownloadProgressBarProps = {
  /** 0..1 across the whole file. */
  fraction: number;
};

export function DownloadProgressBar({ fraction }: DownloadProgressBarProps) {
  const { t } = useTranslation();
  const percentage = fractionToPercent(fraction);
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

/** The readout row under the bar: bytes at the left, percentage at the right. */
export function DownloadByteReadout({
  fraction,
  totalBytes,
}: {
  /** 0..1 across the whole file. */
  fraction: number;
  totalBytes: number;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.readoutRow}>
      <Text style={styles.readout}>
        {t("settings.engine.partialDownload", {
          size: formatBytes(Math.round(fraction * totalBytes)),
          total: formatBytes(totalBytes),
        })}
      </Text>
      <Text style={styles.readout}>
        {t("settings.engine.downloadPercentValue", {
          percentage: fractionToPercent(fraction),
        })}
      </Text>
    </View>
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
  // Bytes hug the bar's left edge, the percentage its right — one row under
  // the bar, the two facts never competing for the same starting point.
  readoutRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
});
