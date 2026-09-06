// The single definition of which runner owns which test, imported by BOTH
// `vitest.config.mts` and `jest.config.mjs`.
//
// It lives in its own file because the boundary would otherwise be written
// twice — once as Vitest's `include`, once as Jest's `testPathIgnorePatterns` —
// and two hand-maintained copies drift. When they drift the failure is silent
// in the worst direction: a test that neither runner claims simply never runs,
// and a green CI says nothing went wrong because nothing ran at all.
//
// THE RULE is the mechanical one from AGENTS.md: **can plain Node import this
// module, as-is or with ONE module seam mocked?** If yes it is listed below and
// belongs to Vitest. Everything else under `src/` belongs to Jest, which has
// `jest-expo` to mock the native side of the Expo SDK.
//
// FILE-LEVEL, not directory-level, because the directories are genuinely mixed.
// `src/storage` holds `cached-preference-store.ts` (pure, one mocked seam) next
// to `kv-store.ts` (needs `expo-sqlite` AND async-storage — two seams, so Jest).
// `src/features/assets` holds pure rule modules next to
// `source-image-cleanup.ts` (expo-media-library). A directory rule would have to
// lie about one of them.
//
// Enumerating every file is deliberate friction: adding a module means choosing
// its runner on purpose, and the list doubles as the answer to "is this module
// still importable by plain Node?" — a property the pure rule layer is supposed
// to keep, not a coincidence to discover later. Sorted, so an addition lands
// where it belongs rather than wherever the diff was open.
export const vitestOwnedSources = [
  "src/features/accounts/account-draft.ts",
  "src/features/accounts/balance-rows.ts",
  "src/features/assets/account-appearance.ts",
  "src/features/assets/accounts-query.ts",
  "src/features/assets/asset-migrations.ts",
  "src/features/assets/asset-privacy-store.ts",
  "src/features/assets/asset-schema.ts",
  "src/features/assets/async-serializer.ts",
  "src/features/assets/base-currency-store.ts",
  "src/features/assets/currencies.ts",
  "src/features/assets/currency-conversion.ts",
  "src/features/assets/display-currency-store.ts",
  "src/features/assets/exchange-rates-query.ts",
  "src/features/assets/net-worth-flows.ts",
  "src/features/assets/net-worth-history.ts",
  "src/features/assets/net-worth-range.ts",
  "src/features/assets/net-worth-snapshots-query.ts",
  "src/features/home/distribution.ts",
  "src/features/on-device-model/format-bytes.ts",
  "src/features/on-device-model/on-device-catalog.ts",
  "src/features/on-device-model/on-device-catalog.ts",
  "src/features/onboarding/onboarding-store.ts",
  "src/features/recognition/engine-store.ts",
  "src/features/recognition/recognition-issue.ts",
  "src/features/user/user-store.ts",
  "src/i18n/locales/en.ts",
  "src/i18n/locales/zh-Hans.ts",
  "src/i18n/resources.ts",
  "src/i18n/schema.ts",
  "src/lib/query-client.ts",
  "src/storage/cached-preference-store.ts",
];

/** Vitest's `include`: each owned source's sibling test file. */
export const vitestTestFiles = vitestOwnedSources.map((source) =>
  source.replace(/\.ts$/, ".test.ts"),
);

/** Vitest's coverage scope: exactly the sources it owns, nothing else. */
export const vitestCoverageFiles = vitestOwnedSources;

/**
 * Jest's `testPathIgnorePatterns`: the same list as anchored regexes.
 *
 * Anchored on both ends so `net-worth-range.test.ts` cannot also exclude a
 * future `net-worth-range.extra.test.ts` that nobody has declared yet.
 */
export const jestIgnoredTestPatterns = vitestTestFiles.map(
  (file) => `<rootDir>/${file.replace(/[.]/g, "\\.")}$`,
);

/** Jest's coverage scope: everything under `src/` that Vitest does not own. */
export const jestCoverageGlobs = [
  "src/**/*.{ts,tsx}",
  "!src/**/*.test.{ts,tsx}",
  "!src/**/*.d.ts",
  // Test-only helpers. They are exercised by every suite that imports them, but
  // they are scaffolding, not app code — holding them to the same coverage bar
  // would mean writing tests for the test harness.
  "!src/test-support/**",
  ...vitestCoverageFiles.map((source) => `!${source}`),
];
