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

| Concept                                                                  | Simplified Chinese | English            | Avoid                |
| ------------------------------------------------------------------------ | ------------------ | ------------------ | -------------------- |
| A screenshot of any supported financial account                          | 账户截图           | account screenshot | 银行截图、图片、原图 |
| The institution an account belongs to (bank, crypto exchange, or broker) | 机构               | institution        | 母账户、分组、母行   |
| A financial account under an institution                                 | 账户               | account            | 子账户、资产账户     |
| The account identifier shown in the form                                 | 账号后四位         | last four digits   | 账户号码后四位       |
| The main asset screen                                                    | 资产总览           | asset overview     | 资产首页             |
| Currency code selection                                                  | 币种               | currency           | 货币类型             |

Accounts group under an institution (a bank, crypto exchange, or broker) on the
home screen. An institution is a named container — it carries only a name and a
total of its accounts' balances, no card number or type of its own. The code
calls this an `AssetAccountGroup` (`group`/`groupId`); user-facing copy always
says "机构"/"institution".

Use product nouns consistently. Actions can be shortened when the surrounding
context already names the object, but accessibility labels should remain
explicit.
