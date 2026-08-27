import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

import {
  vitestCoverageFiles,
  vitestTestFiles,
} from "./scripts/test-boundary.mjs";

// Tests for the app's PURE modules — the ones that are plain data in, data out.
//
// This does not contradict the two-runner split in AGENTS.md. That rule is
// about React Native components, which need `jest-expo` to mock the native side
// of the Expo SDK. The modules covered here import no React and no Expo, so
// running them under jest-expo would buy a native mock layer they never touch,
// at the cost of a second toolchain in the loop.
//
// The boundary is therefore mechanical, not a matter of taste: a module belongs
// here only while it can be imported by plain Node. The moment a test needs to
// render a component or touch a native module, it belongs to jest-expo instead.
export default defineConfig({
  test: {
    // Imported from `scripts/test-boundary.mjs` rather than written out here,
    // because `jest.config.mjs` has to express the SAME boundary as an
    // exclusion. Two hand-maintained copies drift, and a test neither runner
    // claims fails silently — it just never runs.
    include: vitestTestFiles,
    environment: "node",
    coverage: {
      provider: "v8",
      include: vitestCoverageFiles,
      exclude: ["**/*.test.ts"],
      reportsDirectory: "./coverage/app",
      // 100% on all four metrics, matching `jest.config.mjs`. Ignore comments
      // (`v8 ignore`, `istanbul ignore`) are not permitted — an unreachable
      // line is a design smell to fix, not a line to hide. See the note in
      // `jest.config.mjs` for the three patterns that keep this reachable.
      thresholds: {
        lines: 100,
        branches: 100,
        functions: 100,
        statements: 100,
      },
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
