// Institution-config ablation: the measurement seam behind "how much of the
// engine's accuracy is per-institution configuration?"
//
// Every sample in the corpus has an `InstitutionConfig` written FOR it, so
// 17/17 measures the engine PLUS its config. Removing one tier and replaying
// the same samples turns them into measurable failures instead — the
// generalization evidence the corpus cannot otherwise supply. Each mode clears
// exactly ONE tier, which is what lets the report attribute a loss: a sample
// that survives `currency` and dies under `layout` needs visual grouping, not
// a wider currency default. `packages/ocr-eval/README.md` covers how to read
// the resulting table.
//
// This lives beside the config it degrades, not in the harness, for the reason
// `parseOcrBlocksTraced` lives in the engine: what a config field DOES is the
// knowledge of the rules that read it, and a copy maintained in the harness
// would drift the day a field is added. Diagnosis only — no app path passes an
// ablation.
import { DEFAULT_CONFIG } from "./config";
import type { InstitutionResolution } from "./detect";

// One entry per ablatable tier of `InstitutionConfig`. `equivalentTotalPattern`
// has no entry on purpose: it is a shared default every institution inherits
// rather than something an institution's own config supplies, so removing it
// would measure the engine's vocabulary, not its institution coverage.
const ABLATIONS = {
  /**
   * The whole config: the screen is from an institution nothing knows.
   *
   * This is the floor `detectInstitution` degrades to today, so it is the
   * closest thing the corpus has to "a user submitted an unrecognized
   * institution". `institutionId` becomes "unknown", which the eval compares
   * as a field; under this mode that miss is definitional, not a finding.
   */
  institution: (): InstitutionResolution => ({
    institutionId: "unknown",
    config: DEFAULT_CONFIG,
  }),
  /** The home currency a domestic app leaves off its bare figures. */
  currency: ({ institutionId, config }: InstitutionResolution) => ({
    institutionId,
    config: { ...config, defaultCurrency: undefined },
  }),
  /** The institution's own product words — where every CJK account name is. */
  keywords: ({ institutionId, config }: InstitutionResolution) => ({
    institutionId,
    config: { ...config, accountKeywords: undefined },
  }),
  /**
   * Where a region begins and ends, and where the identifying digits sit.
   *
   * The three fields move together because they answer one question — how this
   * institution's overview is SHAPED — and it is the question a screenshot
   * answers visually. This is the mode that says whether vision has anything
   * to add.
   */
  layout: ({ institutionId, config }: InstitutionResolution) => ({
    institutionId,
    config: {
      ...config,
      accountNumberEndsAccount: undefined,
      accountNumberStartsAccount: undefined,
      accountNumberLastFour: undefined,
    },
  }),
  /** The institution's prior on what it holds, when the name doesn't say. */
  kind: ({ institutionId, config }: InstitutionResolution) => ({
    institutionId,
    config: { ...config, defaultKind: undefined },
  }),
  /** The icon-tag prefixes an overview renders before an account name. */
  icons: ({ institutionId, config }: InstitutionResolution) => ({
    institutionId,
    config: { ...config, iconTags: undefined },
  }),
} satisfies Record<string, (r: InstitutionResolution) => InstitutionResolution>;

/** Which tier of institution config to remove for one replay. */
export type InstitutionAblation = keyof typeof ABLATIONS;

// Derived from the table, the way `DETECT_INSTITUTIONS` is derived from the
// configs: adding a mode above is the whole change, and the CLI's accepted
// values cannot drift from what the engine implements.
export const INSTITUTION_ABLATIONS = Object.keys(
  ABLATIONS,
) as readonly InstitutionAblation[];

/** Applies one ablation to what detection resolved. */
export function ablateInstitution(
  resolution: InstitutionResolution,
  ablation: InstitutionAblation,
): InstitutionResolution {
  return ABLATIONS[ablation](resolution);
}
