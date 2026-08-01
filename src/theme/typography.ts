// Type scale, weights, leading, and tracking — the one source of truth for
// text metrics so screens and components pull from a shared vocabulary instead
// of scattering literal `fontSize`/`fontWeight`/`lineHeight`/`letterSpacing`
// values that drift between files.
//
// Sizes are named by semantic tier (caption → display) rather than t-shirt
// size, mirroring `COLORS`'s semantic naming. A value is reused across
// unrelated surfaces (e.g. `subtitle` sits on both inputs and nav titles)
// because equal size is itself a design decision — aligning those surfaces on
// one token keeps them in lockstep.
//
// Weights/leading/tracking are the atomic companions: a text style composes
// `FONT_SIZE` + `FONT_WEIGHT` (+ optional `LINE_HEIGHT` / `LETTER_SPACING`),
// so the combination `{ fontSize: 12, fontWeight: "600", letterSpacing: 0.4 }`
// is declared via tokens instead of being copy-pasted across components.

export const FONT_SIZE = {
  // Smallest ancillary text — currency code on an account row.
  caption: 10,
  // Legends, field labels, privacy notes, account numbers, form hints.
  micro: 11,
  // Eyebrows, status chips, meta lines, pill copy, chart labels.
  eyebrow: 12,
  // Small body — choice chip labels, sm buttons, section actions, initials.
  bodySm: 13,
  // Default body — account name/balance, nav title, not-found copy.
  body: 14,
  // Larger body — picker options, lg buttons.
  bodyLg: 15,
  // Inputs, upload titles, secondary-screen nav titles.
  subtitle: 16,
  // Section headers.
  titleSm: 17,
  // Modal titles.
  title: 20,
  // Greeting, not-found title.
  heading: 24,
  // Total-balance hero figure.
  display: 34,
} as const;

export type FontSizeToken = keyof typeof FONT_SIZE;

export const FONT_WEIGHT = {
  medium: "500",
  semibold: "600",
  bold: "700",
  extrabold: "800",
} as const;

export type FontWeightToken = keyof typeof FONT_WEIGHT;

// Line heights are paired to their size tier; they are not a free-standing
// scale, so only the combinations actually in use are tokenized.
export const LINE_HEIGHT = {
  // 11pt privacy note (1.45×).
  tight: 16,
  // 14pt body copy (1.5×).
  body: 21,
  // 34pt hero figure (1.06× — intentionally tight for a large numeral).
  display: 36,
} as const;

export type LineHeightToken = keyof typeof LINE_HEIGHT;

export const LETTER_SPACING = {
  // 34pt hero figure.
  displayTight: -1.5,
  // 24pt greeting.
  headingTight: -0.6,
  // 17pt section header.
  tight: -0.2,
  // 12pt eyebrows / trigger text / picker title.
  caption: 0.4,
  // 11pt account number (monospace feel).
  numeric: 0.5,
  // 16pt input prefix glyph.
  prefix: 1.2,
  // 14pt 404 code.
  code: 2,
  // 12pt brand wordmark.
  wordmark: 2.2,
} as const;

export type LetterSpacingToken = keyof typeof LETTER_SPACING;
