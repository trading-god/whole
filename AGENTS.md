# whole

A personal finance aggregation app built on Expo + React Native. This file
is the source of truth for project conventions; `CLAUDE.md` includes it via
`@AGENTS.md`.

# Tooling & Environment

## Expo SDK

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/
before writing any code.

## Package Manager

Use pnpm exclusively for dependency installation and package scripts.

- Use the pnpm version pinned by the `packageManager` field in `package.json`.
- Keep `pnpm-lock.yaml` as the only dependency lockfile.
- Do not run `npm install`, `npm ci`, `npm run`, `npx`, Yarn, or Bun in this
  repository.
- Use `pnpm install`, `pnpm <script>`, and `pnpm exec <binary>` instead.

## Technology stack

- [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/)
- React 19 and React Native 0.86
- Expo Router with typed routes and static web rendering
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
- Run `pnpm exec expo export --platform web` to verify static web output
  builds.
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
public/                PWA manifest and public web assets
scripts/               Repeatable asset-generation scripts
src/app/               Expo Router routes and layouts
src/features/assets/   Account storage, currencies, and screenshot cleanup
src/i18n/              Runtime localization, message catalogs, and terminology
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
- `COLORS.brand` is the canonical brand color. `app.json`
  (`expo.web.themeColor`) and `public/manifest.json` (`theme_color`) mirror it
  — keep all three in sync when it changes.
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

Split platform differences into per-platform files with a consistent API
rather than runtime `Platform.OS` branches scattered through feature code.

- The key-value store is split as `src/storage/kv-store.ts` (native, SQLite)
  and `src/storage/kv-store.web.ts` (web, AsyncStorage); both export the same
  `getItem` / `setItem` / `removeItem` / `withTransaction` surface so callers
  stay platform-agnostic.
- Follow the same `<name>.web.ts` / `<name>.native.ts` pattern for any new
  module that needs a different backend per platform.

## Storage

- Use `src/storage/kv-store` for all key/value persistence. Namespace keys
  with the `whole.` prefix.
- Wrap a batch of dependent writes in `withTransaction` so the commit is
  all-or-nothing (the kv and net-worth-history migrations use this to keep
  data and migration marker atomic).
- Store secrets (API keys, credentials) with `expo-secure-store`, falling
  back to the key-value store where SecureStore is unavailable — see
  `src/features/settings/llm-config-store.ts` for the read/write/clear
  pattern.

## Internationalization

Whole uses the standard React localization stack: `expo-localization` detects
the system locale, `i18next` handles resources, fallback, interpolation, and
plurals, and `react-i18next` connects localization to the React rendering
lifecycle. Native permission copy is a build-time concern and lives in
`config/locales/*.json`.

- All user-visible text goes through i18next (`src/i18n/locales/en.ts` and
  `zh-Hans.ts`). Keep the two locale files synchronized: every new key is
  added to both.
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

## LLM Access

- All LLM calls go through `src/features/settings/llm-client.ts`. Feature
  modules depend on settings one-way; settings must not reach into a feature
  that consumes it (that would recreate a settings ↔ assets cycle).
- The client normalizes SDK errors to a plain `Error` with a display-ready
  `message`. Surface `error.message` directly in feature code rather than
  importing the OpenAI SDK.

## Validation

Use zod for all runtime validation of forms, JSON payloads, and object
shapes. Do not hand-write `if`/`else` conditional checks to validate data.

- Model every form, parsed JSON, or externally sourced object as a zod
  schema and validate it with `safeParse`/`parse`.
- Express type, required-field, and value-range rules in the schema rather
  than scattering `if`/`else` guards.
- Share one schema between form validation and runtime guards so "what is a
  valid X" is defined once — see `llmConfigSchema` in
  `src/features/settings/llm-config-store.ts`.
- Derive TypeScript types from the schema with `z.infer` instead of
  maintaining a parallel interface.

# Documentation

## README Translations

`README.md` is the English source and `README.zh-Hans.md` is its Simplified
Chinese counterpart. Keep both documents synchronized.

- Any change to either README must update the other README in the same change.
- Keep their section structure, product facts, commands, links, and status
  statements semantically equivalent.
- Preserve the language switch links at the top of both files.
- The product slogan is brand copy and must remain exactly
  `Your whole financial life, in one place.` in both versions unless the user
  explicitly approves a localized slogan.
