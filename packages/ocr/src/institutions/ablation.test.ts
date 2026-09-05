import { describe, expect, it } from "vitest";

import { INSTITUTION_ABLATIONS, ablateInstitution } from "./ablation";
import { DEFAULT_CONFIG, INSTITUTION_CONFIGS } from "./config";
import type { InstitutionResolution } from "./detect";

// A resolution shaped the way `resolveInstitutionConfig` produces one: the
// institution's overrides layered on the shared defaults. Ablating a raw
// override map would pass while the real merged config still carried the field.
function resolutionFor(
  institutionId: keyof typeof INSTITUTION_CONFIGS,
): InstitutionResolution {
  const overrides = INSTITUTION_CONFIGS[institutionId];
  return {
    institutionId,
    config: {
      ...DEFAULT_CONFIG,
      ...overrides,
      detect: { ...DEFAULT_CONFIG.detect, ...overrides.detect },
    },
  };
}

describe("institution ablation", () => {
  it("lists every mode the table implements", () => {
    // Derived from the table, so this is really asserting that a mode added
    // above is reachable from the CLI without a second edit.
    expect([...INSTITUTION_ABLATIONS].sort()).toEqual([
      "currency",
      "icons",
      "institution",
      "keywords",
      "kind",
      "layout",
    ]);
  });

  it("drops the whole config and the id under `institution`", () => {
    // The floor `detectInstitution` already degrades to, which is what makes
    // this mode the answer to "a user submitted an institution nothing knows".
    const ablated = ablateInstitution(resolutionFor("ocbc"), "institution");

    expect(ablated.institutionId).toBe("unknown");
    expect(ablated.config).toBe(DEFAULT_CONFIG);
  });

  it("drops only the home currency under `currency`", () => {
    const ocbc = resolutionFor("ocbc");
    const ablated = ablateInstitution(ocbc, "currency");

    expect(ocbc.config.defaultCurrency).toBe("SGD");
    expect(ablated.config.defaultCurrency).toBeUndefined();
    // The routing survives: this mode asks what the currency default is worth,
    // not what the whole config is worth.
    expect(ablated.institutionId).toBe("ocbc");
    expect(ablated.config.defaultKind).toBe(ocbc.config.defaultKind);
    expect(ablated.config.iconTags).toEqual(ocbc.config.iconTags);
  });

  it("drops only the product words under `keywords`", () => {
    const ocbc = resolutionFor("ocbc");
    const ablated = ablateInstitution(ocbc, "keywords");

    expect(ocbc.config.accountKeywords).toEqual(["global", "statement"]);
    expect(ablated.config.accountKeywords).toBeUndefined();
    expect(ablated.config.defaultCurrency).toBe("SGD");
  });

  it("drops all three layout rules together under `layout`", () => {
    // They answer one question — how this institution's overview is SHAPED —
    // and BOCHK is the sample that declares two of the three.
    const bochk = resolutionFor("bochk");
    const ablated = ablateInstitution(bochk, "layout");

    expect(bochk.config.accountNumberEndsAccount).toBe(true);
    expect(bochk.config.accountNumberLastFour).toBeInstanceOf(RegExp);
    expect(ablated.config.accountNumberEndsAccount).toBeUndefined();
    expect(ablated.config.accountNumberStartsAccount).toBeUndefined();
    expect(ablated.config.accountNumberLastFour).toBeUndefined();
    expect(ablated.config.defaultCurrency).toBe("HKD");
  });

  it("drops only the kind prior under `kind`", () => {
    const okx = resolutionFor("okx");
    const ablated = ablateInstitution(okx, "kind");

    expect(okx.config.defaultKind).toBe("crypto");
    expect(ablated.config.defaultKind).toBeUndefined();
  });

  it("drops only the icon tags under `icons`", () => {
    const ocbc = resolutionFor("ocbc");
    const ablated = ablateInstitution(ocbc, "icons");

    expect(ocbc.config.iconTags).toEqual(["360", "gsa", "sts"]);
    expect(ablated.config.iconTags).toBeUndefined();
    expect(ablated.config.accountKeywords).toEqual(["global", "statement"]);
  });

  it("leaves the input resolution untouched", () => {
    // The harness replays the same corpus under six modes in one process, so a
    // mutating ablation would leak the previous mode's damage into the next.
    const ocbc = resolutionFor("ocbc");
    ablateInstitution(ocbc, "currency");
    ablateInstitution(ocbc, "layout");

    expect(ocbc.config.defaultCurrency).toBe("SGD");
  });
});
