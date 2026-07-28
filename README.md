# Whole

[English](./README.md) | [简体中文](./README.zh-Hans.md)

> **Your whole financial life, in one place.**

Whole is a privacy-conscious, cross-platform financial overview for seeing
accounts and assets together. It is built with Expo and React Native for iOS,
Android, and the web.

The current product prototype focuses on a clear asset overview and a guided
account-import flow. Users can select an account screenshot, confirm the
account details, save the account locally, and choose whether to delete the
source screenshot afterward.

## Product principles

- **One complete view** — bring cash, investments, and digital assets into one
  consistent overview.
- **Clear user control** — users review account details and explicitly confirm
  destructive actions.
- **Privacy by design** — account data is stored locally in the current
  prototype, and account screenshots are not shown in the asset overview.
- **Consistent language** — product copy is centralized, localized, and governed
  by a shared terminology guide.

## Current capabilities

- Asset overview with account balances and asset composition
- Guided account creation from an account screenshot
- Local account persistence with AsyncStorage
- Optional deletion of the selected source screenshot where the platform
  supports it
- Simplified Chinese and English interfaces
- Static web output and installable PWA metadata
- Generated iOS, Android, web, and store icon assets from one source logo

Account recognition is not yet connected to an OCR or AI service. In the
current flow, the user completes and confirms the account information
manually.

## Technology

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

## Getting started

### Requirements

- Node.js 22.13 or newer
- pnpm 11.11.0, as pinned in `package.json`
- An iOS simulator, Android emulator, or supported web browser

### Install

```bash
pnpm install
```

### Run

```bash
pnpm start
```

Or start a specific platform:

```bash
pnpm ios
pnpm android
pnpm web
```

## Quality checks

Run these checks before submitting a change:

```bash
pnpm lint
pnpm format:check
pnpm exec tsc --noEmit
pnpm exec expo export --platform web
```

Run `pnpm format` to format all supported source and documentation files.

This repository uses pnpm exclusively. Keep `pnpm-lock.yaml` as the only
dependency lockfile.

## Project structure

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

## Localization and product language

Whole uses the standard React localization stack:

- `expo-localization` detects the system locale.
- `i18next` handles resources, fallback, interpolation, and plural rules.
- `react-i18next` connects localization to the React rendering lifecycle.

Runtime copy belongs in:

```text
src/i18n/locales/en.ts
src/i18n/locales/zh-Hans.ts
```

Components should use semantic translation keys through `useTranslation()`;
do not embed user-facing copy directly in UI code. Native permission copy is a
build-time concern and lives in `config/locales/*.json`.

The canonical term is **account screenshot** in English and **账户截图** in
Simplified Chinese. Do not call it a “bank screenshot” or “银行截图”, because
Whole supports financial accounts beyond banks. See
[`src/i18n/README.md`](./src/i18n/README.md) for the complete terminology
guide.

## Privacy and screenshot handling

The current prototype stores account records locally with AsyncStorage. A
selected account screenshot is used only during the account-confirmation flow
and is not stored as part of the saved account record.

After an account is saved, Whole may offer to delete the source screenshot:

- deletion is always initiated by the user;
- the operating system may request an additional confirmation;
- browser environments cannot delete the original file from the user's device;
- if the system cannot locate or delete the screenshot, Whole instructs the
  user to remove it manually.

## Brand assets

The source logo is:

```text
assets/branding/whole-logo.svg
```

Regenerate platform assets with:

```bash
pnpm generate:icons
```

Generated icons should not be edited manually. Update the source artwork or
generator instead.

## Engineering decisions

Project-level development and architecture rules live in
[`AGENTS.md`](./AGENTS.md). Technical choices should favor maintained,
widely adopted React Native or React solutions. Any exception requires a
concrete product constraint, documented trade-offs, and explicit approval.

## License

[MIT](./LICENSE)
