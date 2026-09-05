// `@whole/ocr` — the account-recognition engine.
//
// Given the OCR blocks of an account screenshot, this package answers: what
// accounts are on this screen, what are they called, what are their balances
// per currency, what are the last four digits, and which institution is this?
// A deterministic rule pipeline reads the structure; an INJECTED model call
// annotates the semantics rules cannot know (see "The model pipeline" below).
// It is pure TypeScript with one dependency (zod) — no React Native, no Expo,
// no filesystem — so the same code runs in the app (via Metro), in Node (the
// eval harness and CLI), and under Vitest.
//
// Layers, innermost first:
//   contract/      what a recognized account IS (currencies, kinds, balances,
//                  blocks) — the vocabulary the app and the engine must agree on
//   engine/        the rules that read pixels-turned-text into those shapes
//   institutions/  per-institution overrides layered on the shared rules
//
// The dependency edges run one way: `institutions/` reads the engine's shared
// vocabulary, never the reverse. `engine/parser.ts` is the exception and is
// meant to be — it is the composition root, the one module that runs detection
// and then hands the resolved config to the rules. It sits in `engine/` for
// history rather than by layering; nothing else in `engine/` may import from
// `institutions/` at runtime (a type import erases and is fine).
//
// This module is the public API, and the only one: rule-level internals (the
// amount matcher, the row classifier, …) are reached by their own module path,
// which only this package's unit tests do.

// ── The recognition contract ───────────────────────────────────────────────
export {
  knownAssetCurrencies,
  CURRENCY_SYMBOLS,
  currencySchema,
  type Currency,
} from "./contract/currency";
export {
  knownAssetKinds,
  assetKindSchema,
  lastFourDigitsSchema,
  optionalLastFourDigitsSchema,
  type AssetKind,
} from "./contract/asset-kind";
export {
  accountBalanceSchema,
  balanceInputSchema,
  isPartialBalanceEntry,
  type AccountBalance,
} from "./contract/balance";
export {
  recognizedAccountSchema,
  type RecognizedAccount,
} from "./contract/recognized-account";
export type { OcrTextBlock } from "./contract/block";
export {
  blocksFixtureSchema,
  blocksFromFixture,
  type OcrBlocksFixture,
} from "./contract/fixture";
export type { InstitutionId } from "./contract/institution";

// ── Institutions ───────────────────────────────────────────────────────────
//
// Only what a consumer outside the package actually consumes: the eval harness
// needs to know which institutions detection can route to, so it can tell an
// unwired institution (a coverage gap) from a rule that got one wrong.
// `detectInstitution` / `INSTITUTION_CONFIGS` / `InstitutionConfig` stay
// internal — the pipeline resolves them itself, and widening the surface with
// no caller pins internals as API.
export { DETECT_INSTITUTIONS } from "./institutions/config";
// The ablation modes, for the harness that measures what per-institution
// configuration is worth (`pnpm eval:ocr:ablate`). This widens the surface by
// two NAMES, not by the config type: which fields a mode clears stays inside
// the package, so the harness names a tier and the rules decide what that
// means. See `institutions/ablation.ts` for why that split is the point.
export {
  INSTITUTION_ABLATIONS,
  type InstitutionAblation,
} from "./institutions/ablation";

// ── The parser ─────────────────────────────────────────────────────────────
export { parseOcrBlocks, parseOcrBlocksTraced } from "./engine/parser";

// ── The model pipeline ─────────────────────────────────────────────────────
//
// HYBRID: the engine's deterministic pipeline owns the structure, the injected
// model call annotates only what rules cannot know. The measured argument for
// where that line sits lives in `engine/recognize.ts`'s header — the module
// that owns the decision.
//
// The annotation turn's inference parameters (context window, output ceiling,
// temperature) ride with the model pipeline because the two runtimes that
// answer a `RecognitionAttempt` — the app's llama.rn runner and the harness's
// node-llama-cpp runner — must decode alike for the harness's verdict to be a
// verdict on what ships.
export {
  ANNOTATION_INFERENCE,
  recognizeWithModel,
  type ResolvedRecognition,
  type RunModel,
} from "./engine/recognize";
