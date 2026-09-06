# whole

A personal finance aggregation app built on Expo + React Native. This file
is the source of truth for project conventions; `CLAUDE.md` includes it via
`@AGENTS.md`. Read the exact versioned Expo docs at
https://docs.expo.dev/versions/v57.0.0/ before writing Expo-specific code.

# Supported Platforms

iOS and Android only. Web is deliberately unsupported and its code has been
removed: account recognition depends on the native image-picker,
media-library, and on-device OCR pipeline, which a browser build cannot
deliver. Do not add web support in any form — `react-native-web`,
`react-dom`, an `expo.web` block in `app.json`, a `pnpm web` script, a
`+html.tsx` root, a PWA manifest, `public/` web assets, `.web.ts` /
`.web.tsx` overrides, or `Platform.OS === "web"` branches (`Platform` checks
distinguish ios from android only). Verify with `pnpm ios` / `pnpm android`;
there is no web export gate.

# Tooling

## Package manager

pnpm only, at the version pinned by `package.json`'s `packageManager` field,
with `pnpm-lock.yaml` as the only lockfile — never `npm`, `npx`, Yarn, or
Bun. The repo's own `.npmrc` pins the public registry, so installs inside
the repo never touch a machine-level mirror; when something fails to install
from inside the repo, the registry is not the suspect.

`pnpm-workspace.yaml` sets `minimumReleaseAge: 1440` — a version must be
published for a day before pnpm resolves it, transitive dependencies
included. A same-day release fails loudly
(`ERR_PNPM_NO_MATURE_MATCHING_VERSION`); the bad case is silent: where a
range is loose (an optional peer declared `*`), pnpm quietly keeps whatever
the lockfile had — `@expo/metro-runtime` has sat behind its dependent's
requirement this way twice. `minimumReleaseAgeExclude` entries are
temporary: add one only to clear an outright failure, delete it at the next
bump. After any dependency change run `pnpm exec expo-doctor`; when a
resolution looks frozen, `pnpm update` and `overrides` will not move an
optional peer — delete `pnpm-lock.yaml` **and**
`node_modules/.pnpm/lock.yaml` (pnpm restores from the latter, so removing
only the first is a no-op) and reinstall, then run `pnpm peers check`: the
reset re-resolves every loose range, which is how a transitive `react-dom`
once floated ahead of the pinned `react` (it is now an exact direct
dependency for exactly that reason). Verify with `pnpm ios` afterwards,
not just `pnpm typecheck`: re-resolving moves native modules and the pods
have to be rebuilt.

## Patched dependencies

All three patches are registered under `patchedDependencies` in
`pnpm-workspace.yaml` and pinned to exact versions. **Re-evaluate each on
every bump of the package it patches** — a version mismatch fails resolution
loudly, but a silent patch loss shows up only as the bug it fixes coming
back.

- `expo-mlkit-ocr@0.2.7` adds `recognitionLanguages = ["zh-Hans", "en-US"]`
  to the module's `VNRecognizeTextRequest`; without it Apple Vision OCR
  drops the Chinese labels most account screenshots carry.
- `expo-media-viewer@0.7.2` threads a `viewer.closeIconName` config option
  through the JS wrapper to the `closeIconName` prop the iOS module already
  declares; without it the fullscreen screenshot viewer closes with an
  unlocalized English "Close" — the one English control in a Chinese UI.
  `ScreenshotMediaViewer` passes an SF Symbol instead; Android already
  draws an icon.
- `llama.rn@0.12.9` changes two things. It adds `extractWholeModelShards`
  to the Android module, copying the bundled model shards from the APK's
  `assets/whole_models/` into filesDir at install time (llama.cpp can only
  load models from real filesystem paths, and APK assets are not files).
  And it moves `@expo/config-plugins` from llama.rn's devDependencies into
  dependencies: the package's Expo config plugin (`withLlamaRN`) imports it
  at prebuild, pnpm does not install a transitive package's
  devDependencies, and from SDK 57.0.20 the plugin resolver loads the
  plugin's ESM build, where the unmet import kills every `expo config` /
  prebuild with `PluginError: Cannot find package '@expo/config-plugins'`.

