# Recognition redesign: from per-institution rules to a model

Status: the pipeline is built, tested, and is now what the app calls. The old
rule engine is no longer on the app's recognition path; it survives only as the
eval harness's subject until that is repointed.

Done — every module below written test-first, all at 100% coverage on lines,
branches, functions and statements:

- `@whole/llm` — provider config, the two request builders, `sendChat` with its
  failure classification. Transport is an injected parameter, so the package
  reaches no global.
- `@whole/ocr` — `grid` (rows plus column bands, degrading to rows), `serialize`
  (the compact text the model reads), `prompt` (the instructions and the JSON
  Schema, derived from the zod schema), `resolve` (indices back to values),
  `fingerprint` (the template key), `recognize` (the loop, with the model call
  injected).
- The app — `model-runner` (one attempt to one chat turn), `model-provider-store`
  (key in `expo-secure-store`, everything else in `kv-store`, consent per host),
  `model-recognition` (the entry point and every reason it can decline),
  `recognition-issue` (each reason mapped to its own message, because each has
  a different next step), and `screenshot-recognition`, which now returns a
  RESULT rather than a list.
- `packages/ocr-eval/src/index-contract.test.ts` replays all seventeen verified
  samples and asserts the claim the design rests on: every gold balance, last
  four and account name is present in some block, so the index-only contract can
  express the right answer on real screens. It passes on all seventeen.

Two contract gaps that test found, and how they were closed:

- **A card's debt.** Issuers print it two ways, and the second — "您花了
  4,766.92", a positive figure beside a label — puts the minus in the LABEL,
  which no index can point at. The balance now carries an `isDebt` flag the
  model sets from the label; the resolver negates the magnitude, idempotently,
  so an already-signed figure does not flip back.
- **A trailing check digit.** "012-394-2-033676-3" is account 033676, read as
  3676, not the mechanical tail 6763. The model may now state the four digits —
  but the resolver requires them to appear in the block it pointed at, so the
  provenance guarantee holds for the one field where a value rather than an
  index is allowed.

Not done: the configuration UI and consent screen, deleting the old rule engine
(the eval harness still runs it), repointing the eval harness at the model
pipeline, the contract changes below, crypto pricing, and the template cache's
storage.

## The problem

`@whole/ocr` recognizes accounts by rule. Adding an institution means adding
detection signals, product keywords, and — when its layout is genuinely new —
another flag on the shared grouping state machine. `accountNumberEndsAccount`
and `accountNumberStartsAccount` are what that looks like: two booleans that
exist because BOCHK and Wing Lung each print their account number somewhere the
state machine did not expect.

That is 1910 lines of `engine/account-grouping.ts` plus 560 lines of
`institutions/` covering 14 institutions, concentrated in SG, HK, and mainland
China. It cannot reach the long tail — there are thousands of banks, brokers,
and exchanges, and each one costs a code change and a release.

## The goal

Recognize an account screenshot from **any** institution with no
institution-specific code. The engine becomes: OCR text in, model call, then
deterministic validation. A person confirms the result.

Deleted: `engine/account-grouping.ts`, `institutions/config.ts`,
`institutions/detect.ts`, all 14 institution configs, and the existing eval
baseline.

Kept: `contract/`, `engine/line-clustering.ts` (pure geometry, institution-
agnostic), and the column-alignment logic currently buried inside
`account-grouping.ts`.

## Layout

Three layers, with the boundary enforced by the compiler rather than by
convention.

| Package      | Holds                                                                                                          | Purity                                    |
| ------------ | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `@whole/ocr` | Contract, row/column grid, prompt serialization, index deserialization, field validation, template fingerprint | Pure functions, `types: []`, zero IO      |
| `@whole/llm` | Provider config schema, request construction, response parsing, error classification                           | Pure functions **plus an injected fetch** |
| `src/`       | Real fetch, key access, UI, retry loop                                                                         | React Native                              |

