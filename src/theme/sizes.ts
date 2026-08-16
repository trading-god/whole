import { SPACING } from "@/theme/spacing";

export type Size = "sm" | "md" | "lg";

export const BUTTON_SIZES: Record<Size, number> = {
  sm: 48,
  md: 48,
  lg: 54,
};

// Horizontal half of the button box model, beside `BUTTON_SIZES`' vertical
// one. Exported rather than inlined into `Button` because a caller that has to
// cancel this padding — a transparent button aligned into a column of text —
// must cancel exactly it; two hand-written `SPACING.lg`s drift apart silently.
export const BUTTON_HORIZONTAL_PADDING = SPACING.lg;

export const ICON_BUTTON_SIZES: Record<Size, number> = {
  sm: 48,
  md: 48,
  lg: 56,
};

export const RADIUS: Record<Size, number> = {
  sm: 12,
  md: 16,
  lg: 18,
};

// Card surface radius — the standard rounded container (matches cardSurface in
// screen-styles.ts). Hero surfaces such as the home balance card keep a larger
// literal radius as a deliberate exception.
export const CARD_RADIUS = 22;

// Pill/chip radius — small capsule controls (choice chips, status chip,
// currency trigger, change pill, inline delete). Keeps the chip family on one
// value instead of drifting between 13 and 14.
export const CHIP_RADIUS = 13;

// Pill/chip min height — choice chips and the settings status chip share this
// capsule height so the chip family stays on one value. Compact controls
// (currency trigger, inline delete) keep their own calibrated 28pt height.
export const CHIP_HEIGHT = 34;

// Account row height — the standard collapsed row's minimum height, shared by
// AccountRow and the home screen's loading/error placeholders so the accounts
// card reserves a consistent footprint before any rows render.
export const ACCOUNT_ROW_HEIGHT = 76;
