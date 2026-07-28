# App icon assets

`assets/branding/whole-logo.svg` is the single source of truth for the Whole mark.

Run `pnpm generate:icons` after editing the SVG. The script generates:

- Expo/EAS master images in `assets/images`
- iOS point/scale variants in `assets/app-icons/ios`
- Android legacy, adaptive, monochrome, and Play Store variants in `assets/app-icons/android`
- Browser, Apple touch, and installable PWA icons in `public/icons`

Do not round the corners of the generated iOS icon. iOS applies the platform mask.
Android adaptive foreground and monochrome files intentionally include transparent
safe-area padding; their background is configured separately in `app.json`.
