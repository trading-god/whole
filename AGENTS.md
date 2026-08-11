# whole

A personal finance aggregation app built on Expo + React Native. This file
is the source of truth for project conventions; `CLAUDE.md` includes it via
`@AGENTS.md`.

# Supported Platforms

Whole ships to **iOS and Android only**. The web platform is deliberately
unsupported and its code has been removed.

- Account recognition depends on OCR handling of account screenshots
  that only works reliably through the native image-picker, media-library,
  and on-device OCR pipeline, so a browser build could not deliver the
  app's core flow.
- Do not add `react-native-web`, `react-dom`, an `expo.web` block in
  `app.json`, a `pnpm web` script, a `+html.tsx` root, a PWA manifest, or
  `public/` web assets.
- Do not write `.web.ts` / `.web.tsx` platform overrides or
  `Platform.OS === "web"` branches. `Platform` checks are for distinguishing
  `ios` from `android` only.
- Verify changes with `pnpm ios` / `pnpm android`; there is no web export
  gate.

# Tooling & Environment

## Expo SDK

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/
before writing any code.

## Package Manager

Use pnpm exclusively, at the version pinned by the `packageManager` field in
`package.json`, with `pnpm-lock.yaml` as the only lockfile — never `npm`,
`npx`, Yarn, or Bun (`pnpm install`, `pnpm <script>`, `pnpm exec <binary>`).

## Technology stack

- [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/)
- React 19 and React Native 0.86
- Expo Router with typed routes
- TypeScript
- ESLint with Expo's recommended rules
- Prettier
- `i18next` and `react-i18next`
- `expo-localization`
- AsyncStorage
- `expo-image-picker` and `expo-media-library`

## Brand assets

The source logo is `assets/branding/whole-logo.svg`. Regenerate platform
assets with:

```bash
pnpm generate:icons
```

Generated icons under `assets/app-icons/` should not be edited manually. Update
the source artwork or the generator instead.

# Code Quality

ESLint enforces the Expo, React Native, React Hooks, TypeScript, and import
rules. Prettier is the only formatter.

- Run `pnpm lint`, `pnpm format:check`, and `pnpm exec tsc --noEmit` before
  submitting a change.
- Run `pnpm format` to format all supported, non-ignored files.
- Keep `eslint-plugin-prettier/recommended` after `eslint-config-expo/flat` in
  the ESLint Flat Config so formatting conflicts are disabled and formatting
  violations remain visible in the Expo lint gate.
- Keep `.prettierignore` minimal. Add an entry only when a generated or
  package-manager-owned file would otherwise be formatted; never add
  speculative or convenience-only ignores.
- Update the ESLint config, Prettier ignore file, editor settings, scripts,
  lockfile, and developer documentation together when changing code-quality
  tooling.

# Architecture & Conventions

## Project layout

```text
config/locales/        Native permission translations
scripts/               Repeatable asset-generation scripts
src/app/               Expo Router routes and layouts
src/app/dev/           Dev-only routes (OCR fixture capture), gated by __DEV__
src/features/assets/   Account storage, currencies, the OCR recognition
                       pipeline, and screenshot cleanup
src/i18n/              Runtime localization, message catalogs, and terminology
packages/ocr-eval/     OCR parser regression eval harness (Node workspace)
assets/branding/       Source brand artwork
assets/app-icons/      Generated platform icon deliverables
eslint.config.js        Expo ESLint and Prettier integration
.prettierignore         Generated files excluded from formatting
```

## Technical Decisions

Choose established, widely adopted solutions from the React Native or broader
React ecosystem for libraries, architecture, and integrations.

- Verify current official documentation, Expo and React Native compatibility,
  maintenance activity, ecosystem adoption, and production suitability before
  adding or replacing a dependency.
- Prefer the established React or React Native integration over a lower-level
  JavaScript library or a custom abstraction when it satisfies the product
  requirements.
- Do not treat a library used in a tutorial or example as the recommended
  production default without comparing it with the community-standard options.
- Do not introduce a niche library or custom framework when a maintained,
  community-standard solution meets the requirements.
- If the community-standard option cannot satisfy a concrete requirement,
  document the requirement and trade-off, and obtain explicit user approval
  before implementing the exception.

## Design Tokens

Pull colors, spacing, radii, font sizes, weights, line heights, and letter
spacings from `src/theme/` instead of hard-coding literal values.

- Add a new value to the relevant token file (`colors.ts`, `spacing.ts`,
  `sizes.ts`, `typography.ts`, etc.) rather than scattering a literal through
  components; reuse an existing token when two surfaces should stay in
  lockstep.
