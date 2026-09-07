import { type ViewStyle } from "react-native";

import { SPACING } from "@/theme/spacing";
import { FONT_SIZE } from "@/theme/typography";

// Geometry shared by the account list's two row kinds — AccountRow and
// AccountGroupRow — so grouped and ungrouped rows keep one rhythm even though
// one renders an avatar and the other a chevron. Owned here, not in
// `src/theme/`, because it is this feature's layout, not a cross-app token.

// Account row height — the standard collapsed row's minimum height, shared by
// both row kinds and the home screen's loading/error placeholders so the
// accounts card reserves a consistent footprint before any rows render.
export const ACCOUNT_ROW_HEIGHT = 76;

// The leading column both rows start with, so their names and dividers stay
// aligned.
export const ACCOUNT_LIST_LEADING_SIZE = 44;
export const ACCOUNT_LIST_LEADING_WIDTH =
  ACCOUNT_LIST_LEADING_SIZE + SPACING.md;

// Wide layout: the trailing figure's share of the row. Capped so a long
// figure never squeezes the name column to nothing.
export const ACCOUNT_LIST_TRAILING_MAX_WIDTH = "44%";

// Compact layout: the row wraps, and the trailing figure drops onto its own
// full-width line below the name (the width cap and the name-column gap both
// reset). Shared verbatim by both row kinds so compact spacing cannot drift
// between them.
export const ACCOUNT_LIST_ROW_COMPACT: ViewStyle = {
  alignItems: "flex-start",
  flexWrap: "wrap",
  paddingVertical: SPACING.md,
  rowGap: SPACING.sm,
};

// Deliberately unannotated (`as const`, no ViewStyle/TextStyle tag): the
// trailing element differs by row kind — a View column in AccountRow, the
// Text total in AccountGroupRow — and the properties it sets are valid in
// both positions; a ViewStyle annotation would leak `userSelect: string`
// into the Text position.
export const ACCOUNT_LIST_TRAILING_COMPACT = {
  flexBasis: "100%",
  marginLeft: 0,
  maxWidth: undefined,
} as const;

// Font-shrink floor for the trailing figure: shrink before clipping — a
// tail-ellipsised figure cuts the least-significant digits and reads as a
// wrong number, while a smaller one is still the right number.
export const ACCOUNT_LIST_BALANCE_MIN_FONT_SCALE = 0.75;

// Compact layout: the trailing figure drops one type size when it wraps onto
// its own line. Owned here, like the compact layout fragments above, so the
// two row kinds' compact figures cannot drift apart.
export const ACCOUNT_LIST_BALANCE_COMPACT = {
  fontSize: FONT_SIZE.bodySm,
} as const;

// Wide layout: where the row separator starts — the card's gutter plus the
// leading column. Composed here so a change to either row's horizontal rhythm
// lands in both separators at once.
export const ACCOUNT_LIST_SEPARATOR_INSET =
  SPACING.lg + ACCOUNT_LIST_LEADING_WIDTH;
