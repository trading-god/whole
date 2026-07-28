# Whole copy and localization

Runtime copy lives in `locales/zh-Hans.ts` and `locales/en.ts`. UI code should
use semantic translation keys through `useTranslation()` from
`react-i18next` instead of embedding user-facing strings. `i18next.d.ts`
derives key types from the English catalog, while the English catalog is
type-checked against Simplified Chinese, so unknown, missing, or structurally
inconsistent translations fail TypeScript.

`expo-localization` owns system-locale detection. `i18next` owns resource
lookup, fallback, interpolation, and plural selection. `react-i18next` owns the
React subscription and rendering lifecycle. Use `useAppLocale()` only for
locale-aware value formatting that is specific to Whole.

Native permission copy is build-time configuration and therefore lives in
`config/locales/*.json`. Keep those files aligned with the same terminology.
`expo-image-picker` and `expo-media-library` both write the iOS
`NSPhotoLibraryUsageDescription` key, so their base messages in `app.json` must
remain identical and cover both selecting and deleting an account screenshot.

## Terminology

| Concept                                         | Simplified Chinese | English            | Avoid                |
| ----------------------------------------------- | ------------------ | ------------------ | -------------------- |
| A screenshot of any supported financial account | 账户截图           | account screenshot | 银行截图、图片、原图 |
| A financial account                             | 账户               | account            | 资产账户             |
| The account identifier shown in the form        | 账号后四位         | last four digits   | 账户号码后四位       |
| The main asset screen                           | 资产总览           | asset overview     | 资产首页             |
| Currency code selection                         | 币种               | currency           | 货币类型             |

Use product nouns consistently. Actions can be shortened when the surrounding
context already names the object, but accessibility labels should remain
explicit.
