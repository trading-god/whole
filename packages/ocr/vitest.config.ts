import { defineConfig } from "vitest/config";

// Tests live next to the rule they exercise (`engine/amount.test.ts` beside
// `engine/amount.ts`) so a rule change and its cases are edited together.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // The engine is pure — no DOM, no native modules — so the default Node
    // environment is all it needs.
    environment: "node",
  },
});
