import { createRequire } from "node:module";

import {
  jestCoverageGlobs,
  jestIgnoredTestPatterns,
} from "./scripts/test-boundary.mjs";

const require = createRequire(import.meta.url);

// Dependencies that publish an ESM build under the `react-native` export
// condition and a CommonJS build under `require`.
//
// jest-expo resolves with the `react-native` condition, so the resolver picks
// the `.mjs` entry — but the preset's `transform` matches `\.[jt]sx?$`, which
// `.mjs` is not, and `moduleFileExtensions` has no `mjs` either. The module is
// therefore located and then handed to `require` untransformed, and the failure
// reads `SyntaxError: Unexpected token 'export'` pointing into node_modules.
//
// Mapping to the CommonJS entry is both the fix and the cheaper option: the
// alternative — teaching Jest to transform `.mjs` — would put lucide's barrel
// file and its several thousand icon modules through Babel on every run.
//
// `require.resolve` rather than a written-out path, for two reasons that both
// bite under pnpm. The real location is inside a `.pnpm/<name>@<version>_<hash>`
// directory whose hash changes on any dependency bump, so it cannot be written
// down. And a package's `exports` field blocks deep subpath imports — mapping
// to `"lucide-react-native/dist/cjs/…"` resolves to nothing and Jest reports
// `Could not locate module … mapped as …`. Resolving here picks the `require`
// condition, which IS the CommonJS build, and yields an absolute path that
// sidesteps the restriction.
//
// Add an entry when a new dependency produces that SyntaxError.
const ESM_ONLY_DEPENDENCY_ENTRY_POINTS = {
  "^lucide-react-native$": require.resolve("lucide-react-native"),
};

// Tests for everything under `src/` that Vitest does not own — React Native
// components, Expo Router screens, and any module that reaches a native SDK.
// `jest-expo` is Expo's own preset and mocks the native side of the SDK, which
// is the whole reason this runner exists alongside Vitest; see AGENTS.md.
//
// TWO PROJECTS, NOT ONE. `Platform.OS` branches are unreachable from a single
// environment: `sourceImageDeletionIsSupported` is iOS-only, so under an iOS
// preset the Android arm never executes and 100% branch coverage is impossible
// to reach honestly. Running the suite once per platform and merging coverage
// is what makes both arms reachable. There is deliberately no `jest-expo/web`
// project — the web platform is unsupported (AGENTS.md).
const projects = ["ios", "android"].map((platform) => ({
  displayName: platform,
  preset: `jest-expo/${platform}`,
  // No `setupFilesAfterEnv`: `@testing-library/react-native` v14 ships its
  // matchers and its automatic cleanup from the main entry point, so there is
  // nothing left for a setup file to do. Add one when something actually needs
  // it, not as scaffolding.
  testMatch: ["<rootDir>/src/**/*.test.{ts,tsx}"],
  testPathIgnorePatterns: jestIgnoredTestPatterns,
  moduleNameMapper: {
    ...ESM_ONLY_DEPENDENCY_ENTRY_POINTS,
    "^@/assets/(.*)$": "<rootDir>/assets/$1",
    "^@/(.*)$": "<rootDir>/src/$1",
  },
}));

export default {
  projects,

  // Coverage options belong at the top level when `projects` is used: the two
  // platform runs are merged into one report, and the threshold is checked
  // against that merge rather than against either platform alone.
  collectCoverageFrom: jestCoverageGlobs,
  coverageDirectory: "<rootDir>/coverage/rn",

  // 100% on all four metrics, and `v8 ignore` / `istanbul ignore` are not
  // permitted anywhere in the codebase. The three things that make this
  // reachable rather than aspirational:
  //
  //   - `Platform.OS` branches      → the two projects above
  //   - `__DEV__` branches          → read it through an injectable constant,
  //                                   never off the global directly
  //   - exhaustive `switch` default → drop `default`, call `assertNever`, and
  //                                   test `assertNever` itself
  //
  // Anything that still looks unreachable is a design smell, not a case for an
  // ignore comment.
  coverageThreshold: {
    global: {
      lines: 100,
      branches: 100,
      functions: 100,
      statements: 100,
    },
  },
};
