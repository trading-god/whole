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

### Supply-chain maturity gate

`pnpm-workspace.yaml` sets `minimumReleaseAge: 1440` — a version must be
published for a day before pnpm will resolve it, transitive dependencies
included. 1440 is pnpm v11's own default; it is written out because the setting
is invisible otherwise (`pnpm config get minimumReleaseAge` prints nothing for a
default) and it is the thing a same-day Expo patch release collides with.

- A package published today fails resolution outright with
  `ERR_PNPM_NO_MATURE_MATCHING_VERSION`, naming itself. That is the good case.
- The bad case is silent: where a version range is loose (an optional peer
  declared `*`), pnpm quietly keeps whatever the lockfile already had, with no
  warning. `@expo/metro-runtime` sat three patch releases behind this way, below
  the `^57.0.9` its own dependent required, and only `expo-doctor` noticed.
- `minimumReleaseAgeExclude` entries are **temporary**. Add one only to clear an
  outright failure, and delete it at the next dependency bump: a stale exclusion
  never errors, it just pins that package to the version named in it.
- After any dependency change, run `pnpm exec expo-doctor`. When a resolution
  looks frozen, note that `pnpm update` and `overrides` do not move an optional
  peer — the fix is to delete `pnpm-lock.yaml` **and** `node_modules/.pnpm/lock.yaml`
  (pnpm restores from the latter, so removing only the first is a no-op) and
  reinstall. Verify with `pnpm ios` afterwards, not just `pnpm typecheck`:
  re-resolving moves native modules and the pods have to be rebuilt.

## Technology stack

- [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/)
- React 19 and React Native 0.86
- Expo Router with typed routes
- TypeScript
- ESLint with Expo's recommended rules
- Prettier
- `i18next` and `react-i18next`
- `expo-localization`
- `expo-sqlite` for persistence (AsyncStorage remains only as the source of the
  one-time migration in `src/storage/kv-store`)
- `@tanstack/react-query` for the exchange-rate cache, persisted to sqlite
- `zod` for all runtime validation
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

Every gate below runs in CI (`.github/workflows/ci.yml`) on push to `main` and
on every pull request. They are pure JS — no simulator, no native toolchain — so
they run on a Linux runner in about a minute. Run them locally too; CI is the
backstop, not the first place to find out.

