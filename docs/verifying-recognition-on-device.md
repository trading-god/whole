# Verifying account recognition on a simulator or emulator

Recognition is the app's core flow and the one that is genuinely hard to verify
from code: the parser's output only becomes real once a screenshot has gone
through OCR, through the model annotation turn, and into the form. The whole
loop is drivable with [`agent-device`](https://docs.expo.dev/agents/agent-device/),
and every field it produces is readable from the accessibility snapshot, so a
parser change can be checked end to end without driving the simulator by hand.

## Before you start

Five preconditions, all of which fail in ways that read like a bug in your diff:

- **`agent-device` on PATH.** The one tool here installed globally rather than
  as a project dependency, so installing it is the developer's call, not the
  agent's — the vendored skills are explicit that an agent which finds it
  missing should stop and ask. Run it yourself, once. The explicit registry is
  the portable spelling: `.npmrc`'s public registry applies only to commands
  run from inside the repo, and a user-level registry may be an internal
  mirror that is unreachable off its network.

  ```bash
  npm install -g agent-device --registry=https://registry.npmjs.org
  ```

- **Every agent-device command from the repo root.** It keys its session by
  the working directory, so a command issued from `packages/ocr-eval/` after an
  `open` from the root dies with `SESSION_NOT_FOUND` — which reads like a dead
  device and is not. The sample paths below are repo-relative for the same
  reason.

- **Metro up and a current dev build installed.** Whole is a dev build:
  `pnpm start`, then `curl -fsS http://127.0.0.1:8081/status`. The native
  build (`pnpm ios` / `pnpm android`, minutes each) is only needed when the
  installed app is older than the source — that red-screens on a missing
  native module, so suspect it before your diff rather than rebuilding every
  run. After any `node_modules` change restart Metro with `pnpm start --clear`:
  stale Metro state makes Android die with `TypeError: property is not
writable` while iOS keeps working.

- **The chosen recognition engine is ready.** This is the one most likely to
  waste a full run. `recognizeAccountFromScreenshot` resolves the engine
  **before** the OCR pass and throws `EngineNotReadyError` when it is not set
  up (`src/features/recognition/screenshot-recognition.ts`), so picking a photo
  on a fresh device lands on "set the engine up first" with a link to Settings,
  not on a filled form. The default engine is on-device and the default model is
  Gemma 4 E2B, whose weights are a ~3.1 GB on-demand download (E4B is ~5.0 GB);
  the remote engine needs a base URL, model, and API key. Deep-link to
  `whole://settings` and confirm the engine section first.

- **Asset privacy mode off**, before you follow a recognized balance past the
  form. The eye toggle runs every figure on the home screen and its account
  rows through `maskAssetAmount`, which keeps the currency symbol and the sign
  and replaces only the digits (`-S$1,234.56` → `-S$****`). Nothing in the
  snapshot or the screenshot announces the masking, so a masked balance reads
  as a formatting regression — or, worse, still "reads as money" and passes an
  assertion that checked the sign but never saw a digit.

## The devices

iOS is a booted simulator. Android is wired by hand — agent-device starts
nothing, and the only AVD here is `whole-test`:

```bash
"$ANDROID_HOME/emulator/emulator" -avd whole-test &
adb wait-for-device shell 'while [ "$(getprop sys.boot_completed)" != "1" ]; do sleep 2; done'
adb reverse tcp:8081 tcp:8081
adb shell am start -a android.intent.action.VIEW \
  -d "whole://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081" com.whole.app
```

Without that deep link the dev client parks on the dev-launcher menu. The AVD
is sized to match the iOS simulator's iPhone 17 Pro (12 GB RAM, 256 GB userdata,
1206×2622 @ 460 dpi) so it can run Gemma — the settings Test button passes on
it. The 12 GB `hw.ramSize` is load-bearing: at a default 2 GB the model load
breaches the lowmemorykiller watermark and the app process is killed mid-
`initLlama`, with no verdict rendered and no error to read.

