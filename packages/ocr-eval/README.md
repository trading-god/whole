# OCR Eval / Regression Suite (validation set)

[English](./README.md) | [简体中文](./README.zh-Hans.md)

This is not a "training set" — iOS Apple Vision and Android ML Kit are
**pretrained models** that cannot be fine-tuned on-device. The purpose of this
directory is to drive and verify the correctness of the rule engine in
[`@whole/ocr`](../ocr/README.md): **the rule engine is the only thing being
iterated on**, and the eval suite is its regression gate.

Division of labour with the engine package: `@whole/ocr` unit-tests each rule
against synthetic input (`pnpm test:ocr`), and this harness checks the whole
engine against real recorded screenshots. A rule can be correct in isolation and
still read a real screen wrong, which is why both exist.

The parser's target scope is **multi-currency account overviews, single-account
rows** for the user's common institutions, and one row each for brokerages and
crypto. Anything else falls through to the existing "unrecognized → manual
entry" path.

## Directory structure

```
packages/ocr-eval/
  src/
    run-eval.ts          # Orchestrator: runs all samples, per-sample/per-field output
    baseline.ts          # Known-failure baseline: regression gate + gap classification
    compare.ts           # Field-level gold comparison (accountName / lastFour / balances / kind / institutionId)
    render.ts            # ASCII table output
    recognize.ts         # `pnpm ocr` — recognize one image (or one sample) end to end
    vision.ts            # macOS Apple Vision bridge driver: screenshot.png → blocks.json (pnpm eval:ocr:vision)
    vision-bridge.ts     # Shared compile-and-run for the Swift Vision bridge
    golden.test.ts       # Hard assertions over the human-verified samples (pnpm test:ocr:golden)
    verified-samples.ts  # Which golds a human has checked — read by golden.test.ts AND vision.ts
    baseline.test.ts     # Unit tests for the baseline gate's own diff arithmetic
    paths.ts             # Package root / samples path resolution (based on import.meta)
  vision/
    recognize-text.swift # Apple Vision OCR on macOS, mirroring the iOS request config
  baseline.json          # Known failures per sample/field — the regression gate's reference
  samples/<slug>/
    blocks.json          # Real on-device OCR output (normalized 0..1 boxes) — committed regression fixture
    expected.json        # Manually annotated gold RecognizedAccount[]
    screenshot.png       # Real account screenshot — private, gitignored, not committed
    notes.md             # Optional: layout quirks, easy-to-misread spots
```

## How to run

```bash
pnpm ocr <image>                                       # recognize one image, print what the engine sees
pnpm ocr --sample <slug> --trace                       # …replay a committed fixture instead
pnpm eval:ocr                                          # run all samples (repo root)
pnpm test:ocr:golden                                   # hard-assert the human-verified samples
pnpm --filter @whole/ocr-eval run eval -- --sample <slug>   # run one sample (within package)
pnpm eval:ocr:baseline                                 # rewrite baseline.json from the current results
pnpm eval:ocr:vision                                   # macOS: screenshot.png → blocks.json (see below)
#   … [--overwrite [--force]]   regenerate an existing fixture; --force is
#                               needed for a device capture
#   … [--check]                 parser-level drift vs the committed fixtures
```

Four commands, one per job: recognize something ad hoc (`ocr`), record a fixture
(`eval:ocr:vision`), check for regressions (`eval:ocr`), hard-assert the verified
golds (`test:ocr:golden`). Anything a coding agent can do by reading `--trace`
output and the rule sources is deliberately not a script here.

Output: `✓/~/✗ sample name`, per-field reasons for anything not clean (`· name:
expected …, got …`), a per-field aggregate table, and the baseline verdict.

## Recognize one screenshot or sample (`pnpm ocr`)

The shortest loop between "here is a screenshot" and "here is what the rules
make of it" — no device, no dev build, no gold:

```bash
pnpm ocr ~/Desktop/some-bank.png
pnpm ocr --sample ocbc-overview  # replay a committed fixture instead
pnpm ocr <image> --json     # the RecognizedAccount[] the app would receive
pnpm ocr <image> --trace    # per-line roles and the detected institution
pnpm ocr <image> --blocks   # the raw OCR blocks, before any rules ran
```

```text
screenshot.png — 52 OCR blocks
──────────────────────────────────────────────

3 account(s) recognized:

1. 360 Account
   kind        cash
   institution ocbc
   SGD          6,672.59
…
```

Use it to eyeball a new institution's layout before deciding whether it deserves
a regression sample, and to iterate on a rule: change the rule, re-run this on
the screenshot that motivated it, see the difference immediately. `--trace` is
where you look when the answer is wrong and you need to know which rule decided
it.

`--sample <slug>` is the mode to reach for when `pnpm eval:ocr` reports a
failure: it replays the exact fixture the harness gates on, so what you inspect
is what failed — re-recognizing the screenshot instead would run it through a
Vision version that may read it differently. It also needs no Swift bridge, so
it is the only mode that works off macOS. Image mode is macOS-only: it drives
Apple Vision through the bridge.

## The two kinds of assertion

