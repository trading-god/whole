// `brand` is the canonical brand color. The splash wordmark baked by
// `scripts/generate-app-icons.mjs` mirrors it — regenerate the icons
// (`pnpm generate:icons`) when this value changes.
export const COLORS = {
  background: "#F4F6F2",
  card: "#FFFFFF",
  ink: "#14231D",
  muted: "#728078",
  subtle: "#A8B1AC",
  border: "#E5EAE6",
  brand: "#098765",
  brandDark: "#103D31",
  brandSoft: "#E4F3ED",
  // Border tone for accent elements on brandSoft surfaces (upload-card hint,
  // selected currency chip).
  brandSoftBorder: "#A9CDBF",
  brandShadow: "#054A36",
  danger: "#C7443E",
  cardBorder: "rgba(25, 55, 43, 0.04)",
  outlineBorder: "rgba(20, 35, 29, 0.18)",
  // Dark overlay scrim for modals and image previews.
  scrim: "rgba(8, 28, 22, 0.46)",
  surfaceMuted: "#F1F3F0",
  secondaryFill: "#CDD5CC",
  secondaryInk: "#344238",
  white: "#FFFFFF",
  disabledBg: "#E1E6E2",
  disabledText: "#A0ABA4",
  // Muted text on the dark brand card (balance eyebrow, chart period, chart
  // placeholder). Distinct from `muted`/`subtle`, which sit on light surfaces.
  mutedOnDark: "#ABC1B8",
  // Rising accent on the dark brand card (change pill, chart delta, trend).
  // `brand` itself is too dark to read on `brandDark` (2.7:1), so this is the
  // brand hue family carried onto the dark surface — same green, legible tone.
  accentOnDark: "#8CE1C1",
  // Soft accent fills/borders on the dark brand card (change pill chip).
  accentOnDarkSoft: "rgba(130, 220, 185, 0.14)",
  accentOnDarkBorder: "rgba(130, 220, 185, 0.18)",
  // Falling twin of `accentOnDark`, used when net worth shrank over the
  // selected range. This is `danger` on a dark surface — same hue (3°),
  // lightened and saturated until it reads there, exactly as `accentOnDark`
  // does for `brand`. `danger` at its own value manages 2.5:1 on `brandDark`
  // and is effectively invisible, so the surface variant is a separate token
  // rather than a second red.
  negativeOnDark: "#EE9A96",
  negativeOnDarkSoft: "rgba(238, 154, 150, 0.14)",
  negativeOnDarkBorder: "rgba(238, 154, 150, 0.22)",
  // Hairline divider on the dark brand card (chart footer top border).
  dividerOnDark: "rgba(255, 255, 255, 0.08)",
  // Net-worth chart palette, tokenized with the rest of the on-dark card. Four
  // steps of the brand hue family (~157°), from the endpoint ring down to the
  // dot.
  chartFill: "#77D2B1",
  chartStroke: "#79D7B5",
  chartEndpointRing: "#D9FFF0",
  chartEndpointDot: "#69C8A6",
  // The same four steps mirrored onto `danger`'s hue (3°) — identical
  // lightness per step, so a falling chart carries the same weight as a rising
  // one instead of looking like a different chart. The curve plots growth,
  // which goes negative, and a dip should read as one before the number is.
  chartFillNegative: "#D27B77",
  chartStrokeNegative: "#D77D79",
  chartEndpointRingNegative: "#FFDBD9",
  chartEndpointDotNegative: "#C86D69",
  // Hairline zero axis behind the growth curve. Growth crosses zero, so the
  // axis has to be visible for "above" and "below" to mean anything.
  chartZeroLine: "rgba(255, 255, 255, 0.16)",
  // Reference line across a chart that has nothing to plot yet — the "a curve
  // belongs here" anchor a bare line of placeholder text cannot give. One step
  // fainter than `chartZeroLine`, which marks a real axis on a chart that has
  // data: this one carries no reading, so it must not compete with one.
  chartEmptyBaseline: "rgba(255, 255, 255, 0.12)",
};