- Run `pnpm lint`, `pnpm format:check`, and `pnpm typecheck` before submitting a
  change. When the change touches recognition, also run `pnpm test:ocr` and
  `pnpm eval:ocr` (see [Testing](#testing)).
- Use `pnpm typecheck`, not a bare `pnpm exec tsc --noEmit`. The root tsconfig
  excludes `packages/`, so the bare command silently skips the recognition
  engine and the eval harness — the script runs it and then each workspace
  package's own `typecheck`.
- `lint` is a single root run (`expo lint . --max-warnings 0`), NOT `pnpm -r`.
  The explicit `.` is load-bearing: bare `expo lint` only walks `/src`, `/app`,
  and `/components`, which left `packages/` (the recognition engine and the eval
  harness) and `scripts/` outside the gate entirely. The asymmetry with
  `typecheck` is not an inconsistency — ESLint has one flat config at the root
  that already covers every workspace, while each package has its own tsconfig,
  so only `typecheck` has something to recurse into.
- `--max-warnings 0` is what makes warnings mean anything. Without it a warning
  is a message nobody is obliged to act on, and they accumulate.
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

# Testing

Two runners, split by what they test — not by preference. The split is
mechanical: **can this module be imported by plain Node, either as-is or with
one storage module mocked?**

- **`@whole/ocr` (Vitest)** — the recognition rule engine is pure TypeScript,
  so it is tested as a plain TS package: `pnpm test:ocr`. Vitest is the
  community standard there and needs no native mocks. Tests live beside the
  rule they cover (`engine/amount.test.ts` next to `engine/amount.ts`).
- **The app's pure modules (Vitest)** — `pnpm test:app`, configured in
  `vitest.config.mts`. Some of the app's most consequential rules are plain
  data-in/data-out (`account-draft.ts`, `balance-rows.ts`): they import no React
  and no Expo, so running them under jest-expo would buy a native mock layer
  they never touch. `include` enumerates directories rather than globbing
  `src/**` on purpose — a glob would swallow the first component test and fail
  on a native import instead of pointing whoever wrote it at the right runner.
  Keeping these modules importable is a constraint, not an accident: reach for
  a schema through `@whole/ocr` rather than through `asset-repository.ts`, which
  pulls in `expo-crypto` and takes the whole file out of Node's reach.
- **Modules that reach storage through one named seam (Vitest, mocked)** — also
  `pnpm test:app`. `accounts-query.ts` and `net-worth-snapshots-query.ts` are
  cache-coherence rules, not storage, but they import `asset-repository.ts` to
  do their work, so plain Node cannot load them unmodified. They qualify because
  the native dependency is a single module boundary the test can `vi.mock`
  wholesale — which is what `accounts-query.test.ts` does. That is the limit of
  the exception: mock the repository module, never a scatter of individual
  Expo calls. A module that would need a second mock belongs under jest-expo.
- **React Native components (jest-expo)** — still not set up. When a test needs
  to render a component or touch a native module, use Expo's official preset
  (`jest-expo` + `@testing-library/react-native`), not Vitest: it mocks the
  native side of the Expo SDK. Do not try to unify the runners — a pure module
  and a rendered component have genuinely different needs.

Recognition has a third layer that is neither unit test nor app test:

- `pnpm eval:ocr` replays real recorded screenshots against a **baseline** of
  known failures. It fails only on a regression, never on a pre-existing gap.
- `pnpm test:ocr:golden` hard-asserts the samples whose gold was verified
  against the screenshot. All 17 currently qualify. Only add a new sample there
  after checking its `expected.json` against the screenshot by eye — an
  unverified LLM-generated gold would pin the engine to a guess.

# Architecture & Conventions

## Project layout

```text
config/locales/        Native permission translations
scripts/               Repeatable asset-generation scripts
src/app/               Expo Router routes and layouts
src/app/dev/           Dev-only routes (Dev Tools), gated by __DEV__
src/features/assets/   Account storage, currencies, the native OCR adapter,
                       and screenshot cleanup
src/i18n/              Runtime localization, message catalogs, and terminology
src/storage/           kv-store (expo-sqlite) and the preference primitives
                       built on it
packages/ocr/          @whole/ocr — the account-recognition rule engine
                       (pure TypeScript workspace package, Vitest unit tests)
packages/ocr-eval/     Regression harness over real screenshots, the
                       `pnpm ocr <image>` CLI, and the macOS Vision bridge
assets/branding/       Source brand artwork
assets/app-icons/      Generated platform icon deliverables
.github/workflows/     CI — the quality gates on push and pull request
eslint.config.js        Expo ESLint and Prettier integration
vitest.config.mts       Vitest over the app's pure modules (`pnpm test:app`)
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

## Error Handling

`src/app/_layout.tsx` re-exports `AppErrorBoundary` as the named `ErrorBoundary`
export that expo-router looks for, which wraps every screen. Without it a render
exception reaches React's root handler, `ExceptionsManager` treats it as fatal,
and a release build shows a white screen.

- The fallback renders **outside every provider** — expo-router replaces the
  subtree, so `I18nProvider`, `LocaleContext` and `SafeAreaProvider` are all
  gone by then. It therefore resolves its copy straight from `@/i18n/resources`
  (the i18next instance is created inside the provider via `createInstance()`,
  not as a module singleton, so `useTranslation` there would render raw keys),
  and uses fixed padding instead of safe-area insets. Keep it that way: every
  dependency it takes is another way for it to fail alongside what it is
  catching.
- It shows the error message, selectable, rather than only offering Retry. A
  crash caused by unreadable stored data recurs the instant `retry` remounts, so
  a lone Retry button is a loop with no exit.
- There is deliberately **no third-party crash reporter**. Account balances and
  the account-number last four are exactly the kind of data a default Sentry
  install ships in console breadcrumbs, native crashes bypass the JS
  `beforeSend` filter entirely, and the README promises this data stays on the
  device. App Store Connect and Play Console already provide native crash
  reports at no privacy cost. Revisit only alongside an explicit change to that
  promise.

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

### Caching is TanStack Query's, not ours

The exchange-rate fetch is the app's **only** network call. Its caching used to
be hand-written — an in-memory memo, a persisted copy, a 6h TTL, a `force` flag,
and a four-level fallback — which is a query cache reimplemented by hand. That
is now `@tanstack/react-query`, configured in
`src/features/assets/query-client.ts` and used through
`src/features/assets/exchange-rates-query.ts`.

- `exchangeRatesQueryOptions(base)` is the whole contract. The base is part of
  the query key, not an argument the fetcher closes over — that is what makes a
  base change fetch its own entry instead of serving the previous base's rates
  under the new one. Refreshing is
  `refetchQueries({ queryKey: [exchangeRatesQueryPrefix] })`, which is why the
  prefix is exported separately: passing the key _builder_ by mistake
  type-checks and silently matches nothing.
- The home screen never stages the load by hand. Accounts and rates are separate
  queries, so the local read renders as soon as it lands and the network one
  follows on its own — see `use-asset-accounts.ts`.
- **Validate what comes out of the cache.** `fetchQuery` returns a cached entry
  without calling `queryFn` while it is fresh, so a snapshot rehydrated from
  disk is handed back having never passed through the fetcher. The eviction
  therefore lives in the persister's `deserialize` in `query-client.ts` — the
  only place it can be caught — not in the query module. Skipping it is how a
  corrupt snapshot turns into NaN totals instead of a "—".
- **Four query options are deliberately non-default**, and each default fails
  silently rather than loudly. `gcTime`/`maxAge` are `Infinity` (the persister's
  `maxAge` is a whole-snapshot timestamp, not a per-query TTL — on expiry it
  discards the ENTIRE cache); `shouldDehydrateQuery` persists any query holding
  data, not just successful ones (the default erases the last good rates from
  disk on the first write after a failed refresh); `networkMode: "always"` keeps
  local-data queries off the online gate; `retry: 0` keeps the home screen's
  total from waiting on backoff. The reasoning is written out in
  `query-client.ts` — read it before changing any of them.
- The net-worth snapshot chain **is** a query
  (`net-worth-snapshots-query.ts`), keyed on the `dataUpdatedAt` of accounts and
  rates so the dependency ordering is the cache's job rather than a hand-staged
  effect. It is the one query that WRITES, and that is only safe because all
  three writes are idempotent by construction: `reconcileNetWorthFlows` diffs
  rather than appends, `recordNetWorthSnapshot` replaces today's sample, and
  `migrateSnapshots` is guarded by its own version marker. A query may be
  retried, refetched on mount, and refetched on focus — so that idempotence is
  load-bearing. Check it before changing any of the three.

**Accounts are also in the cache, for one specific reason** —
`src/features/assets/accounts-query.ts`. They are NOT server state: they live in
local sqlite and `asset-repository` is still their owner and only writer. What
the cache buys is `cancelQueries`: a delete can state that any read still in
flight describes a world that no longer exists. That rule used to be three
hand-written copies of capture-the-ref-before-the-await / compare-after, and
getting it wrong resurrected a deleted account.

- Every write goes through `accounts-query.ts`, which cancels the in-flight read
  **before** the repository write and commits the result after. The `await` on
  `cancelQueries` is load-bearing — without it the cancellation races the write
  it is meant to precede.
- Accounts are **never persisted** by the query persister. The repository's
  versioned envelope is the disk format; a second copy would be a second source
  of truth, written on a different schedule, and a cold start would flash the
  older one.
- `asset-repository`'s `mutate` lock **stays**. The add and edit screens write
  directly, without passing through any hook, so ordering has to live at the
  storage layer. A mutation scope would not cover them (and `onMutate` does not
  participate in scope serialization anyway).
- Screens that write must `invalidateQueries({ queryKey: accountsQueryKey })`
  after a successful save, so the home screen never renders a frame of the
  pre-save list.
- Report a load error only when there is nothing to show
  (`isError && data === undefined`). Bare `isError` would replace a perfectly
  good list with an error card because a background re-read failed.

## Negative balances

**A balance can be negative, and the sign is load-bearing.** A credit card's
balance is what you owe; net worth is assets minus liabilities, so the debt has
to survive the whole chain — recognizer, form, storage, total — in order to be
subtracted. It once did not: the form's input schema rejected negatives, so a
correctly recognized `-4,766.92` was silently dropped on the way to storage.

- `balanceInputSchema` (in `@whole/ocr`, re-exported by `asset-repository.ts`)
  accepts negatives and zero, and rejects blank/non-numeric entries. Do not
  reintroduce a `.nonnegative()` anywhere on the balance path.
- The balance field uses `SIGNED_DECIMAL_KEYBOARD`, not `decimal-pad` — iOS's
  decimal pad has no minus key, which made a negative balance untypeable.
- `formatCurrency` puts the sign outside the symbol (`-S$4,766.92`).
- The home screen's composition bar **excludes** negative kinds: a negative
  slice is meaningless there, and leaving it in the denominator pushes the other
  kinds past 100%. Net worth still counts them.
- Card issuers differ on how they print the debt — some show what you SPENT as
  a positive ("您花了 4,766.92"), others print it already signed
  ("-1,745.52SGD"). `debtMarkers` in `@whole/ocr` covers both. A card printing a
  bare positive with no such label is genuinely ambiguous (debt or overpayment
  credit), so the recognizer reports what the screen shows and the user fixes
  the sign — which is what the editable draft is for.

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

## OCR Recognition

The recognition rule engine lives in its own workspace package,
[`@whole/ocr`](./packages/ocr/README.md) — pure TypeScript, one dependency
(zod), no React Native or Expo. The app imports it like any other package; the
only app-side OCR module is `src/features/assets/ocr-engine.ts`, which adapts
the native engine's output into the blocks the package consumes.

It is a **standalone recognition module**, decoupled from the account form. Its
goal: given any account screenshot, correctly recognize the account name,
per-currency balances, account-number last four, the currencies, and the
institution. An institution is a bank, a crypto exchange, or a broker — the
detection layer (`institutions/config.ts` / `institutions/detect.ts`) and the
`institutionNames` message catalog cover all three, so never narrow the term to
"bank" in code, comments, or copy.

- **The recognition contract is owned by the package.** Currencies, asset
  kinds, institution ids, the last-four pattern, and the `blocks.json` /
  `expected.json` fixture shapes are defined in `@whole/ocr`'s `contract/` and
  re-exported by `src/features/assets/currencies.ts` and
  `account-appearance.ts`. App modules keep their existing import paths; the
  definition stays shared so the recognizer can never read a currency the app
  can't store. Add a currency or kind in the package, not in the app.
  `contract/` depends on nothing else in the package — `engine/` and
  `institutions/` build on it, never the reverse — so a consumer that only
  needs the vocabulary doesn't drag in the rule tables.

- **Recognize everything visible; the form filters, the recognizer does not.**
  When the OCR output carries something the form does not yet support — a
  currency the form's schema rejects, or an institution not yet wired into
  detection — the form omits it instead of the recognizer suppressing it.
  Dropping recognition to match the form means a future form expansion (a new
  currency, a new institution) still needs extra OCR work; keeping recognition
  complete means only the form has to change.
- **Unsupported fields are dropped at fill time, not at recognition.** A
  currency the form cannot store yet is ignored when pre-filling, with the
  same logic used for zero-balance accounts — recognize it faithfully, then
  decide at fill time. The recognizer still extracts it so a future form can
  pick it up without rework.
- **Accuracy is the first priority.** The eval harness (`packages/ocr-eval`)
  gates the parser against gold `expected.json` so a regression in what the
  recognizer extracts is caught even when the form would currently discard it.

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
