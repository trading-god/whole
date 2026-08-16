# @whole/ocr

[English](./README.md) | [简体中文](./README.zh-Hans.md)

The account-recognition rule engine. Given the OCR blocks of an account
screenshot, it answers: what accounts are on this screen, what are they called,
what are their balances per currency, what are the last four digits, and which
institution is this?

Pure TypeScript with one dependency (`zod`) — no React Native, no Expo, no
filesystem — so the same code runs in the app through Metro, in Node through the
eval harness and CLI, and under Vitest.

## Why it is its own package

The engine used to live in `src/features/assets/`, next to the app code that
consumed it. Splitting it out buys three things:

- **It can be tested in isolation.** No Metro, no native modules, no simulator —
  `pnpm test:ocr` runs the whole suite in well under a second.
- **The boundary is enforced, not just intended.** The engine's `tsconfig.json`
  sets `"types": []`, so it can't reach for `process`, `window`, or a native
  module even by accident. If a rule needs one, that's the signal it belongs in
  the app, not here.
- **The recognition contract has one owner.** Currencies, asset kinds, and the
  last-four pattern are defined here and re-exported by the app, so the
  recognizer can never read a currency the app can't store.

## Layout

```text
src/
  contract/       What a recognized account IS — the vocabulary the app and the
                  engine must agree on.
    currency.ts        knownAssetCurrencies, CURRENCY_SYMBOLS, currencySchema
    asset-kind.ts      knownAssetKinds, assetKindSchema, lastFourDigitsSchema
    balance.ts         accountBalanceSchema
    institution.ts     institutionIdSchema, InstitutionId
    recognized-account.ts  RecognizedAccount — the engine's output
    block.ts           OcrTextBlock — the engine's input
    fixture.ts         Fixture serialization for the eval harness
  engine/         The rules that read text into those shapes.
    line-clustering.ts   flat blocks → visual rows
    line-classify.ts     row → role (accountName / amountRow / cardNumber / …)
    token-classify.ts    word → role (currency / amount / label / …)
    amount.ts            "is this money, how much, in what currency"
    currency-mention.ts  where a currency is named and how it's spelled
    kind.ts              cash / investment / crypto
    account-grouping.ts  rows → tentative accounts
    vocabulary.ts        the word lists every institution inherits
    parser.ts            the pipeline, and the public entry point
  institutions/   Per-institution overrides layered on the shared rules.
    config.ts       detection signals, icon tags, product keywords
    detect.ts       which institution is this screenshot from
  test-support/   Builders that make tests read like screenshots
```

`contract/` is standalone — it imports nothing but zod and itself, so anything
that only needs the vocabulary (the app, the eval harness) can take it without
the rule tables. `engine/` and `institutions/` are mutually recursive by design:
`parser.ts` resolves an institution's config mid-pipeline, and `institutions/`
in turn reuses the engine's token types and shared word lists. What is one-way
is the vocabulary — the shared lists live in `engine/vocabulary.ts`, so a rule
module never reaches into `institutions/` for a word list, and an institution
config carries only what is genuinely its own.

## Use

```ts
import { parseOcrBlocks, type RecognizedAccount } from "@whole/ocr";

const accounts: RecognizedAccount[] = parseOcrBlocks(blocks);
```