- Optical micro-values (`0`, `2`) and layout-specific alignment constants may
  stay literal — the 4pt spacing grid is the default, not a straitjacket.
- `COLORS.brand` is the canonical brand color, and the splash wordmark baked
  by `scripts/generate-app-icons.mjs` mirrors it — regenerate the icons when
  it changes.
- Share reusable style fragments (card surface, modal overlay, screen layout)
  from `src/theme/screen-styles.ts` instead of redeclaring them per screen.

## Component Variants

Common controls share a variant config so the visual language stays
consistent across the component library.

- `Button` and `IconButton` derive their appearance from `BUTTON_VARIANTS`,
  `DISABLED_BUTTON`, and `buttonContainerStyle` in
  `src/components/button-variants.ts`. Add a variant there, not as ad-hoc
  styles inside a component.
- Sizes (`sm` / `md` / `lg`) and radii come from `src/theme/sizes.ts`.

## Platform-Specific Modules

iOS and Android are the only supported targets, so most code is shared. Where
they genuinely diverge, keep the branch in one place with a consistent API
rather than re-inlining `Platform.OS` through feature code.

- Isolate the branch behind a named export or a small wrapper — see
  `sourceImageDeletionIsSupported` in
  `src/features/assets/source-image-cleanup.ts` (deletion is iOS-only) and
  `src/components/KeyboardAvoidingView.tsx`.
- If a difference is large enough to warrant separate files, use
  `<name>.ios.ts` / `<name>.android.ts`. Never add a `.web.ts` variant — see
  [Supported Platforms](#supported-platforms).

## Storage

- Use `src/storage/kv-store` for all key/value persistence. Namespace keys
  with the `whole.` prefix.
- Wrap a batch of dependent writes in `withTransaction` so the commit is
  all-or-nothing (the kv and net-worth-history migrations use this to keep
  data and migration marker atomic).

## Internationalization

All user-visible copy goes through i18next — `src/i18n/locales/en.ts` and
`zh-Hans.ts` stay synchronized (every new key is added to both) — while native
permission copy is build-time config in `config/locales/*.json`.

- Use semantic translation keys through `useTranslation()`; do not embed
  user-facing copy directly in UI code.
- Format money through `useAppLocale().formatCurrency`. Do not hand-build
  currency strings — the explicit symbol table exists because Hermes' `Intl`
  currency-symbol resolution is unreliable.
- Follow the terminology guide in [`src/i18n/README.md`](./src/i18n/README.md).
  The canonical term is **account screenshot** in English and **账户截图** in
  Simplified Chinese — not "bank screenshot" or "银行截图", because Whole
  supports financial accounts beyond banks.

## Money & Currency Conversion

- Convert amounts through `convertCurrency` in
  `src/features/assets/currency-conversion.ts`. Do not re-implement the
  cross-rate math; per-account direct conversion avoids accumulating
  rounding error through a pivot currency.
- A rate of `0` means "no data". Return `null` for unavailable conversions
  so callers can skip the account — never substitute `0`, which would
  understate totals and distort percentages.

## Validation

Use zod for all runtime validation of forms, JSON payloads, and object
shapes. Do not hand-write `if`/`else` conditional checks to validate data.

- Model every form, parsed JSON, or externally sourced object as a zod
  schema and validate it with `safeParse`/`parse`.
- Express type, required-field, and value-range rules in the schema rather
  than scattering `if`/`else` guards.
- Share one schema between form validation and runtime guards so "what is a
  valid X" is defined once — see `userNameSchema` in
  `src/features/user/user-store.ts`.
- Derive TypeScript types from the schema with `z.infer` instead of
  maintaining a parallel interface.

# Documentation

## Language & Translations

English is the default for all documentation and doc comments. When a Chinese
version is required, apply the `README.md` / `README.zh-Hans.md` pattern to
every README pair: English is the source of truth, both files carry the
language-switch links at the top, and the pair updates together in the same
change with semantically equivalent content. The product slogan is brand copy
and stays exactly `Your whole financial life, in one place.` in both versions
unless the user explicitly approves a localized one.

## Punctuation

Do not mix Chinese and English punctuation in any documentation. Chinese text
uses full-width punctuation (`，`、`。`、`：`、`（）`, and `“”` for double
quotes), English text uses half-width punctuation (`,`, `.`, `:`, `()`, and
`"`) — keep each language's punctuation consistent within its own text. Never
use half-width straight quotes in Chinese prose; use `“”` instead. Code blocks
and inline code keep their own ASCII punctuation untouched.
