import { describe, expect, it } from "@jest/globals";

import { COLORS } from "@/theme/colors";
import { TONES, type Tone } from "@/theme/tones";

const TONE_NAMES = Object.keys(TONES) as Tone[];

// A tone is a SEMANTIC surface: it says what a block of copy means, not what
// colour someone liked. Screens ask for "safe" or "caution" and never for a
// hex value, which is what stops two surfaces that mean the same thing drifting
// to two different greens.
describe("TONES", () => {
  it.each(TONE_NAMES)("gives %s a surface, a border and an ink", (tone) => {
    expect(TONES[tone].surface).toBeTruthy();
    expect(TONES[tone].border).toBeTruthy();
    expect(TONES[tone].ink).toBeTruthy();
  });

  // Every value comes from the palette rather than being written inline here,
  // so a tone cannot introduce a colour the rest of the app has never seen.
  it("draws every value from the palette", () => {
    const palette = new Set<string>(Object.values(COLORS));

    for (const tone of TONE_NAMES) {
      for (const value of Object.values(TONES[tone])) {
        expect(palette.has(value)).toBe(true);
      }
    }
  });

  // The whole point is that they read as different at a glance. Two tones
  // sharing a surface would make the distinction invisible while still looking
  // deliberate in the code.
  it("gives each tone its own surface", () => {
    const surfaces = TONE_NAMES.map((tone) => TONES[tone].surface);

    expect(new Set(surfaces).size).toBe(surfaces.length);
  });

  it("carries the two meanings the app currently expresses", () => {
    expect(TONE_NAMES.sort()).toEqual(["caution", "safe"]);
  });
});
