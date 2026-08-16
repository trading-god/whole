import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

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
// render a component or touch a native module, it belongs to jest-expo instead
// — and that runner still has to be set up when the first such test appears.
export default defineConfig({
  test: {
    // Enumerated rather than a `src/**` glob: the glob would silently pick up
    // the first test written beside a component and fail on the native import
    // with a resolution error, instead of prompting whoever wrote it to reach
    // for the right runner. Add a directory here when its modules are pure.
    include: [
      "src/features/assets/**/*.test.ts",
      "src/storage/**/*.test.ts",
      "src/i18n/**/*.test.ts",
    ],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