A gold is a claim about what the screenshot says, and an unchecked one would pin
the engine to a guess. So the harness separates the two claims it can make about
a sample:

|          | `pnpm eval:ocr`              | `pnpm test:ocr:golden`          |
| -------- | ---------------------------- | ------------------------------- |
| covers   | every sample                 | samples whose gold was verified |
| asserts  | "no worse than the baseline" | "exactly this output"           |
| fails on | a regression                 | any deviation                   |

All 17 samples currently qualify: each gold was checked field by field against
its screenshot, and two were corrected in the process — both mis-readings of an
account number's tail by the LLM annotator this harness used to ship
(`hsbc-hk-one` 0833 → 1833, `hsbc-sg-overview` 8221 → 2221). Two wrong out of
seventeen, on the field a person verifies fastest, is why the annotator is gone
and why by-eye verification is the only entry criterion.

Promote a new sample into `VERIFIED_SAMPLES` (`src/verified-samples.ts`) once you
have checked its gold against the screenshot by eye. That is the only entry
criterion.

## The baseline gate (how the exit code is decided)

The parser is still growing its institution coverage, so "every sample must
pass" would be red before and after every change — a gate that catches nothing.
The gate is `baseline.json` instead: it records the **currently known**
failures, field by field, and the run fails only on a failure that is _not_
listed there.

- `✓ sample` — fully matches gold.
- `~ sample` — fails exactly the way the baseline expects. Reported, not fatal.
- `✗ sample` — **regression**: a field that isn't baselined now fails. Exits 2.
- `resolved` — a baselined failure now passes. Not fatal, but run
  `pnpm eval:ocr:baseline` to lock the win in so it can't silently regress
  later.

Running a single sample (`--sample <slug>`) is an interactive probe and always
exits zero.

Every known gap carries a reason, so the summary says what to work on next
rather than just how red things are:

| reason                    | meaning                                                                              | the fix                    |
| ------------------------- | ------------------------------------------------------------------------------------ | -------------------------- |
| `unsupported-institution` | the sample's institution has no detection signals yet (not in `DETECT_INSTITUTIONS`) | add an `InstitutionConfig` |
| `parser-bug`              | the institution IS detected, so a rule genuinely gets this wrong                     | fix the rule engine        |
| `gold-uncertain`          | the gold itself is suspect (written, not yet checked against the screenshot)         | verify the gold            |

`unsupported-institution` and `parser-bug` are inferred automatically from
whether the gold's `institutionId` is wired into detection.
`gold-uncertain` is never inferred — set it by hand in `baseline.json` to park a
sample until its gold is verified, and `--update-baseline` preserves it.

Adding samples raises the known-gap count without turning the gate red, which is
the point: a new sample is a new measurement, not a new failure. Baseline it,
then work the gaps down.

## Adding a sample from a screenshot on macOS

The fastest way to grow the sample set: drop `screenshot.png` into
`samples/<slug>/` and generate the fixture locally — no device, no dev build.

```bash
mkdir -p packages/ocr-eval/samples/<slug>
cp ~/Desktop/whatever.png packages/ocr-eval/samples/<slug>/screenshot.png
pnpm eval:ocr:vision       # generates blocks.json for any sample missing one
#                          # then write expected.json by reading the screenshot
pnpm eval:ocr:baseline     # record where the parser stands on it
```

Writing `expected.json` is a by-eye job: read the screenshot, write down what it
says. `pnpm ocr --sample <slug>` prints what the engine currently makes of the
fixture, which is a useful starting point to correct — but only ever a starting
point. A gold that agrees with the parser by construction asserts nothing, which
is why the gold is authored from the screenshot and the parser output is used
only to see where the two disagree.

`vision/recognize-text.swift` runs Apple Vision with the same request config the
iOS app uses (`.accurate`, language correction on, `["zh-Hans", "en-US"]`,
word-level boxes, top-left origin). That's the same framework — the app's iOS
build sets `EXPO_MLKIT_OCR_DISABLE_MLKIT=1` and runs Vision, not ML Kit.

**Same framework is not the same output.** macOS and iOS ship different Vision
model versions. Measured over the 17 device-captured samples:

- **0/17** produce byte-identical blocks — token splits and readings differ.
- **16/17** still parse to identical accounts.

So a macOS-generated fixture is a real Apple Vision recording, good enough to
cover a new institution's layout quickly, but it is **not** the same thing as
the device captures already committed (see below — capturing new ones in the
app is no longer possible). Generated fixtures carry `"source": "macos-vision"`
to keep the distinction visible, and that stamp is enforced rather than
decorative:
`--overwrite` regenerates macOS-generated fixtures but skips device captures
(pass `--force` to replace one anyway), and `--check` skips a sample whose
committed fixture is macOS-generated, since comparing macOS output against
macOS output proves nothing.

```bash
pnpm eval:ocr:vision -- --check   # re-recognize every screenshot, compare PARSER OUTPUT
```

`--check` compares recognized accounts rather than raw blocks, because block
drift is expected and account drift is not. It's informational (never fails the
build): a sample that parses differently across two Vision versions means the
rule engine is leaning on OCR detail that isn't stable, which is worth hardening
regardless of which fixture is "right".

