# Recognition redesign: what was proposed, what was measured, what shipped

A decision record. The proposal was to delete the per-institution rule engine
and let a model do the whole job; the measurement said otherwise, and what
shipped is a hybrid. This file keeps the argument on both sides, because the
reasoning is what a future change has to overturn — not the conclusion.

## The problem the redesign was answering

`@whole/ocr` recognized accounts by rule. Adding an institution meant adding
detection signals, product keywords, and — when its layout was genuinely new —
another flag on the shared grouping state machine.
`accountNumberEndsAccount` and `accountNumberStartsAccount` are what that looks
like: two booleans that exist because BOCHK and Wing Lung each print their
account number somewhere the state machine did not expect.

That is 1900 lines of `engine/account-grouping.ts` plus `institutions/`
covering 14 institutions, concentrated in SG, HK and mainland China. It cannot
reach the long tail — there are thousands of banks, brokers and exchanges, and
each one costs a code change and a release.

## The proposal: model does everything

OCR text in, one model call, deterministic validation out. No
institution-specific code at all. `engine/account-grouping.ts`,
`institutions/config.ts`, `institutions/detect.ts` and all 14 configs deleted;
`contract/` and the pure geometry in `engine/line-clustering.ts` kept.

Two design choices in it are still the right ones, and both survived into what
shipped — the first in a stronger form than it was proposed in:

**The model never states a value.** As proposed, names, balances, last fours and
currencies were all block INDICES, so a figure was produced by our code from an
index and an out-of-range index failed validation. What shipped goes further:
the model is not asked for those fields at all. It addresses the engine's
REGIONS by number and answers only kind, institution and home currency, so there
is no index to get wrong — it cannot invent an account, and it cannot change a
figure the screen stated.

**Text only, never the image.** Cost and reach are the smaller reason. The
stronger one is that _the image does not carry the information it appears to
carry_: the OCBC and CMB overview screenshots contain no brand logo anywhere on
screen. Everything identifying the institution is text — `360 Account`, `GSA`,
`朝朝宝`, `活钱`, `买理财，来招行`, and the account-number morphology. A vision
model sees the same evidence a text model does.

It was built and it was measured. That is the part that matters.

## The measurement that overturned it

A 2B (Gemma 4 E2B) and a 4B (Qwen3) model doing the WHOLE job scored **0–71%
per field** over the seventeen gold samples, with account grouping the dominant
failure for both. The deterministic engine they were meant to replace passes
**100%** of the same samples.

Structure is what a rules engine is good at and what a small model is worst at.
Letting the model help with it can only lose money.

## What shipped: the hybrid

The engine owns structure — accounts, balances, currencies, debt signs,
mechanical last fours. The bundled model is asked only what rules cannot know,
in one annotation turn (`engine/recognize.ts`, `engine/annotate-prompt.ts`):

1. the **institution**, when no brand appears on screen;
2. an account **kind**, where no keyword and no institution prior applies;
3. the screen's **home currency** — what a domestic app means by a bare number.

Every answer is verified against the region the engine already extracted before
it is believed, so the model cannot invent an account or change a figure. The
result is 17/17, at parity with the engine on every field the engine reads.

The third question was added last, and by measurement rather than by argument.
`pnpm eval:ocr:ablate` replays the corpus with one tier of institution config
removed at a time; the currency default is the largest single thing a missing
config costs. Paired with `eval:ocr:llama --ablate currency`, the model recovers
four of the five samples that tier is worth. The same pairing says the model
cannot help with the `keywords` tier — which row titles an account is a property
of the screenshot, not of the institution. `packages/ocr-eval/README.md` has the
table.

### The model runs on the device

The proposal assumed a user-supplied endpoint, and would have changed the
privacy promise from "never leaves the device" to "nothing leaves by default;
you may connect an endpoint of your own". That is gone: the weights ship with
the app, recognition is the bundled model or nothing, and the original promise
stands unchanged. `@whole/llm`, the provider config, the API-key storage and the
consent screen were all removed with it.

