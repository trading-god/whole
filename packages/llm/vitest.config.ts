import { defineConfig } from "vitest/config";

// Tests live next to the module they exercise, matching `@whole/ocr`.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Pure functions with an injected transport — no DOM, no native modules.
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["**/*.test.ts", "src/index.ts"],
      // 100% on all four metrics, matching every other config in the repo.
      // `v8 ignore` is not permitted; see AGENTS.md.
      thresholds: {
        lines: 100,
        branches: 100,
        functions: 100,
        statements: 100,
      },
    },
  },
});