`@whole/llm` never references a global `fetch`. Its entry point takes one:
`send(config, request, fetchImpl)`. That is what makes 100% coverage cheap —
every error path (401, 429, timeout, malformed JSON) is a two-line fake, and the
package stays importable by plain Node.

## The pipeline

```text
screenshot
  → native OCR (Apple Vision / ML Kit, unchanged)
  → row clustering + column clustering → 2D grid
      (degrades to rows alone when no column alignment is detectable)
  → compact text serialization, coordinates at 3 decimal places
  → openai SDK call against the user's configured endpoint
  → model returns block INDICES as JSON
  → deterministic validation
  → editable draft → user confirms
```

### The model returns indices, not text

Account names, balances, last-four digits, and currencies are all expressed as
indices into the OCR blocks. Only genuinely inferred fields — `kind`, the
institution display name — are free text.

This is what makes hallucination structurally impossible: the model cannot
invent a number, because the number is produced by our code from an index.
Out-of-range indices fail validation and drop that field.

### Text only, never the image

Two reasons, and the second one is stronger than it looks.

The first is cost and reach: roughly 1500 tokens per screenshot, and any text
model can serve it. Requiring vision would raise the bar on a bring-your-own
endpoint to the point where locally hosted models fall out.

The second is that **the image does not carry the information it appears to
carry**. The OCBC and CMB overview screenshots contain no brand logo anywhere on
screen — not in a header, not in the tab bar. Everything that identifies the
institution is text: `360 Account`, `GSA`, `朝朝宝`, `活钱`,
`买理财，来招行`, and the account-number morphology. A vision model sees the
same evidence a text model does. See "Institution inference" below.

Giving the model the image would also break the index contract: it could read a
number the OCR never produced, and that number could not be validated.

## Validation

Four tiers:

1. **zod schema** — shape, enums, numeric format.
2. **Provenance** — every value resolves to a legal block index.
3. **Consistency sampling** — balances only, and only where the first two pass
   but ambiguity remains.
4. **Human confirmation** — the editable draft. Always.

On failure, the specific error is fed back to the model and retried, **at most
three times**. After that, fields that passed are kept, failed fields are left
blank, and the error is reported by cause: invalid key, rate limited, network,
or model output not parseable. Under a bring-your-own endpoint the user is the
only person who can fix any of these, so the distinction has to reach them.

There is deliberately no multi-turn agent loop. The whole input is supplied at
once, so there is nothing for the model to go and look up; more turns buy
nothing but latency and a more confidently held wrong answer.

Structured output is probed and degraded: try `json_schema`, fall back to prompt
constraint, and record the result on the provider config as
`structuredOutput`. Probe once, benefit forever.

**Provenance catches fabrication, not misattribution.** A model can quote the
right number in the wrong place — a sub-account balance attributed to the parent
account, every character traceable, the grouping wrong. Only tier 4 catches
that.

## Institution inference

The institution is inferred from product names, account-number morphology, and
vocabulary — not from a brand string, which is frequently absent.

Signal audit over the 17 existing samples: 11 carry a brand name or a uniquely
identifying product name (`余额宝`, `龙卡通`, `朝朝宝`, `DBS Multiplier`,
`汇丰One`). Four require product knowledge (`360 Account` → OCBC,
`智能账户` + `012-…` → BOCHK). Two are genuinely hard:

- **IBKR** — the text contains `IBKR NASDAQ.NMS`, but that is a _holding_, not
  the app's brand. Any broker app where the user owns the stock prints it. The
  real signal is the portfolio vocabulary (`净清算价值`, `维持保证金`).
  `institutions/config.ts` documented this exact trap before it was deleted.
- **Wing Lung** — its signal is `一卡通`, which is China Merchants Bank's
  product name; Wing Lung is CMB's subsidiary and inherited it.

Both were also unsolvable by rule, which is why they had hand-written config.
The model gets the same signals the rule engine had, plus world knowledge it
never had. The floor is the old behavior; the ceiling is much higher.