## Validation

Four tiers, unchanged by the hybrid:

1. **zod schema** — shape, enums, numeric format. Compiled to a GBNF grammar,
   so a malformed answer is unreturnable rather than merely rejected.
2. **Provenance** — every value resolves to something the engine read.
3. **Consistency** — the annotation is applied only to a region the engine
   emitted.
4. **Human confirmation** — the editable draft. Always.

On failure the specific violation is fed back and retried, at most three times.

**Provenance catches fabrication, not misattribution.** A model can quote the
right number in the wrong place — a sub-account balance attributed to the parent
account, every character traceable, the grouping wrong. Only tier 4 catches
that, which is the other half of why the engine keeps the grouping.

## Institution inference: the signal audit

Worth keeping, because it is what the annotation turn is asked to do. Over the
17 samples: 11 carry a brand name or a uniquely identifying product name (`余额
宝`, `龙卡通`, `朝朝宝`, `DBS Multiplier`, `汇丰One`). Four require product
knowledge (`360 Account` → OCBC, `智能账户` + `012-…` → BOCHK). Two are
genuinely hard:

- **IBKR** — the text contains `IBKR NASDAQ.NMS`, but that is a _holding_, not
  the app's brand; any broker app where the user owns the stock prints it. The
  real signal is the portfolio vocabulary (`净清算价值`, `维持保证金`).
- **Wing Lung** — its signal is `一卡通`, which is China Merchants Bank's product
  name; Wing Lung is CMB's subsidiary and inherited it.

Both were unsolvable by rule too, which is why they had hand-written config. The
model gets the same signals plus world knowledge the rules never had. The
accuracy bar is also lower than it was under the rule engine: the institution
used to be a ROUTING decision, and getting it wrong ran the whole parse under
the wrong rules. It is now a display field the user can correct.

Screenshots are taken wherever the user happened to be scrolled, so page-level
headers ("total assets", "account overview") may be absent entirely —
`ocbc-partial-overview` is exactly this. The recognizer reports what is on
screen and never reconstructs a total it cannot see.

## Still open

Recorded as ideas, not as plans — none of them is built.

- **Crypto pricing.** Crypto assets should participate in the net-worth total.
  If a price source is added: query a fixed top-200 table and match locally,
  never the user's own holdings — querying what someone holds makes the request
  itself a portfolio disclosure. A token outside the table has no price, so
  return `null` and skip the account; never substitute `0`.
- **Template learning.** Fingerprint a screen by the hash of its text skeleton
  (block text with digits replaced by a placeholder — the same app on the same
  page keeps its labels, only the amounts move). A hit would skip the model call
  and carry the user's corrections. Corrections would have to be structural
  ("the third group is a credit limit, not a balance"), never values.
- **An open institution contract.** The institution is still a 14-id enum keyed
  to the i18n name catalog, while the model answers free text. The authority on
  an institution's name is the screenshot. Asset kind stays closed either way:
  `cash` / `investment` / `crypto` decide what the composition bar excludes and
  what net worth subtracts, so opening it would let the model invent ledger
  entries.

## Accepted risks

1. **Text-only is still a bet.** Colour, icons, dividers and type size are gone;
   visual grouping survives only as coordinates. The ablation's `layout` mode is
   the measurement of what that costs, and it is the one tier a screenshot
   answers visually — so it is where vision, if ever added, would have to pay
   for itself.
2. **"Universal" has no evidence behind it yet.** 17 samples, 14 institutions,
   all in SG/HK/CN. No European or US retail bank, no DeFi wallet, no Japanese
   or Korean broker. The ablation is a substitute for that evidence, not a
   replacement: every ablated run still replays a layout the rules were written
   against, so each score is a ceiling.
3. **A bundled model is ~3 GB of app.** That is the price of the promise that
   nothing leaves the device, and it is paid by every user whether or not they
   ever recognize a screenshot.
