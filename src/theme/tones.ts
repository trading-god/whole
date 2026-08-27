import { COLORS } from "@/theme/colors";

// Semantic surfaces: what a block of copy MEANS, not what colour someone liked.
//
// A screen asks for `TONES.safe` or `TONES.caution` and never for a hex value.
// That is what stops two surfaces that mean the same thing drifting to two
// different greens, and it is what makes "which of these is the reassuring one"
// answerable by reading the call site instead of the palette.
//
// Each tone carries all three parts of a surface together, because they are
// only legible as a set: an ink chosen for one background is not guaranteed to
// clear contrast on another.

export type Tone = "safe" | "caution";

export type ToneStyle = {
  /** Background of the block. */
  surface: string;
  /** Hairline around it. */
  border: string;
  /** Text colour with enough contrast on that surface. */
  ink: string;
};

export const TONES: Record<Tone, ToneStyle> = {
  // Nothing leaves the device. The brand green is the app's own "this is
  // fine" colour, so reassurance reuses it rather than inventing one.
  safe: {
    surface: COLORS.brandSoft,
    border: COLORS.brandSoftBorder,
    ink: COLORS.brandDark,
  },
  // Allowed, and it has a cost. Deliberately NOT `danger`: red is reserved for
  // destructive actions, and spending it on "your data goes somewhere" would
  // leave nothing louder for "this deletes an account".
  caution: {
    surface: COLORS.cautionSoft,
    border: COLORS.cautionSoftBorder,
    ink: COLORS.caution,
  },
};