Deep links beat tapping through screens: `whole://` (home),
`whole://onboarding`, `whole://accounts/new`, `whole://accounts/<id>`,
`whole://settings`. A first launch lands on onboarding — that is the `_layout`
gate working, not a routing bug.

With sessions live on both platforms, pass `--platform` and `--session`
(`ios` / `android`) on every command. `DEVICE_IN_USE` on `open` means another
session already holds that device: reuse it by name with `--session <name>`
rather than closing it, since it may not be yours. Run `agent-device close` for
every session you opened when you are done, and leave Metro running.

## Load screenshots into the photo library

agent-device has no photo-library command; on iOS this is `simctl` (Android is
`adb push` — see the end of this section).

The `samples/*/screenshot.*` files are real account screenshots — gitignored,
private, and local-only, so a fresh clone has none. Supply your own and drop
them into `packages/ocr-eval/samples/<slug>/screenshot.png`
(`packages/ocr-eval/README.md` covers recording a fixture from one). Keep them
private: don't copy them elsewhere, and don't paste their contents into output.

Pin the target with an explicit UDID rather than `booted`: with more than one
simulator booted, `simctl` picks one of them without erroring, and the
screenshot silently lands on the device you are not driving. List them and
choose:

```bash
xcrun simctl list devices booted   # copy the UDID of the one you are driving
```

The picker sorts by the photo's own creation date, not by import order, and
`addmedia` preserves the source file's — so a freshly added sample does **not**
reliably appear first. Import a copy with a fresh timestamp instead of hunting
for the original:

```bash
UDID=...                                     # the one you just copied
SAMPLE=packages/ocr-eval/samples/ocbc-overview/screenshot.png
cp "$SAMPLE" "$TMPDIR/whole-fixture.png"     # new birthtime → sorts first
xcrun simctl addmedia "$UDID" "$TMPDIR/whole-fixture.png"
```

Then confirm which fixture you actually tapped, because the library holds
several near-identical account overviews and the grid's first cell is often a
_different_ OCBC screenshot (the `ocbc-partial-overview` one, balance
6,674.51). Tapping it silently yields a plausible-looking recognition for the
wrong fixture — the failure mode here is a confident wrong answer, not an
error. Confirm it from the recognized result rather than from the library:
`已识别 3 个账户` is `ocbc-overview`, `已识别 2 个账户` is
`ocbc-partial-overview` (see "Read the result"). That check costs nothing, is
the same on both platforms, and answers the question that actually matters —
which fixture reached the parser.

On Android the import is a push plus a media scan. Every sample is named
`screenshot.png`, so push to a per-sample destination or the second import
overwrites the first at the same path:

```bash
adb push packages/ocr-eval/samples/ocbc-overview/screenshot.png \
  /sdcard/Pictures/ocbc-overview.png
adb shell content call --uri content://media --method scan_file \
  --arg /sdcard/Pictures/ocbc-overview.png
```

`MEDIA_SCANNER_SCAN_FILE` is the recipe you will find elsewhere; it was
deprecated at API 29 and MediaProvider no longer handles it, so on the
`whole-test` AVD (android-36) it completes with `result=0` and scans nothing —
the file lands but never enters MediaStore, and the picker shows nothing new.
`adb shell cmd media rescan` is the blunter alternative.

The import above was worked out on iOS; the Android picker has not been walked
end to end the same way, so read its snapshot before trusting it.

## Drive the flow

```bash
agent-device open Whole whole://accounts/new --platform ios --session ios --foreground
agent-device press 'label="上传账户截图"' --session ios --settle
agent-device snapshot -i --session ios          # required — see below
agent-device press @e16 --session ios --settle  # the photo cell you want
```

**The picker is invisible to `--settle`.** Opening it reports `+0 -0` and every
element unchanged, which reads exactly like a dead button. It isn't — the system
picker is out-of-process, and a fresh `snapshot -i` shows it in full (`取消`,
`照片`, `精选集`, then one `[image]` ref per photo). This is the deliberate
exception to agent-device's "snapshot only when the diff lacks the next target"
default.

