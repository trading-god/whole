import { defineConfig } from "vitest/config";

// The harness's own tests: the golden regression suite over the human-verified
// samples, and unit tests for the gate's arithmetic (`baseline.test.ts`). The
// rule-level unit tests belong to `@whole/ocr`, next to the rules they cover —
// nothing about the recognition RULES is tested from here.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
