# Whole

[English](./README.md) | [简体中文](./README.zh-Hans.md)

> **Your whole financial life, in one place.**

Whole is a privacy-conscious mobile financial overview for seeing accounts and
assets together. It is built with Expo and React Native for iOS and Android.

Whole is mobile-only by design: account recognition reads account screenshots
through the native image-picker and media-library pipeline, which a browser
build cannot provide. There is no web version.

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
- Edit saved account details (name, balances, and type)
- Local account persistence
- Optional deletion of the selected source screenshot where the platform
  supports it
- Simplified Chinese and English interfaces

Account recognition runs entirely on device — a screenshot is read by native
OCR (Apple Vision on iOS, ML Kit on Android) and never leaves the device.

## Getting started

### Requirements

- Node.js 22.13 or newer
- pnpm 11.11.0, as pinned in `package.json`
- An iOS simulator or Android emulator

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
```

## Privacy and screenshot handling

The current prototype stores account records locally. A selected account
screenshot is used only during the account-confirmation flow and is not stored
as part of the saved account record.

After an account is saved, Whole may offer to delete the source screenshot:

- deletion is always initiated by the user;
- the operating system may request an additional confirmation;
- if the system cannot locate or delete the screenshot, Whole instructs the
  user to remove it manually.

See [`AGENTS.md`](./AGENTS.md) for development and architecture conventions.

## License

[MIT](./LICENSE)
