import { SPACING } from "@/theme/spacing";

// Pill/chip radius — small capsule controls (choice chips, status chip,
// currency trigger, change pill, inline delete). Keeps the chip family on one
// value instead of drifting between 13 and 14.
export const CHIP_RADIUS = 13;

// Pill/chip min height — choice chips and the settings status chip share this
// capsule height so the chip family stays on one value. Compact controls
// (currency trigger, inline delete) keep their own calibrated 28pt height.
export const CHIP_HEIGHT = 34;
export type Size = "xs" | "sm" | "md" | "lg";

// `xs` is the chip-sized button: it paints at CHIP_HEIGHT so a row of
// shortcuts reads as chips rather than as a stack of full-weight actions.
//
// It was added because `sm` and `md` painted the SAME 48pt box, which made
// "small" a label with no effect — a row of four "small" preset buttons took a
// third of the settings screen. Sizes that do not differ are not sizes.
//
// Compactness is paid for with hit slop, not with the touch target: see
// `BUTTON_HITSLOP`.
export const BUTTON_SIZES: Record<Size, number> = {
  xs: CHIP_HEIGHT,
  sm: 40,
  md: 48,
  lg: 54,
};

// What each size adds around itself so the EFFECTIVE touch target still clears
// `MIN_INTERACTIVE_SIZE`, whatever the painted box.
//
// This is the whole reason a control may be visually smaller than 48pt. A chip
// that is 34pt tall and 34pt tappable is a control people miss; one that is
// 34pt tall and 48pt tappable is a control that reads light and behaves
// correctly. Every button applies its size's value by default.
export const BUTTON_HITSLOP: Record<Size, number> = {
  xs: 7,
  sm: 4,
  md: 0,
  lg: 0,
};

// Horizontal half of the button box model, beside `BUTTON_SIZES`' vertical
// one. Exported rather than inlined into `Button` because a caller that has to
// cancel this padding — a transparent button aligned into a column of text —
// must cancel exactly it; two hand-written `SPACING.lg`s drift apart silently.
export const BUTTON_HORIZONTAL_PADDING = SPACING.lg;

export const ICON_BUTTON_SIZES: Record<Size, number> = {
  xs: CHIP_HEIGHT,
  sm: 40,
  md: 48,
  lg: 56,
};

// Radius grows with the control. `xs` is NOT `CHIP_RADIUS`: that value belongs
// to capsule chips, and borrowing it here put the smallest button (13) above
// the next size up (12), which read as the small control being the roundest
// thing on screen. A scale that inverts at one end is not a scale.
export const RADIUS: Record<Size, number> = {
  xs: 10,
  sm: 12,
  md: 16,
  lg: 18,
};

// Card surface radius — the standard rounded container (matches cardSurface in
// screen-styles.ts). Hero surfaces such as the home balance card keep a larger
// literal radius as a deliberate exception.
export const CARD_RADIUS = 22;

// Account row height — the standard collapsed row's minimum height, shared by
// AccountRow and the home screen's loading/error placeholders so the accounts
// card reserves a consistent footprint before any rows render.
export const ACCOUNT_ROW_HEIGHT = 76;