Two consequences of the shard copy: Android holds the weights TWICE (APK
plus filesDir — what `bundledModelStorageBytes` reports to the settings
card), and extraction skips a shard whose name is already present, so a
rebuilt GGUF must be renamed rather than swapped in place
(`model-source.ts` verifies each extracted shard's SIZE against the catalog
and deletes a wrong one, which is what makes that recoverable). Separately,
`plugins/with-whole-model.js` puts the shards in the app bundle's base
module, which Google Play caps at 150 MB — an Android release build needs
Play Asset Delivery before it can be uploaded.

On iOS the weights need the `increased-memory-limit` entitlement or the
system jetsams the app during `initLlama`. llama.rn's plugin only adds it
for the build profiles named in `entitlementsProfile`, which `app.json`
lists as `["", "development", "preview", "production"]`. The empty string
is load-bearing, not a typo: the plugin matches against
`process.env.EAS_BUILD_PROFILE || ""`, so it is what covers a local
`pnpm ios` — the very build this file tells you to verify with. Without it
the prescribed verification runs the one configuration with no entitlement,
and the failure looks like an out-of-memory device rather than a missing
capability.

## Brand assets

The source logo is `assets/branding/whole-logo.svg`; regenerate platform
assets with `pnpm generate:icons`. Generated files under `assets/app-icons/`
are not edited by hand. `COLORS.brand` is the canonical brand color; the icon
artwork bakes the same hex from the SVG, and the JS splash wordmark reads the
token live — a brand-color change means editing the SVG and regenerating.

The splash is one mechanism on both platforms: the native splash shows the
logo ALONE (`assets/images/logo.png`, `imageWidth: 192`), and the wordmark +
slogan are rendered by the JS overlay `src/components/BrandSplash.tsx`, which
mounts beneath the native splash on the first React frame and takes over at
`SplashScreen.hideAsync()` — fading the text in, holding the lockup, and
fading out to the app. Copy comes from i18n (`common.sloganLine1/2` — fixed
English in both locales, it is brand copy per the Documentation section), so
slogan changes need no asset regeneration. The reason it is split this way is
Android 12+: `windowSplashScreenAnimatedIcon` is shown through a circular mask
(288dp canvas, only the central 192dp-diameter circle visible), which a
logo+wordmark+slogan lockup cannot survive — the original baked lockup had its
logo crown and both slogan lines cropped away. iOS matches the split for
parity rather than need; `app.json`'s `imageWidth` and BrandSplash's
`LOGO_SIZE` must stay equal (192, the safe-circle diameter) — that equality is
what makes the native→JS handoff seamless, and a guard test in
`BrandSplash.test.tsx` pins the two together so a drift fails CI rather than
shipping a visible seam.

# Code Quality

Run `pnpm lint`, `pnpm format:check`, and `pnpm typecheck` before submitting
a change; when it touches recognition, also run `pnpm test:ocr` and
`pnpm eval:ocr`, and — when the grammar, prompt, or model path changed —
`pnpm eval:ocr:llama`. Every gate runs in CI
(`.github/workflows/ci.yml`) on push and PR, pure JS on a Linux runner — CI
is the backstop, not the first place to find out.

- `lint` is one root run, `expo lint . --max-warnings 0`. The explicit `.`
  is load-bearing: bare `expo lint` only walks `/src`, `/app`, and
  `/components`, leaving `packages/` and `scripts/` outside the gate. So is
  `--max-warnings 0`.
- `typecheck` means the script, not a bare `pnpm exec tsc --noEmit`: the
  root tsconfig excludes `packages/`, which the script typechecks and then
  each workspace package's own config.
- Keep `eslint-plugin-prettier/recommended` after `eslint-config-expo/flat`
  in the ESLint flat config, and keep `.prettierignore` minimal — an entry
  only for a generated or package-manager-owned file that would otherwise
  be formatted.

