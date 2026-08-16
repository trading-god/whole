// https://docs.expo.dev/guides/using-eslint/
const pluginQuery = require("@tanstack/eslint-plugin-query");
const { defineConfig, globalIgnores } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");
const eslintPluginPrettierRecommended = require("eslint-plugin-prettier/recommended");
const globals = require("globals");

module.exports = defineConfig([
  expoConfig,
  // Catches the query mistakes that fail silently rather than loudly: a
  // queryKey missing a value the queryFn closes over (so two different fetches
  // share one cache entry), or a mutation that never invalidates.
  pluginQuery.configs["flat/recommended"],
  // Stays last: it disables the formatting rules the configs above would
  // otherwise fight with, and surfaces Prettier violations through the lint gate.
  eslintPluginPrettierRecommended,
  // Prettier reads .gitignore by default; ESLint does not. Generated output has
  // to be excluded here as well, or `expo lint .` lints the Expo-generated
  // expo-env.d.ts and reports a formatting violation in a file nobody edits.
  globalIgnores([
    "dist/",
    "expo-env.d.ts",
    "packages/*/samples/",
    "packages/*/vision/.build/",
  ]),
  // Node-environment files. The asset generator and the ocr-eval CLIs run under
  // Node and use Buffer/process/__dirname, which the Expo config treats as
  // undefined because it assumes a React Native runtime.
  {
    files: [
      "scripts/**/*.{js,mjs,cjs}",
      "eslint.config.js",
      "packages/ocr-eval/src/**/*.ts",
    ],
    languageOptions: { globals: globals.node },
  },
]);
