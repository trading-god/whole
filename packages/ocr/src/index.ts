// `@whole/ocr` — the account-recognition rule engine.
//
// Given the OCR blocks of an account screenshot, this package answers: what
// accounts are on this screen, what are they called, what are their balances
// per currency, what are the last four digits, and which institution is this?
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
export {
  institutionIdSchema,
  type InstitutionId,
} from "./contract/institution";

// ── Institutions ───────────────────────────────────────────────────────────
//
// Only what a consumer outside the package actually consumes: the eval harness
// needs to know which institutions detection can route to, so it can tell an
// unwired institution (a coverage gap) from a rule that got one wrong.
// `detectInstitution` / `INSTITUTION_CONFIGS` / `InstitutionConfig` stay
// internal — the pipeline resolves them itself, and widening the surface with
// no caller pins internals as API (the same rule `internals.ts` states).
export { DETECT_INSTITUTIONS } from "./institutions/config";

// ── The parser ─────────────────────────────────────────────────────────────
export {
  parseOcrBlocks,
  parseOcrBlocksTraced,
  type OcrTrace,
} from "./engine/parser";