# Testing

Two runners, split by one mechanical question: **can plain Node import the
module, as-is or with one storage module mocked?**

- **Vitest** (`pnpm test:ocr` for `@whole/ocr`, `pnpm test:app` for the
  app's pure modules) owns the FILES enumerated in
  `scripts/test-boundary.mjs`: a `*.test.ts` beside a listed source is
  Vitest's; a `.test.tsx` there, and everything else under `src/`, is
  Jest's. The boundary is defined once in that file because two
  hand-maintained copies drift silently — the failure mode is a test
  neither runner claims, which simply never runs.
- **Modules that reach storage through one named seam** (e.g.
  `accounts-query.ts`) are Vitest's with the repository module `vi.mock`ed
  wholesale — mock the module, never a scatter of individual Expo calls; a
  module that would need a second mock belongs under jest-expo. Keeping
  the pure modules Node-importable is a constraint, not an accident: reach
  for a schema through `@whole/ocr` or `features/assets/asset-schema.ts`
  rather than through `asset-repository.ts`.
- **jest-expo** (`pnpm test:rn`) for anything that renders or touches a
  native module. Two projects, ios and android, with merged coverage — a
  `Platform.OS` branch is unreachable from a single environment, so 100%
  branch coverage is only honest when the suite runs once per platform.
  There is deliberately no `jest-expo/web` project. `babel.config.js`
  exists for Jest, not for Metro. Do not unify the runners.

Jest gotchas that each cost a debugging session: a fresh module instance is
`jest.resetModules()` plus `require(...)`, not `await import()` (CommonJS);
a variable a `jest.mock` factory closes over must be named `mock…`; spying
on the `react-native` namespace never reaches bindings a module under test
already holds — mock the specific module instead; assert on what RENDERED,
not on props handed to a component that consumes them internally (RN's
`KeyboardAvoidingView` and lucide's icons both swallow theirs). Import test
globals from the package (`@jest/globals` / `vitest`), not ambient types.
`render` and `renderHook` are async in @testing-library/react-native v14 —
a missing `await` doesn't throw, it leaves every query failing.

**A screen's test cannot live in `src/app/`.** expo-router's context regex
turns every `.ts`/`.tsx` file there into a route, so a test beside a screen
gets bundled into the app — a red box in the running app and nothing in CI.
Screens live in their feature folder with their tests beside them, and
`src/app/` holds thin re-exports (the convention for EVERY screen — a full
screen implemented directly in `src/app/` is a bug):

```tsx
export { SettingsScreen as default } from "@/features/settings/SettingsScreen";
```

`src/test-support/render.tsx` wraps a component in the app's real
`I18nProvider` rather than a stub, so tests assert the copy users see and a
missing key fails in CI.

## Coverage

Both configs hard-code **100% on lines, branches, functions, and
statements**, and `v8 ignore` / `istanbul ignore` are not permitted — an
unreachable line is a design smell to fix. The three patterns that keep the
target reachable: `Platform.OS` branches → the two Jest projects; `__DEV__`
branches → read it through an injectable constant, never off the global;
exhaustive `switch` → drop `default` and call `assertNever`, then test
`assertNever` itself. `pnpm test:rn:coverage` and `pnpm test:app:coverage`
currently fail by design: CI runs the suites, not the coverage gate — move
the coverage commands into CI once the backfill lands, otherwise the gate
is red from day one and gets ignored.

## Recognition evals

- `pnpm eval:ocr` replays real recorded screenshots against a baseline of
  known failures — it fails only on a regression, never on a pre-existing
  gap.
- `pnpm eval:ocr:llama` replays the same samples through the on-device path
  (`WHOLE_GGUF_PATH=… pnpm eval:ocr:llama`). It is the only gate that
  executes a real llama.cpp parse, so it alone catches a grammar the engine
  accepts but llama.cpp rejects (a `\d` in a schema `pattern` once did) —
  run it whenever the grammar, prompt, or model path changes.
- `pnpm eval:ocr:ablate` is a MEASUREMENT, not a gate — no baseline, always
  exits 0. `packages/ocr-eval/README.md` reads the table.
- `pnpm test:ocr:golden` hard-asserts the samples whose gold was verified
  against the screenshot BY EYE. Never add a sample there from unverified
  LLM-generated gold — that would pin the engine to a guess.

# Architecture

## Layout

```text
config/locales/        Native permission translations (build-time config)
docs/                  Long-form design notes (e.g. the OCR redesign rationale)
scripts/               Asset generation + the two-runner test boundary
src/app/               Expo Router routes — thin re-exports only
src/components/        Design-system layer, no feature knowledge
src/lib/               QueryClient and shared navigation hooks
src/features/<name>/   Each feature's screens, fields, rows, and pure modules
src/i18n/              Runtime localization, catalogs, terminology guide
src/storage/           kv-store and preference primitives (never imports features/)
src/test-support/      Shared test scaffolding
packages/ocr/          @whole/ocr — the recognition engine (pure TypeScript)
packages/ocr-eval/     Screenshot regression harness and the `pnpm ocr` CLI
patches/ plugins/      pnpm patches; Expo config plugins (with-whole-model)
assets/                Branding, generated icons, bundled GGUF weights (LFS)
```

A component that imports from `@/features/*` belongs in that feature, not in
`src/components/`. Feature-specific stores sit in their feature on top of
`src/storage/`'s primitives.

## Theme

Colors, spacing, radii, and type come from `src/theme/` — add a token there
instead of scattering a literal, and reuse an existing token when two
surfaces should stay in lockstep. Optical micro-values (`0`, `2`) and
layout-specific alignment constants may stay literal. Share reusable style
fragments (card surface, modal overlay, screen layout) from
`src/theme/screen-styles.ts`. Colour that carries MEANING goes through
`src/theme/tones.ts` — each tone carries surface + border + ink as a set,
because they are only legible together; `caution` is deliberately not
`danger`, since red is reserved for destructive actions. `Button` /
`IconButton` appearance comes from `BUTTON_VARIANTS` in
`src/components/button-variants.ts`, not ad-hoc styles. Where iOS and
Android genuinely diverge, keep the branch behind one named export or use
`<name>.ios.ts` / `<name>.android.ts` — never a `.web.ts` variant.

## Errors

`src/app/_layout.tsx` re-exports `AppErrorBoundary` as the `ErrorBoundary`
export expo-router looks for. The fallback renders OUTSIDE every provider —
it resolves its copy straight from `@/i18n/resources` and uses fixed
padding, because `I18nProvider` and `SafeAreaProvider` are gone by then;
keep it that way, since every dependency it takes is another way for it to
fail alongside what it is catching. It shows the error message selectable
rather than offering only Retry (a crash from unreadable stored data recurs
the instant retry remounts). There is deliberately no third-party crash
reporter: account balances and last fours are exactly what a default
Sentry install ships in breadcrumbs, and the README promises this data
stays on the device.

## Storage

All key/value persistence goes through `src/storage/kv-store`, keys
prefixed `whole.`; wrap a batch of dependent writes in `withTransaction` so
the commit is all-or-nothing.

## Internationalization

Every user-visible string goes through i18next; `src/i18n/locales/en.ts`
and `zh-Hans.ts` stay in lockstep (the type system forces new keys into
both). Native permission copy is build-time config in
`config/locales/*.json`, and the iOS photo-usage strings in `app.json` must
stay identical across `expo-image-picker` and `expo-media-library`. Format
money through `useAppLocale().formatCurrency` — the explicit symbol table
exists because Hermes' `Intl` currency-symbol resolution is unreliable.
Follow the terminology guide in `src/i18n/README.md`; in particular
**account screenshot** / 账户截图 (never "bank screenshot"), and an
institution is a bank, a crypto exchange, or a broker — never narrow the
term.

## Money & caching

Convert amounts through `convertCurrency` — per-account direct conversion,
no pivot currency. A rate of `0` means "no data": return `null` for an
unavailable conversion so callers can skip the account, never `0`.

The exchange-rate fetch is the app's only network call, and its caching is
TanStack Query's (`src/lib/query-client.ts`): **read that file's comments
before changing any of its four non-default options, the persister's
`deserialize` eviction, or the base-currency keying** — each default fails
silently rather than loudly. The net-worth snapshot chain is itself a query
whose three writes are idempotent by construction (it may be retried,
refetched on mount, and refetched on focus) — check that before changing
any of them. Accounts sit in the query cache for one reason —
`cancelQueries` — and are never persisted by the persister (the
repository's versioned envelope is the disk format); `asset-repository`'s
`mutate` lock stays, because the add and edit screens write directly.
Every account write goes through `accounts-query.ts`, which cancels the
in-flight read BEFORE the repository write (the `await` on `cancelQueries`
is load-bearing), then `invalidateQueries({ queryKey: accountsQueryKey })`
after a save so the home screen never renders a frame of the pre-save list.
Report a load error only when there is nothing to show
(`isError && data === undefined`).

## Negative balances

A balance can be negative, and the sign is load-bearing: a credit card's
balance is what you owe, and it must survive recognizer → form → storage →
total to be subtracted (a schema once rejected negatives, silently dropping
a correctly recognized `-4,766.92`). `balanceInputSchema` accepts negatives
(never reintroduce `.nonnegative()` on the balance path); the balance field
uses `SIGNED_DECIMAL_KEYBOARD` (iOS's decimal pad has no minus key);
`formatCurrency` puts the sign outside the symbol; the home composition bar
EXCLUDES negative kinds while net worth counts them; `debtMarkers` in
`@whole/ocr` covers both card-printing conventions. A bare positive under
no debt label is genuinely ambiguous — the recognizer reports what the
screen shows and the user fixes the sign in the editable draft.

## Validation

Runtime validation is zod (`safeParse` on a schema), never hand-written
`if`/`else` guards; share one schema between form validation and runtime
guards, and derive types with `z.infer`.

## OCR Recognition

Recognition is a **hybrid**, and the split is the whole design: a
deterministic rule pipeline reads the STRUCTURE (accounts, balances,
currencies, debt signs, mechanical last fours), and one call to the bundled
on-device model annotates the SEMANTICS rules cannot know. Both halves live
in `@whole/ocr` (pure TypeScript, one dependency, the model call injected
as a `RunModel` parameter so the package never touches a runtime); four
app-side adapters sit around it (`recognition/ocr-engine.ts`,
`on-device-runner.ts`, `model-recognition.ts`,
`screenshot-recognition.ts`), with the weights and llama context one layer
further out in `features/on-device-model/`. See
[`docs/ocr-redesign.md`](./docs/ocr-redesign.md) for the measured rationale
and [`packages/ocr/README.md`](./packages/ocr/README.md) for the package.

- The recognition **contract** (currencies, asset kinds, institution ids,
  the last-four pattern, fixture shapes) is owned by the package's
  `contract/` and re-exported by the app. Add a currency or kind in the
  package, not the app.
- **Recognize everything visible; the form filters, the recognizer does
  not.** A currency or institution the form cannot store yet is dropped at
  fill time, not at recognition — so a future form expansion needs no
  extra OCR work. The eval harness still gates the parser on everything it
  extracts.
- **Accuracy is the first priority.**

# Documentation

English is the default for all documentation and doc comments. When a
Chinese version exists, follow the `README.md` / `README.zh-Hans.md`
pattern: English is the source of truth, both files carry the
language-switch links, and the pair updates together in the same change
with semantically equivalent content. The product slogan is brand copy and
stays exactly `Your whole financial life, in one place.` in both versions
unless explicitly approved otherwise.

Punctuation: Chinese text uses full-width punctuation (`，`、`。`、`：`、
`（）`, `“”` for quotes), English uses half-width — keep each language
consistent within its own text; never half-width straight quotes in Chinese
prose. Code blocks and inline code keep ASCII punctuation.