The accuracy bar is also lower than it used to be. `detectInstitution` was a
routing decision — get it wrong and the whole parse ran under the wrong rules.
The institution is now a display field: it does not touch balances, account
names, last-four, or the net-worth total, a wrong value is obvious to the user,
and one correction is remembered by the template. 65–85% on a field like that
is sufficient.

Two enhancements, both agreed:

- **Confidence and alternates.** When uncertain the model returns candidates
  ("China Merchants Bank or Wing Lung Bank") and the draft offers a choice
  rather than a blank.
- **The user's existing accounts as a candidate set.** Someone with six
  institutions already on file gives the model a prior that collapses most
  ambiguity. This reuses the template mechanism; it is not a new concept.

Prompt guidance, backed by the samples above: the institution name will often
not appear literally. Infer it from product names, account-number format,
vocabulary, and marketing copy. If it cannot be inferred, leave it blank rather
than guess.

Related: screenshots are taken wherever the user happened to be scrolled, so
page-level headers ("total assets", "account overview") may be absent entirely —
`ocbc-partial-overview` is exactly this. The model reports what is on screen and
never reconstructs a total it cannot see.

## Privacy and configuration

The promise changes from "never leaves the device" to **"nothing leaves the
device by default; you may connect an endpoint of your own."**

- Provider config follows pi-ai's shape:
  `{ baseUrl, api, apiKey, models[], structuredOutput }`. `api` is a protocol
  discriminator (`openai-chat` / `anthropic-messages`), not an adapter tree.
- Client uses the `openai` SDK, verified to work under React Native. Note that
  neither official SDK claims React Native support, and `@ai-sdk/*` is ruled out
  outright: it depends on `undici`, which Metro cannot resolve.
- **API key lives in `expo-secure-store`** (a new dependency). `baseUrl` and
  model id go in `kv-store`; `kv-store` is plaintext sqlite and must not hold
  the key.
- Off by default. First activation shows a one-time consent screen naming the
  **resolved host**, and distinguishing a loopback or LAN address from an
  external server — the privacy meaning is completely different and the UI
  should say so rather than making the user parse a URL.
- Token usage is reported as token counts, **never converted to money**: under a
  bring-your-own endpoint the price is unknown, and a wrong number is worse than
  no number. Users may optionally supply their own unit price. Local endpoints
  show "local model" instead of a cost field.
- Usage totals live in `kv-store` under the `whole.` prefix, not in the query
  cache.

## Contract changes

|             | Now                                                  | Becomes                                                                                                                                    |
| ----------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| currency    | 4-member closed enum                                 | **Layered**: fiat stays a closed ISO 4217 enum (has a symbol, can be converted); crypto moves to an open token field                       |
| institution | 14-id enum, and the i18n name catalog is keyed by it | **Open** `{ id?, displayName }`; display name is read off the screenshot, and the catalog degrades to localization overrides for known ids |
| asset kind  | 3-member closed enum                                 | **Stays closed**                                                                                                                           |

The test is who holds the authority. The authority on an institution's name is
the screenshot — it is printed there, and requiring it to pre-exist in an i18n
file is exactly the coupling this redesign removes. The authority on asset kind
is the net-worth logic: `cash` / `investment` / `crypto` are not descriptive
labels, they decide what the composition bar excludes and what gets subtracted.
Opening that up lets the model invent entries in the ledger model.

Accounts already stored under one of the 14 ids stay valid. **No data migration
is required.**

`CURRENCY_SYMBOLS`, `formatCurrency`, and `convertCurrency` all change with the
currency split.

## Crypto and pricing

Crypto assets **participate in the net-worth total**. Price source: CoinGecko's
keyless tier.

**Query the whole set, never the holdings.** Pull a fixed top-200 price table
and match locally. The outgoing request is then identical for every user, so an
observer learns nothing about this user's positions — querying only what someone
holds makes the request itself a portfolio disclosure. It also turns N requests
into one, which is what makes a keyless rate limit workable.

A token outside the table has no price. Per the existing rule, return `null` and
skip the account; **never substitute `0`**, which understates the total. The UI
says plainly that some assets have no price data.

