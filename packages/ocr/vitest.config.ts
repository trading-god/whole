import { defineConfig } from "vitest/config";

// Tests live next to the rule they exercise (`engine/amount.test.ts` beside
// `engine/amount.ts`) so a rule change and its cases are edited together.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // The engine is pure — no DOM, no native modules — so the default Node
    // environment is all it needs.
    environment: "node",
    // Coverage is configured so `vitest run --coverage` reports cleanly, but
    // the 100% thresholds the repo's other configs carry are deliberately NOT
    // set here yet: the engine currently measures ~98% lines / ~95% branches.
    // Same policy as the app's suites in AGENTS.md — write the threshold down
    // only when the tests that satisfy it exist, so the gate is never red by
    // accident and then ignored. Add the thresholds when the backfill lands;
    // `v8 ignore` is not permitted either way.
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["**/*.test.ts", "src/index.ts"],
    },
  },
});
