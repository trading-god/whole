// Spacing scale on a 4pt grid. Centralized so screens and components pull from
// one set of dimensions instead of drifting between literal values (16/18/20/22
// for card padding, 26/28 for section gaps, etc.). Prefer `SPACING.md` over a
// bare `12` for any margin/padding/gap that is part of the layout rhythm.
//
// Exception: purely optical micro-values (`0`, `2` for decorative insets) and
// layout-specific constants (e.g. AccountRow's 72pt separator inset, which
// aligns to the icon) stay literal — forcing them onto the grid would regress
// alignment.
export const SPACING = {
  xs: 4, // hairline gaps, icon insets
  sm: 8, // tight gaps, control vertical padding, label→input
  md: 12, // field vertical rhythm, sub-section gaps
  lg: 16, // card horizontal padding, standard gap
  xl: 20, // screen content horizontal padding
  xxl: 24, // screen bottom padding, section gaps
  xxxl: 32, // large blocks (used sparingly)
} as const;

export type SpacingToken = keyof typeof SPACING;
