// Press-feedback constants shared across pressable surfaces, kept out of
// `sizes.ts` (which is dimensions only) so "where is press feel tuned?" has an
// obvious home.
//
// - `PRESSED_OPACITY`: buttons — a strong dim proportionate to a small target.
// - `PRESSED_OPACITY_SURFACE`: larger surfaces (cards, chips) — a lighter dim
//   proportionate to their area, so they don't flash as hard.
// - `PRESSED_SCALE_ICON`: icon-only buttons additionally scale down.
export const PRESSED_OPACITY = 0.72;
export const PRESSED_OPACITY_SURFACE = 0.8;
export const PRESSED_SCALE_ICON = 0.97;