Symbol collisions resolve to the highest market cap, which is nearly always
right and occasionally wrong — so it is correctable in the draft, and the
correction is remembered by the template.

Caching **reuses `query-client.ts` unchanged**: same queryClient, same
persister, `networkMode: "always"`, `retry: 0`, `gcTime: Infinity`. The price
table also needs a validation pass in the persister's `deserialize`, for the
same reason the exchange rates do: `fetchQuery` skips `queryFn` while data is
fresh, so a snapshot rehydrated from disk never passes through the fetcher, and
`deserialize` is the only place it can be checked.

Do not give prices their own shorter TTL. Net-worth snapshots are recorded
daily; second-level price precision buys the product nothing.

## Template learning

Fingerprint: a hash of the **text skeleton** — the block text sequence with all
digits replaced by a placeholder. The same app on the same page keeps its
labels; only the amounts move. That is precisely the definition of "same
layout".

Below a match threshold, fall back to the model.

A hit both skips the model call (cost, latency, offline, and a privacy exposure
of zero) and carries the user's corrections. **Corrections are structural, never
values** — "in this layout the third block group is a credit limit, not a
balance" — and the result still passes the full validation chain.

## Testing and quality gates

- **All code at 100%** on lines, branches, functions, and statements. `v8
ignore` is not permitted. Written into each config, not left to review.
- `@whole/ocr` and `@whole/llm` under Vitest; `src/` under `jest-expo` with
  `@testing-library/react-native`.
- **Run ios and android as two projects and merge coverage** — this is what
  makes `Platform.OS` branches reachable.
- **`__DEV__` becomes an injectable constant**, so the production branch of a
  dev-only route is reachable from a test.
- **Drop `default` from exhaustive switches in favour of `assertNever`**, and
  test `assertNever` itself. The function gets covered; the call sites stop
  having an unreachable branch.

Eval:

- Set aside 5 of the 17 samples as a **holdout, chosen across institution
  types** (broker, exchange, mainland bank, HK/SG bank, payment) — the point is
  to measure layout-family generalization, and five samples from one family
  measure nothing.
- Grow the set from App Store screenshot pages, which are real layouts, publicly
  available, and carry no real balances.
- **Keep marketing screenshots and real captures in separate baselines.** The
  first measures layout generalization; the second measures dirty input — OCR
  reading `0` as `O`, cropped screens, dark mode.

## Order of work

1. **Set up `jest-expo` first.** Without a runner there is no TDD.
2. Backfill tests for everything the redesign will not touch — theme, i18n,
   storage, presentational components. None of that work is wasted.
3. Add `expo-secure-store`, create `@whole/llm`, build the configuration UI and
   consent screen.
4. Get the pipeline working against the 12 development samples. **During this
   stage the prompt may not be tuned toward any specific institution.**
5. Stop as soon as it works and grow the sample set, then tune the prompt.
6. Recognition UI and `src/features/assets/` are rewritten test-first alongside
   the pipeline.

## Accepted risks

Five, recorded so the reasoning survives.

1. **Text-only is a bet.** Colour, icons, dividers, and type size are gone;
   visual grouping survives only as coordinates. The existing line clustering is
   pure geometry and works, so the bet looks sound, but it is unverified. If a
   family of layouts fails systematically once the sample set grows, vision is
   the documented plan B.
2. **The product narrows.** Requiring a model endpoint makes this a tool for
   users willing to configure one. Onboarding, README, and store copy all follow
   from that.
3. **CoinGecko's keyless tier is someone else's policy.** It has been tightened
   before. Keep the price source behind an interface so CoinLore or DIA can
   replace it.
4. **100% coverage is a large piece of work** — 38 components and 7 route
   screens currently at zero, with no runner. The three deadlocks above must be
   resolved before starting, not after.
5. **"Universal" has no evidence behind it yet.** 17 samples, 14 institutions,
   all in SG/HK/CN. No European or US retail bank, no DeFi wallet, no Japanese
   or Korean broker. Step 5 is not optional.
