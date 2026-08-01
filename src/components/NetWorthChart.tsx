import { memo, useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  Circle,
  Defs,
  LinearGradient,
  Path,
  Stop,
  Svg,
} from "react-native-svg";

import type { NetWorthSnapshot } from "@/features/assets/net-worth-history";
import { COLORS } from "@/theme/colors";
import { FONT_SIZE } from "@/theme/typography";

const VIEW_WIDTH = 330;
const VIEW_HEIGHT = 112;
const PADDING_Y = 12;

type NetWorthChartProps = {
  snapshots: readonly NetWorthSnapshot[];
  placeholderText: string;
};

type ChartGeometry = {
  fillPath: string;
  strokePath: string;
  endX: number;
  endY: number;
};

export const NetWorthChart = memo(function NetWorthChart({
  snapshots,
  placeholderText,
}: NetWorthChartProps) {
  const hasEnoughData = snapshots.length >= 2;

  const geometry = useMemo<ChartGeometry | null>(() => {
    if (!hasEnoughData) {
      return null;
    }

    const totals = snapshots.map((snapshot) => snapshot.total);
    const min = Math.min(...totals);
    const max = Math.max(...totals);
    const range = max - min || 1;
    const innerHeight = VIEW_HEIGHT - 2 * PADDING_Y;
    const stepX = VIEW_WIDTH / (totals.length - 1);
    const points = totals.map((total, index) => ({
      x: index * stepX,
      y: VIEW_HEIGHT - PADDING_Y - ((total - min) / range) * innerHeight,
    }));

    const stroke = points
      .map((point, index) => {
        const command = index === 0 ? "M" : "L";
        return `${command} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
      })
      .join(" ");
    const last = points[points.length - 1];
    const fill = `${stroke} L ${last.x.toFixed(2)} ${VIEW_HEIGHT} L ${points[0].x.toFixed(2)} ${VIEW_HEIGHT} Z`;

    return { fillPath: fill, strokePath: stroke, endX: last.x, endY: last.y };
  }, [snapshots, hasEnoughData]);

  return (
    <View style={styles.container}>
      <Svg
        height={VIEW_HEIGHT}
        preserveAspectRatio="none"
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        width="100%"
      >
        <Defs>
          <LinearGradient id="netWorthFill" x1="0" x2="0" y1="0" y2="1">
            <Stop offset="0" stopColor={COLORS.chartFill} stopOpacity="0.38" />
            <Stop offset="1" stopColor={COLORS.chartFill} stopOpacity="0" />
          </LinearGradient>
        </Defs>
        {geometry ? (
          <>
            <Path d={geometry.fillPath} fill="url(#netWorthFill)" />
            <Path
              d={geometry.strokePath}
              fill="none"
              stroke={COLORS.chartStroke}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="3"
            />
            <Circle
              cx={geometry.endX}
              cy={geometry.endY}
              fill={COLORS.chartEndpointRing}
              r="5"
            />
            <Circle
              cx={geometry.endX}
              cy={geometry.endY}
              fill={COLORS.chartEndpointDot}
              r="3"
            />
          </>
        ) : null}
      </Svg>
      {geometry ? null : (
        <View style={styles.placeholder}>
          <Text style={styles.placeholderText}>{placeholderText}</Text>
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    height: VIEW_HEIGHT,
    width: "100%",
  },
  placeholder: {
    alignItems: "center",
    bottom: 0,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  placeholderText: {
    color: COLORS.mutedOnDark,
    fontSize: FONT_SIZE.eyebrow,
  },
});
