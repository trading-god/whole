# OCR Eval / Regression Suite (validation set)

[English](./README.md) | [简体中文](./README.zh-Hans.md)

This is not a "training set" — iOS Apple Vision and Android ML Kit are
**pretrained models** that cannot be fine-tuned on-device. The purpose of this
directory is to drive and verify the correctness of the pure TypeScript
semantic parser in `src/features/assets/ocr-parser.ts`: **the rule engine is
the only thing being iterated on**, and the eval suite is its regression gate.

The parser's target scope is **multi-currency account overviews, single-account
rows** for the user's common banks, and one row each for brokerages and crypto.
Anything else falls through to the existing "unrecognized → manual entry" path.

## Directory structure

```
packages/ocr-eval/
  src/
    run-eval.ts          # Orchestrator: runs all samples, per-sample/per-field output
    annotate.ts          # LLM annotator: model generates expected.json from blocks.json (+ screenshot)
    compare.ts           # Field-level gold comparison (accountName / lastFour / balances / kind)
    render.ts            # ASCII table output
    paths.ts             # Package root / samples path resolution (based on import.meta)
  samples/<slug>/
    blocks.json          # Real on-device OCR output (normalized 0..1 boxes) — committed regression fixture
    expected.json        # Manually annotated gold RecognizedAccount[]
    screenshot.png       # Real bank screenshot — private, gitignored, not committed
    notes.md             # Optional: layout quirks, easy-to-misread spots
```

## How to run

```bash
pnpm eval:ocr                                          # run all samples (repo root)
pnpm --filter @whole/ocr-eval run eval -- --sample <slug>   # run one sample (within package)
pnpm eval:ocr:label -- --sample <slug>                 # LLM generate/overwrite expected.json (see below)
```

When running all samples, the process exits non-zero if any sample fails
(suitable for CI); running a single sample always exits zero. Output: `✓/✗
sample name`, per-field reasons for failing samples (`· name: expected …, got
…`), and a per-field aggregate table with the overall pass rate at the end.

## Adding a sample from the app's capture screen (recommended)

The screenshot upload/edit flow has a **dev-only entry point** (labeled "OCR
capture", visible only in `__DEV__` builds). Tap into it to reach the capture
screen: pick an account screenshot, run the real on-device OCR pipeline
(recognition → normalization → semantic parse), then copy two fixtures with one
tap. This way adding a regression sample no longer requires manually logging
the OCR output:

1. Start a dev build (e.g. `pnpm exec expo start --dev-client`), open the
   "Add account" or "Edit account" screen, and tap the "OCR capture" entry.
2. Pick a screenshot of a bank account you use. The capture screen shows the
   recognized account (name / last four / per-currency balances / kind) and the
   number of OCR text blocks.
3. Tap "Copy blocks.json", then in the repo create `samples/<slug>/blocks.json`
   and paste.
4. Tap "Copy expected.json", compare it against the screenshot, keep the
   account fields you want, delete the ones you don't (don't require them),
   and save it as `samples/<slug>/expected.json`.
5. Put a copy of the screenshot in `samples/<slug>/screenshot.png` (local
   debugging only — gitignored, won't be committed).
6. Run `pnpm --filter @whole/ocr-eval run eval -- --sample <slug>` to confirm
   it passes.

> The capture screen output matches `src/run-eval.ts`'s `blocksFixtureSchema`
> exactly: the `blocks.json` it exports is the same normalized
> `{ blocks: [{ text, box }] }` shape the harness replays (see
> `blocksJsonFromNormalized` in `src/features/assets/ocr-fixture.ts`).

## LLM annotation (optional)

When you no longer want to hand-write `expected.json` one by one, a model can
directly "read" blocks.json (+ the screenshot) to generate the gold; a human
only needs to review and revise.

```bash
# Needs an OpenAI-compatible endpoint; configure it either way (real env wins over .env):
#
# A) Repo-root .env (recommended — write once, works long-term locally; .env is gitignored):
#    OPENAI_BASE_URL=https://api.openai.com/v1
#    OPENAI_API_KEY=sk-xxx
#    OPENAI_MODEL=gpt-4o
#    Then run:
pnpm eval:ocr:label -- --sample <slug>
#
# B) Temporary environment variables:
#    OPENAI_API_KEY=xxx OPENAI_BASE_URL=https://api.openai.com/v1 \
#    OPENAI_MODEL=gpt-4o pnpm eval:ocr:label -- --sample <slug>
#
# Without --sample, annotates every sample with a blocks.json under samples/.
# Multimodal by default: sends samples/<slug>/screenshot.png (when present) as
# base64 to the model.
```

- Output: **overwrites** `samples/<slug>/expected.json` with a model-annotated,
  zod-validated `RecognizedAccount[]`; any previous content is first backed up
  to `expected.json.bak`.
- If the model "lazies out" and returns an empty array, it is preserved as-is
  (review or delete manually).
- `OPENAI_MODEL` defaults to `gpt-4o`; any OpenAI-compatible endpoint
  (DeepSeek/Ollama/internal gateway) works.
- **Privacy**: multimodal sends the screenshot to the configured cloud
  endpoint; screenshots are sensitive data, so only use a trusted endpoint.

## Sample specifications

- **One slug = one account screenshot**. Multi-currency accounts and
  brokerage/crypto rows all live in one slug, since they are one account
  covered by a single recognition.
- Slug naming: `<bank>-<account>` or `<bank>-<desc>`, lowercase, dash-separated.
  For example: `dbs-multiplier`, `ocbc-360`, `uob-one`, `crypto-binance`,
  `crypto-okx`.
- Each sample directory:
  ```
  samples/<slug>/
    blocks.json       # Captured from the capture screen: normalized OCR blocks (committed fixture)
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

The `expected.json` template copied from the capture screen is directly
editable; which fields you keep in `RecognizedAccount[]` is "which fields this
account is required to recognize":

```json
[
  {
    "accountName": "DBS Multiplier",
    "accountLastFourDigits": "0423",
    "balances": [
      { "currency": "SGD", "balance": 1234.56 },
      { "currency": "USD", "balance": 789.1 }
    ],
    "kind": "cash"
  }
]
```

- Fields are optional: not writing `accountLastFourDigits` in the gold means
  the field is "not required" of the parser.
- `kind` defaults to `cash`. Empty `balances` means balances are not required.
- Every parser rule change += each real regression sample; the pass rate only
  goes up, never down.

## Comparison rules (see src/compare.ts)

- `accountName`: equal after whitespace/case normalization.
- `accountLastFourDigits`: exact 4-digit match.
- `balances`: multiset by currency, amount tolerance < 0.01.
- `kind`: exact.
- Gold requires but parser missing = "miss" (counts as failure); write it fully
  when making sure.

## Coordinate convention (important)

`blocks.json` stores **0..1 normalized, top-left origin** boxes, matching
`normalizeOcrResult`'s output (`ocr-types.ts`). If your device captures
pixel-space boxes, remember to divide by the image width/height, or call
`normalizeOcrResult(result, width, height)` when capturing.
