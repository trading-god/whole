import { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";
import {
  Circle,
  Defs,
  Line,
  LinearGradient,
  Path,
  Stop,
  Svg,
} from "react-native-svg";

import { type Currency } from "@/features/assets/currencies";
import {
  type NetWorthSnapshot,
  netWorthGrowth,
  parseSnapshotDate,
} from "@/features/assets/net-worth-history";
import { COLORS } from "@/theme/colors";
import { SPACING } from "@/theme/spacing";
import { FONT_SIZE, LINE_HEIGHT } from "@/theme/typography";

const VIEW_WIDTH = 330;
const VIEW_HEIGHT = 112;
const PADDING_Y = 12;
const ENDPOINT_RADIUS = 5;
const ENDPOINT_DOT_RADIUS = 3;
// The canvas runs one marker-radius wider than the plot so the endpoint dot,
// which sits on the last sample, stays whole. The balance card clips its
// overflow to keep its rounded corners, so a dot centred on the plot's right
// edge would lose its outer half. The left edge needs no such room — it carries
// only the stroke's round cap.
const CANVAS_WIDTH = VIEW_WIDTH + ENDPOINT_RADIUS;
// Where a window with no vertical range is drawn: a flat curve, a zero axis
// with nothing above or below it, and the empty state's baseline all sit here.
// One constant rather than three copies of the expression, because the first
// sample must not jump when a second one turns the placeholder into a real
// (and initially flat) curve — that only holds while they agree.
const FLAT_WINDOW_Y = VIEW_HEIGHT / 2;

type NetWorthChartProps = {
  // Snapshots for the selected range, oldest first.
  snapshots: readonly NetWorthSnapshot[];
  // Which currency to read the growth in. Snapshots carry one figure per
  // currency because an exchange-rate move is a gain in one and nothing in
  // another, so the curve genuinely changes shape with the display currency.
  currency: Currency;
  // Whether the range's net change is negative. Passed in rather than re-derived
  // from the endpoints so the curve is colored by exactly the number the footer
  // prints beside it.
  isNegative: boolean;
  // The one thing about its own empty state the chart cannot read off
  // `snapshots`: a sample needs a rate for every currency, so a device that
  // never reached the rate service accumulates nothing at all. Everything else
  // an empty window has to say — and whether it draws its lone point — follows
  // from counting the samples, which is the chart's own job.
  ratesUnavailable: boolean;
};

type ChartGeometry = {
  fillPath: string;
  strokePath: string;
  endX: number;
  endY: number;
  // y of the zero axis, or null when the window sits entirely on one side of it
  // and there is no axis to draw inside the plot.
  zeroY: number | null;
};

// Curve palette per direction. A window that lost money is drawn in the decline
// tone so the chart's verdict survives being glanced at.
const TREND_PALETTE = {
  positive: {
    fill: COLORS.chartFill,
    stroke: COLORS.chartStroke,
    endpointRing: COLORS.chartEndpointRing,
    endpointDot: COLORS.chartEndpointDot,
  },
  negative: {
    fill: COLORS.chartFillNegative,
    stroke: COLORS.chartStrokeNegative,
    endpointRing: COLORS.chartEndpointRingNegative,
    endpointDot: COLORS.chartEndpointDotNegative,
  },
} as const;

type TrendPalette = (typeof TREND_PALETTE)[keyof typeof TREND_PALETTE];

// A hairline rule across the plot. The zero axis and the empty state's baseline
// are the same object at two tones — sharing the element is what keeps them
// looking like it when the dash rhythm or weight is retuned.
function DashedRule({ stroke, y }: { stroke: string; y: number }) {
  return (
    <Line
      stroke={stroke}
      strokeDasharray="4 5"
      strokeWidth="1"
      x1="0"
      x2={CANVAS_WIDTH}
      y1={y}
      y2={y}
    />
  );
}

// The marker on the latest sample: a ring under a solid dot, so the point stays
// legible wherever the curve leaves it.
function Endpoint({
  cx,
  cy,
  palette,
}: {
  cx: number;
  cy: number;
  palette: TrendPalette;
}) {
  return (
    <>
      <Circle cx={cx} cy={cy} fill={palette.endpointRing} r={ENDPOINT_RADIUS} />
      <Circle
        cx={cx}
        cy={cy}
        fill={palette.endpointDot}
        r={ENDPOINT_DOT_RADIUS}
      />
    </>
  );
}

// Plots growth — assets minus the capital put into them (see net-worth-flows) —
// rather than the raw total, so opening a new account doesn't step the curve up
// by its whole balance. Only balances moving after they were first recorded
// bend the line.
export const NetWorthChart = memo(function NetWorthChart({
  snapshots,
  currency,
  isNegative,
  ratesUnavailable,
}: NetWorthChartProps) {
  const { t } = useTranslation();
  const palette = TREND_PALETTE[isNegative ? "negative" : "positive"];
  // One stored sample is not a stalled chart — it is a chart whose second point
  // arrives tomorrow. The empty state both says so and plots the point, from
  // this one count.
  const isFirstReading = snapshots.length === 1;
  // Rates first: without them history can never accumulate, so the "building
  // history" copy would promise progress that cannot come.
  const placeholderCopy = ratesUnavailable
    ? t("home.chartRatesUnavailable")
    : isFirstReading
      ? t("home.chartFirstPoint")
      : t("home.chartAccumulating");

  const geometry = useMemo<ChartGeometry | null>(() => {
    if (snapshots.length < 2) {
      return null;
    }

    const values = snapshots.map((snapshot) =>
      netWorthGrowth(snapshot, currency),
    );
    const min = Math.min(...values);
    const max = Math.max(...values);
    const valueSpan = max - min;
    const innerHeight = VIEW_HEIGHT - 2 * PADDING_Y;
    // A flat window (every sample identical — the ordinary "nothing has moved
    // yet" case) has no range to scale against, so it is drawn down the middle
    // instead of pinned to the floor of the plot.
    const yFor = (value: number) =>
      valueSpan === 0
        ? FLAT_WINDOW_Y
        : VIEW_HEIGHT - PADDING_Y - ((value - min) / valueSpan) * innerHeight;

    // x is elapsed time, not sample index: two samples a day apart and two
    // three months apart must not draw the same shape, or switching the range
    // would redraw an identical curve. The window stretches across the full
    // plot width, so gaps inside it stay proportional while a history shorter
    // than the selected range still fills the card.
    const times = snapshots.map((snapshot) => parseSnapshotDate(snapshot.date));
    const firstTime = times[0];
    const timeSpan = times[times.length - 1] - firstTime;
    const xFor = (index: number) =>
      timeSpan === 0
        ? (index / (times.length - 1)) * VIEW_WIDTH
        : ((times[index] - firstTime) / timeSpan) * VIEW_WIDTH;

    const points = values.map((value, index) => ({
      x: xFor(index),
      y: yFor(value),
    }));

    // The shaded area is measured from the zero axis, not the floor of the
    // card: growth is a signed quantity, so "how far from zero" is the thing
    // worth shading. When zero falls outside the plotted range the baseline
    // lands off-canvas and the fill simply reaches the edge, which reads the
    // same as the old fill-to-floor. A window that never left zero collapses
    // the area to nothing — the honest picture: no growth, no shape.
    const zeroBaseY =
      valueSpan === 0
        ? min > 0
          ? VIEW_HEIGHT
          : min < 0
            ? 0
            : FLAT_WINDOW_Y
        : yFor(0);

    const stroke = points
      .map((point, index) => {
        const command = index === 0 ? "M" : "L";
        return `${command} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
      })
      .join(" ");
    const last = points[points.length - 1];
    const fill = `${stroke} L ${last.x.toFixed(2)} ${zeroBaseY.toFixed(2)} L ${points[0].x.toFixed(2)} ${zeroBaseY.toFixed(2)} Z`;

    return {
      fillPath: fill,
      strokePath: stroke,
      endX: last.x,
      endY: last.y,
      // Drawn only when the axis is genuinely inside the window and separate
      // from the curve — on a flat zero window the curve *is* the axis, and a
      // dashed line under a solid one is just noise.
      zeroY: valueSpan > 0 && min <= 0 && max >= 0 ? yFor(0) : null,
    };
  }, [snapshots, currency]);

  return (
    <View style={styles.container}>
      <Svg
        height={VIEW_HEIGHT}
        preserveAspectRatio="none"
        viewBox={`0 0 ${CANVAS_WIDTH} ${VIEW_HEIGHT}`}
        width="100%"
      >
        <Defs>
          {/* Fades away from the curve toward the axis. A falling window's area
              hangs below the axis, so the gradient flips with it — otherwise
              the shape that matters would be the faded end. */}
          <LinearGradient
            id="netWorthFill"
            x1="0"
            x2="0"
            y1={isNegative ? "1" : "0"}
            y2={isNegative ? "0" : "1"}
          >
            <Stop offset="0" stopColor={palette.fill} stopOpacity="0.38" />
            <Stop offset="1" stopColor={palette.fill} stopOpacity="0" />
          </LinearGradient>
        </Defs>
        {geometry === null ? (
          // Nothing to plot yet. A bare caption over an empty box reads as a
          // chart that failed to load, so the card keeps a faint baseline: it
          // says "a curve belongs here" without drawing one that isn't there.
          // A single stored sample gets its dot on that baseline — the honest
          // picture of one reading, and visibly a chart with a point in it
          // rather than a chart with nothing in it.
          <>
            <DashedRule stroke={COLORS.chartEmptyBaseline} y={FLAT_WINDOW_Y} />
            {isFirstReading ? (
              <Endpoint cx={VIEW_WIDTH} cy={FLAT_WINDOW_Y} palette={palette} />
            ) : null}
          </>
        ) : (
          <>
            {geometry.zeroY === null ? null : (
              <DashedRule stroke={COLORS.chartZeroLine} y={geometry.zeroY} />
            )}
            <Path d={geometry.fillPath} fill="url(#netWorthFill)" />
            <Path
              d={geometry.strokePath}
              fill="none"
              stroke={palette.stroke}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="3"
            />
            <Endpoint cx={geometry.endX} cy={geometry.endY} palette={palette} />
          </>
        )}
      </Svg>
      {geometry === null ? (
        <View style={styles.placeholder}>
          <Text style={styles.placeholderText}>{placeholderCopy}</Text>
        </View>
      ) : null}
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
    // The chart bleeds to the card's edges (its wrapper cancels the card
    // padding), which is right for a curve and wrong for a sentence: without
    // this the longer placeholder copy runs to the screen edge.
    paddingHorizontal: SPACING.xl,
    position: "absolute",
    right: 0,
    // Confined to the half below the baseline — centred on the plot, the dashes
    // would run straight through the caption. Stated as a fraction of this
    // container rather than as `FLAT_WINDOW_Y`: that constant is an SVG
    // user-space coordinate, and it only doubles as a dp offset while the
    // canvas happens to render at exactly `VIEW_HEIGHT`.
    top: "50%",
  },
  placeholderText: {
    color: COLORS.mutedOnDark,
    fontSize: FONT_SIZE.eyebrow,
    lineHeight: LINE_HEIGHT.eyebrow,
    textAlign: "center",
  },
});
