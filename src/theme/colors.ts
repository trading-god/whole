// `brand` is the canonical brand color. The static config files mirror it —
// `app.json` (`expo.web.themeColor`) and `public/manifest.json` (`theme_color`).
// Keep them in sync when this value changes.
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
  // Positive accent on the dark brand card (change pill, chart delta, trend).
  accentOnDark: "#8CE1C1",
  // Soft accent fills/borders on the dark brand card (change pill chip).
  accentOnDarkSoft: "rgba(130, 220, 185, 0.14)",
  accentOnDarkBorder: "rgba(130, 220, 185, 0.18)",
  // Hairline divider on the dark brand card (chart footer top border).
  dividerOnDark: "rgba(255, 255, 255, 0.08)",
  // Net-worth chart palette, tokenized with the rest of the on-dark card.
  chartFill: "#77D2B1",
  chartStroke: "#79D7B5",
  chartEndpointRing: "#D9FFF0",
  chartEndpointDot: "#69C8A6",
};
