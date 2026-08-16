# Exercising OCR account recognition on the simulator

Recognition is the app's core flow and the one that is genuinely hard to verify
from code: the parser's output only becomes real once a screenshot has gone
through the on-device OCR and landed in the form. The whole loop is drivable,
and every field it produces is readable from the accessibility snapshot, so a
parser change can be checked end to end without touching the simulator by hand.

## Load screenshots into the photo library

agent-device has no photo-library command; this is `simctl`:

```bash
xcrun simctl addmedia booted packages/ocr-eval/samples/ocbc-overview/screenshot.png
```

Multiple paths in one call work too. The `samples/*/screenshot.*` files are real
account screenshots — gitignored, private, and local-only. Keep them that way:
don't copy them elsewhere, and don't paste their contents into output.

The picker sorts by the photo's own timestamp, not by import order, so a
freshly added file does **not** reliably appear first — `addmedia` preserves the
source file's creation date. The date label in the snapshot
(`截屏, Screenshot, 8月12日, 下午2:31`) narrows it down, but repeated runs import
byte-identical copies that share a label, so it isn't decisive on its own. When
the library already holds old samples, ask the simulator which asset arrived
last:

```bash
sqlite3 ~/Library/Developer/CoreSimulator/Devices/<UDID>/data/Media/PhotoData/Photos.sqlite \
  "select ZFILENAME, ZADDEDDATE from ZASSET order by ZADDEDDATE desc limit 5;"
```

then `md5 -q` that `IMG_*.PNG` against the sample to confirm. Thumbnails below
the fold reject `press` outright (`off-screen and not safe to press`) for refs
and selectors alike — `scroll down`, re-`snapshot -i`, then press the fresh ref.

Confirming the md5 is not pedantry. The library holds several near-identical
bank overviews, and the grid's first cell is often a _different_ OCBC screenshot
(the `ocbc-partial-overview` one, balance 6,674.51). Tapping it silently yields a
plausible-looking recognition for the wrong fixture — the failure mode here is a
confident wrong answer, not an error.

## Drive the flow

```bash
.claude/skills/simulator/ad open Whole whole://accounts/new
.claude/skills/simulator/ad press 'label="上传账户截图"' --settle
.claude/skills/simulator/ad snapshot -i          # required — see below
.claude/skills/simulator/ad press @e16 --settle  # the photo cell you want
```

**The picker is invisible to `--settle`.** Opening it reports `+0 -0` and every
element unchanged, which reads exactly like a dead button. It isn't — the system
picker is out-of-process, and a fresh `snapshot -i` shows it in full (`取消`,
`照片`, `精选集`, then one `[image]` ref per photo). Run that explicit snapshot
instead of concluding the tap failed.

There is no photo-permission prompt to handle; PHPicker runs out-of-process and
doesn't need one.

## Read the result from the snapshot

After the tap, OCR runs on device (~2s) and fills the form. The outcome is
plain text in the tree:

```
@e10 [text]       "已识别，请核对"
@e13 [text]       "已识别 2 个账户"
@e14 [text]       "第 1/2 个"
@e17 [text-field] "OCBC"          # institution
@e19 [text-field] "360 Account"   # account name
```

That is what makes this worth driving: assert the recognized institution,
account name, last four, and balance directly against those field values.
Multi-account screenshots expose a `第 N/M 个` pager, so step through it to check
every account the recognizer found, not just the first.

**Currency is the exception — it is not in the tree.** The 币种 control's
accessibility label is the literal string `币种`, and `snapshot -s` returns no
value, so `SGD` / `CNY` can only be read from a screenshot. Don't burn retries
looking for it in the snapshot; capture the form and read it visually.

Recognized fields stay editable by design — recognition is never guaranteed
correct, so the form must accept manual correction. A field that reads back as
`[editable]` is the intended state, not a bug.

## Where this fits against the eval harness

`pnpm eval:ocr` gates the parser against gold `expected.json` fixtures and is
the faster, broader signal — run it first, and keep it as the regression gate.
The simulator run answers the question the harness cannot: whether the recognized
values actually reach the form the user sees, including the fields the form
currently drops on purpose. Recording a new fixture is no longer a simulator
task at all — the app's dev-only capture screen was removed, and
`pnpm eval:ocr:vision` records fixtures on the Mac from a `screenshot.png`.