`blocks` are `{ text, normalizedBox }` in **0..1 normalized, top-left origin**
space — what `normalizeOcrResult` (in the app's `ocr-engine.ts`) produces from a
native OCR result.

Every field of a `RecognizedAccount` is optional: the engine reports what it
recognized and nothing more. **It never narrows its output to match what the
form can store** — a currency the form rejects is still recognized, and the form
drops it at fill time. Dropping it here would mean a future form expansion needs
new OCR work.

`parseOcrBlocksTraced` runs the same pipeline and also returns the intermediate
stages (clustered lines, per-line and per-token roles, the detected
institution) — what `pnpm ocr --trace` prints when the answer is wrong and the
question is which rule decided it.

`src/index.ts` is the only entry point. Rule-level internals used to be exported
through a second one (`@whole/ocr/internals`) for the eval harness's LLM
diagnosis tooling; that tooling is gone, and so is the export. This package's own
unit tests import each rule from its module directly, so nothing needs a public
listing to be testable.

## Test

```bash
pnpm test:ocr                            # run once (repo root)
pnpm --filter @whole/ocr run test:watch  # watch mode while editing a rule
```

Tests sit next to the rule they exercise (`engine/amount.test.ts` beside
`engine/amount.ts`) so a rule and its cases are edited together.

`test-support/screen.ts` is what keeps end-to-end tests readable — a test
describes the screen instead of hand-writing coordinates:

```ts
parseOcrBlocks(
  screen(row("Statement", "Savings", "Account"), row("SGD", "6,672.59")),
);
```

Geometry is real, not filler: rows are spaced so line clustering separates them,
and `columns([...])` pins center-x for tests of the multi-currency table, where
an amount belongs to the currency sitting above it.

### The loop for changing a rule

1. Add a failing case next to the rule.
2. Change the rule until it passes.
3. `pnpm test:ocr` — nothing else broke.
4. `pnpm eval:ocr` — no regression against real screenshots
   ([packages/ocr-eval](../ocr-eval/README.md)).

Steps 3 and 4 answer different questions. The unit tests say _this rule is
correct_; the eval says _the whole engine still reads real screenshots the way
it used to_. A rule change that improves both is the goal; one that improves the
first and regresses the second usually means the rule was carrying a case you
didn't know about.

### Known limitations are pinned, not hidden

Where the engine's behavior is knowingly imperfect, a test pins the real
behavior with a comment explaining why it stands — see "beyond the 10-digit
amount ceiling" in `engine/line-classify.test.ts`. Pinning it means a future
change surfaces as a decision rather than a surprise, and it keeps the tests
honest about what the engine actually does.

## What a screen says, and what it means

Most of the engine's difficulty is not reading digits — the OCR engine does
that — but knowing which digits are a balance. A single screen prints many
numbers that look identical and mean completely different things, and the
shared vocabulary in `engine/vocabulary.ts` is how each is told apart:

| On screen                         | What it is                   | How it's handled                                                 |
| --------------------------------- | ---------------------------- | ---------------------------------------------------------------- |
| `总资产`, `Total`, `净清算价值`   | the account's total          | held aside; used only if the screen states no balance of its own |
| `7个账户`, `3 accounts`           | a sub-account list follows   | the total above it is dropped — the parts below replace it       |
| `信用额度`, `账单到期`            | a credit facility            | never a balance                                                  |
| `您花了 4,766.92`                 | a debt                       | the balance is its negative                                      |
| `-0.51%`, `今日变动`, `当日盈亏`  | a rate or a change           | never a balance                                                  |
| `3.51亿美元`, `15.8K`             | a figure scaled by 亿/万/K/M | rejected — the parser applies no multiplier                      |
| `HKD 现金 15.8K 市场价值`         | a holding, already converted | never a balance — see below                                      |
| `Transaction History`, `净现金流` | the account list has ended   | stop reading the screen                                          |

Getting one of these wrong is not a small error. Summing a card's limit and its
statement due alongside its balance turned a 4,766.92 card into 61,180.91;
reading a marketing line's "3.51亿" as 3.51 invented a holding out of ad copy.

**A broker's holdings table is the most misleading layout of all.** It prints a
currency label on every row, but each figure beside it is already converted into
the account's base currency: IBKR's "HKD 现金 15.8K 市场价值" is 15,800 **SGD**,
not 15,800 HKD. Reading such a row as a per-currency balance is wrong twice —
wrong currency, and wrong by 1000× from the unscaled `K`. Those rows contribute
no balance at all; the account's own total (净清算价值) already includes them.

## Adding an institution

Add the id to `institutionIdSchema` (`contract/institution.ts`) and append an
`InstitutionConfig` to `INSTITUTION_CONFIGS` in `institutions/config.ts`.
`DETECT_INSTITUTIONS` derives itself from that record — every configured
institution that declares a detection signal — so there is no second list to
keep in step. Do not edit the classifier or the grouping state machine: each
institution's rules stay isolated, so an OCBC rule can't break DBS parsing.

**Detection signals.** Prefer something only that institution's own UI prints.
A brand name is not automatically safe — "IBKR" appears in the holdings list of
any broker app where the user owns the stock, so IBKR is detected by its
portfolio vocabulary (`净清算价值`) instead. Signals also have to separate
siblings: HSBC HK and HSBC SG share a brand, an app, and an account-number
format, so only their flagship product names tell them apart.

**What a config can declare:**

| Field                        | For                                                                              |
| ---------------------------- | -------------------------------------------------------------------------------- |
| `detect`                     | name tokens, product names, account-number shapes                                |
| `accountKeywords`            | this institution's product words, **including Chinese**                          |
| `defaultCurrency`            | a domestic bank printing bare figures (CMB shows `76,007.05` with no ¥ anywhere) |
| `defaultKind`                | what the institution holds when the account name doesn't say                     |
| `iconTags`                   | icon labels rendered before a name (`360`, `GSA`)                                |
| `accountNumberEndsAccount`   | number-last layouts (BOCHK)                                                      |
| `accountNumberStartsAccount` | number-first layouts (CMB Wing Lung)                                             |
| `accountNumberLastFour`      | numbers whose identifying digits aren't the tail (BOCHK's check digit)           |

Chinese account words belong in `accountKeywords`, never in the shared
`defaultAccountKeywords`. Globally, "储蓄" and "账户" label sub-account rows as
often as accounts and shatter one account into many — measured over the corpus,
adding them resolved nothing and regressed three fields. Scoped to one
institution the ambiguity disappears: "汇丰" only ever titles an HSBC HK
account.

An institution declared in `institutionIdSchema` whose config carries no
detection signals is deliberate — it stays out of `DETECT_INSTITUTIONS`,
detection returns `"unknown"`, and the engine runs with the shared defaults. The
eval tracks that as a known `unsupported-institution` gap rather than a failure.

## Related

- [`packages/ocr-eval`](../ocr-eval/README.md) — regression harness over real
  screenshots, the `pnpm ocr <image>` CLI, and the macOS Apple Vision bridge.
- `src/features/assets/ocr-engine.ts` (app) — the only module that touches the
  native OCR engine. It produces the blocks this package consumes.