Thumbnails below the fold reject `press` outright (`off-screen and not safe to
press`) for refs and selectors alike — reach one with `scroll down --until`.
The `@eNN` refs are per-snapshot and shift as the tree changes, so copy them
from the snapshot you just took, never from this page.

There is no photo-permission prompt to handle; PHPicker runs out-of-process and
doesn't need one.

## Read the result from the snapshot

After the tap, the OCR pass runs and then the annotation turn — the local
llama.cpp context over the Gemma weights, or an HTTP call to the configured
endpoint. The local path dominates the wait: loading the context is seconds of
CPU on a simulator, so expect tens of seconds before the form fills, not the
couple of seconds the OCR pass alone takes — an empty form two seconds in is
not a failure.

The outcome is plain text in the tree:

```
@e10 [text]       "已识别，请核对"
@e13 [text]       "已识别 3 个账户"
@e14 [text]       "第 1/3 个"
@e17 [text-field] "OCBC"          # institution
@e19 [text-field] "360 Account"   # account name
```

(Those counts are `ocbc-overview`, which holds three accounts — 360 Account,
Global Savings Account, Statement Savings Account. `已识别 2 个账户` means you
tapped `ocbc-partial-overview` instead.)

That is what makes this worth driving: assert the recognized institution,
account name, last four, balance, and currency directly against those field
values. Multi-account screenshots expose a `第 N/M 个` pager, so step through it
to check every account the recognizer found, not just the first.

Diff those against the recognizer's output, not against `expected.json`: the
draft layer filters before the form renders. `mergeRecognizedIntoDraft` in
`src/features/accounts/account-draft.ts` drops a zero balance that sits beside
a non-zero one, so `ocbc-overview`'s Global Savings Account — gold CNY 10,716.02
plus USD 0.00 — shows one row here, not two. That is the rule working; removing
it puts a row back for every empty sub-account on a DBS Multiplier. Use
`pnpm ocr --sample <slug>` to see what the recognizer actually produced before
calling a missing row a regression.

Currency reads out of the tree like the rest: the control's accessibility
_label_ is the literal string `币种`, but `OptionPicker` also sets an
accessibility _value_ carrying the selected option's label, and a currency's
label is its own ISO code — so `snapshot -s` returns `SGD` / `CNY` on that
element. Assert it there rather than reading it off a screenshot.

Recognized fields stay editable by design — recognition is never guaranteed
correct, so the form must accept manual correction. A field that reads back as
`[editable]` is the intended state, not a bug.

While you are in the tree, assert the copy too: `en` and `zh-Hans` ship in
lockstep, so a missing key surfaces as a raw dotted key or an English string
sitting in an otherwise Chinese snapshot.

## Traps that look like your diff

Each of these cost a debugging session already. None is a bug in the app:

- **iOS: a deep link into a backgrounded app raises 「在“Whole”中打开？」.**
  Press `打开` and carry on.
- **Android: the launcher's grey gear bubble covers the home screen's add
  button.** It is the emulator's overlay, not a layout regression — press
  around it or relaunch through a deep link.
- **Android: `scroll up` at the top of a page pulls down the quick-settings
  shade.** The app is fine and unreachable behind it; recover with a deep
  link rather than more scrolling.
- **A `Can't perform a React state update…` warning right after a reload** is
  reload residue, not a leak your change introduced. It should not survive a
  clean launch — if it does, then look.
- **`emulator -wipe-data` also removes agent-device's snapshot-helper APK.**
  Re-run any session-opening command and it reinstalls itself; the first
  post-wipe launch also opens the dev menu once, so press Continue.

## Where this fits against the eval harness

`pnpm eval:ocr` is the faster, broader signal — run it first and keep it as the
regression gate. It asserts "no worse than the baseline"; `pnpm test:ocr:golden`
is the one that asserts gold exactly. `packages/ocr-eval/README.md` owns the
full picture, including recording a new fixture with `pnpm eval:ocr:vision`.

This run answers the question the harness cannot: whether the recognized values
actually reach the form the user sees, including the fields the form currently
drops on purpose.
