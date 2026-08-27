import {
  ASSET_KIND_DISTRIBUTION_COLORS,
  knownAssetKinds,
} from "@/features/assets/account-appearance";
import { type AssetKind } from "@whole/ocr";

// Largest-remainder rounding so the legend percentages always sum to 100 —
// naive per-kind Math.round can sum to 99 or 101 (e.g. 33/33/33). Returns all
// zeros when the total is non-positive so the empty/no-rates case stays clean.
//
// A kind's total can be NEGATIVE: a credit card's balance is what you owe, and
// it sits under `cash`. This bar shows what the money is made of, and a
// negative slice has no meaning there — worse, leaving it in the denominator
// pushes the other kinds past 100% (cash −1,000 with investments 5,000 would
// render investments at 125%). Negative kinds are therefore excluded from the
// composition; they still count in net worth, which is summed elsewhere.
export function roundPercentages(shares: readonly number[]): number[] {
  const positive = shares.map((share) => (share > 0 ? share : 0));
  const total = positive.reduce((sum, value) => sum + value, 0);
  if (total <= 0) {
    return shares.map(() => 0);
  }
  const raw = positive.map((share) => (share / total) * 100);
  const floored = raw.map((value) => Math.floor(value));
  let remainder = 100 - floored.reduce((sum, value) => sum + value, 0);
  const byFraction = raw
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction);
  for (let i = 0; i < remainder; i += 1) {
    floored[byFraction[i % byFraction.length].index] += 1;
  }
  return floored;
}

// One legend/bar entry per asset kind. The signed total behind the percentage
// is carried as flags rather than a number: `held` because a real holding can
// round to 0% (0.4% of net worth) and filtering the legend on the PERCENT
// dropped that kind off the screen entirely — the user holds crypto and the
// home screen said they held none; `inComposition` because a NEGATIVE total
// counts as held too (the composition bar excludes it on purpose — a negative
// slice is meaningless, see `roundPercentages` — but dropping the row said the
// user has no cash while the net worth above it was quietly subtracting a
// card's debt).
export type DistributionSlice = {
  kind: AssetKind;
  percent: number;
  held: boolean;
  inComposition: boolean;
  color: string;
};

// The per-kind shares of the composition bar and its legend, from the
// per-kind totals the home screen already computed. Pure: no React, no i18n —
// the localized label is added at render time so this stays testable as data.
export function buildDistribution(
  totalsByKind: Readonly<Record<AssetKind, number>>,
): DistributionSlice[] {
  const percents = roundPercentages(
    knownAssetKinds.map((kind) => totalsByKind[kind]),
  );
  return knownAssetKinds.map((kind, index) => ({
    kind,
    percent: percents[index],
    held: totalsByKind[kind] !== 0,
    inComposition: totalsByKind[kind] > 0,
    color: ASSET_KIND_DISTRIBUTION_COLORS[kind],
  }));
}
