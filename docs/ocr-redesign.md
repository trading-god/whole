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

## The second measurement: what happens on an institution nothing knows

The hybrid above was measured over the 17 real samples, and every one of them
has an `InstitutionConfig` written against it. Accepted risk 2 below says what
that leaves unanswered — "'Universal' has no evidence behind it yet" — and the
answer, once it was measured, was worse than "some fields are missing".

### The corpus that answered it

`packages/ocr-eval/src/synthetic/` declares screens as data and renders them:
spec → HTML → headless Chrome → the SAME macOS Apple Vision bridge the real
fixtures are recorded through. The layout is synthetic; the OCR is not. The gold
is derived from the same spec, so unlike a real sample's gold it cannot be a
misreading of the screen — the truth comes first and the pixels are derived from
it.

Twelve screens, twelve layout families the real corpus cannot reach: one row per
account under a section heading (the dominant US and UK retail shape), a
currency table, a broker's metric shelf, an exchange's asset list, an account's
own page with its transactions, a neobank's wallet, a mainland bank that prints
no currency at all, a card stated as an amount owed.

### What the rules alone do to them

**0/12 samples, accountName 15%, balance:USD 7%.** But the totals are not the
finding. The failure has one shape, and it is not a missing field:

| sample                  | the screen says | the rules report | what that figure is             |
| ----------------------- | --------------- | ---------------- | ------------------------------- |
| `us-chase-overview`     | USD 3,204.57    | USD 42,267.64    | savings + CD + card, summed     |
| `sg-ocbc-mixed`         | SGD 8,840.12    | SGD 70,958.00    | all three accounts, summed      |
| `us-ibkr-portfolio`     | USD 238,914.62  | USD 727,482.38   | net liq + buying power + margin |
| `sg-dbs-account-detail` | SGD 27,411.09   | SGD 25,878.29    | the balance minus its postings  |
| `hk-hangseng-bare`      | HKD 168,240.77  | USD 180,641.27   | both accounts, in the wrong one |

The grouping state machine has no case for the layout, so every figure lands in
one region and `finish` sums it. The number reported appears nowhere on the
screenshot, and it reaches net worth. That is strictly worse than recognizing
nothing.

### The structure turn

So on an institution the engine cannot place, the model is asked the STRUCTURAL
question instead — in the only form that cannot make things worse:

> which LINE titles each account, which line carries its number, and which lines
> carry its balance.

Line numbers, never values (`engine/structure-prompt.ts`,
`assembleAssignedAccounts`). Every name, digit and figure still comes off the
tokens the engine parsed, so a wrong answer can file a real figure under the
wrong real name — it cannot state a figure, misspell an account or invent a
currency. Assignments are verified before they are honoured: a line outside the
screen, a name line that yields no name, a balance line the engine read no figure
on, and a line a previous account already claimed are all dropped.

It is also the easier question. The 2B doing the WHOLE job scored 0–71%; this
asks it to select from a numbered list of rows the engine has already parsed,
with the rows carrying money marked `$` and the rows carrying identifying digits
marked `#`.

Measured over the synthetic corpus on the bundled Gemma 4 E2B:

| field       | rules alone | + structure turn |
| ----------- | ----------- | ---------------- |
| accountName | 19%         | **63%**          |
| balance:USD | 13%         | **73%**          |
| balance:CNY | 20%         | **80%**          |
| balance:HKD | 33%         | **67%**          |
| kind        | 48%         | **81%**          |
| lastFour    | 33%         | **56%**          |

And no fabricated totals: an assignment that does not hold up drops out, rather
than merging into the account beside it.

### Why the gate is still "is the institution known"

Because the corpus was asked the obvious follow-up and answered no. Forcing the
structure turn onto the REAL corpus — `pnpm eval:ocr:llama -- --turn structure`,
which exists for exactly this question — takes 17/17 down to **2/17**, with
accountName at 55% and balance:USD at 10%. Where a config was written against
the layout, the rules are far better than a 2B model's assignment, and letting
the model help there can only lose money. The division stands; what changed is
that it now has a measured answer on BOTH sides of the line.

Three things fell out of the measurement and were fixed as rules, because they
are generic rather than per-institution:

- `...4821` and `(...4821)` were not recognized as a masked account number. US
  and European apps abbreviate that way almost universally, and every one of
  those accounts lost its last four — the field account dedupe is keyed on.
- `recent transactions` did not end an account section (the English list is
  lead-anchored, and it does not start with `transactions`), so an account
  detail page's postings were summed into the account above them.
- A broker's metric shelf — buying power, maintenance margin, excess liquidity —
  carried no non-balance markers, so the account's leverage was reported as the
  user's money.

### What is still open on it

- **A known institution in an unfamiliar layout still fabricates.** A config is
  authored against ONE screen, so the same bank's account-detail page is as
  unfamiliar as a bank nothing knows — `sg-ocbc-mixed` and `us-ibkr-portfolio`
  are baselined as exactly that. "Configured institution" is a proxy for "layout
  the rules were written against", and it is an imperfect one.
- **A trailing `DR` is not read as a debit.** `1,893.09 DR` is standard on HK,
  SG, UK and Indian statements, and the debt vocabulary is built around a label
  BEFORE the figure (`debtMarkerEndIn` returns where the label ends and takes
  the first figure after it). Supporting a suffix marker is a change to
  `balanceAmountsOf`, not a word in a list.
- **The synthetic corpus is layout evidence, not institution evidence.** Each
  spec is one person's model of how an app lays a screen out. It says the engine
  handles a FAMILY; it says nothing about what any named company actually
  renders.

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