## Device-captured fixtures (historical)

Committed fixtures with no `source` field were recorded on device, through a
dev-only capture screen inside the app. That screen is gone — the macOS Vision
bridge above covers the same pipeline off device, so the app no longer ships a
recognition tool with no product use.

Those fixtures stay committed and stay authoritative: they are the only
recording of what iOS Vision actually produces, which is exactly why `--check`
skips macOS-generated samples and `--overwrite` refuses to replace a device
capture without `--force`. New samples are added the macOS way.

> Whatever writes a fixture cannot drift from what the harness replays:
> `blocksFixtureSchema` / `blocksFromFixture` in `@whole/ocr`'s
> `contract/fixture.ts` define the one normalized `{ blocks: [{ text, box }] }`
> shape, and every fixture is validated against it at load.

## What this harness deliberately does not do

It used to ship an LLM annotator (`expected.json` from the screenshot), an LLM
"teacher" (trace → rule-fix report), a trace dumper feeding it, an
institution-detection printer, and an importer for a folder of fixtures exported
from the app. All are gone, and the reasons are worth keeping:

- **The importer's input no longer exists.** It read the bulk-export format of a
  dev-only capture screen inside the app; that screen was removed, and the macOS
  Vision bridge replaced it. A tool whose producer is gone is not a tool.
- **The LLM tooling was a worse version of the coding agent already in the
  loop.** The teacher could only advise — it wrote a markdown report that a
  human then had to act on — while an agent reads `pnpm ocr --sample <slug>
--trace`, reads the rule sources, edits them, and re-runs `pnpm eval:ocr` to
  check itself. The annotator's golds needed full by-eye review anyway (it got
  two of seventeen last-fours wrong), so it saved typing, not judgement.
- **`detect` and `dump` were subsets of other commands.** The detected
  institution is a field `eval:ocr` already compares and `pnpm ocr --trace`
  already prints; the trace dump existed to feed the teacher.

Deleting them removed the package's entire network dependency: no
`OPENAI_BASE_URL` / `OPENAI_API_KEY` / `OPENAI_MODEL`, no request to any
endpoint, and no path by which a screenshot could leave the machine.

## Sample specifications

- **One slug = one account screenshot**. Multi-currency accounts and
  brokerage/crypto rows all live in one slug, since they are one account
  covered by a single recognition.
- Slug naming: `<institution>-<account>` or `<institution>-<desc>`, lowercase,
  dash-separated. For example: `dbs-multiplier`, `ocbc-360`, `uob-one`,
  `crypto-binance`, `crypto-okx`.
- Each sample directory:
  ```
  samples/<slug>/
    blocks.json       # Normalized OCR blocks (committed fixture)
    expected.json     # Human-checked gold RecognizedAccount[] (committed)
    screenshot.png    # Real screenshot (local only, gitignored, not committed)
    notes.md          # Optional: layout quirks, misread spots, multi-currency order notes
  ```
- Self-check before committing: confirm `git status` shows **no** tracked
  `screenshot.*` — real screenshots contain sensitive info and should stay
  local only.
- Every parser rule change += each real regression sample; the pass rate only
  goes up, never down.

### expected.json format

`expected.json` is hand-written and directly editable; which fields you keep in
`RecognizedAccount[]` is "which fields this account is required to recognize":

```json
[
  {
    "accountName": "DBS Multiplier",
    "accountLastFourDigits": "0423",
    "balances": [
      { "currency": "SGD", "balance": 1234.56 },
      { "currency": "USD", "balance": 789.1 }
    ],
    "kind": "cash",
    "institutionId": "dbs"
  }
]
```

- Fields are optional: not writing `accountLastFourDigits` in the gold means
  the field is "not required" of the parser.
- `kind` defaults to `cash`. Empty `balances` means balances are not required.
- `institutionId` is the institution the screenshot belongs to — any value in
  `institutionIdSchema` (`@whole/ocr`'s `contract/institution.ts`). It is
  per-screenshot, so every account in a sample carries the same value. Omit it
  to skip institution-detection regression for that sample.
  - Naming an institution that isn't in `DETECT_INSTITUTIONS` yet is
    intentional: detection returns `"unknown"`, the sample lands in the baseline
    as `unsupported-institution`, and the gap is tracked instead of forgotten.

## Comparison rules (see src/compare.ts)

- `accountName`: equal after whitespace/case normalization.
- `accountLastFourDigits`: exact 4-digit match.
- `balances`: multiset by currency, amount tolerance < 0.01.
- `kind`: exact.
- `institutionId`: exact (any `institutionIdSchema` value, `"unknown"`
  included).
- Gold requires but parser missing = "miss" (counts as failure); write it fully
  when making sure. Whether such a failure is fatal is decided by the baseline,
  not by `compare.ts`.

## Coordinate convention (important)

`blocks.json` stores **0..1 normalized, top-left origin** boxes, matching
`normalizeOcrResult`'s output (`/ocr`'s `contract/block.ts`). If your device captures
pixel-space boxes, remember to divide by the image width/height, or call
`normalizeOcrResult(result, width, height)` when capturing.
