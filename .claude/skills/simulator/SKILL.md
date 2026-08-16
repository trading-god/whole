---
name: simulator
description: Run Whole on the iOS Simulator and verify a change actually works — drive the real app with agent-device (accessibility snapshot, tap, type, deep links, screenshots) instead of guessing from the code. Use this whenever you have touched anything under src/app, src/components, src/features, or src/i18n and want to confirm it renders and behaves correctly; whenever the user says 跑起来看看 / 截图 / 验证一下 / 试一下 / 模拟器 / simulator / screenshot / "does this actually work"; and whenever a task is only really done once the real UI has been seen. Also covers loading OCR sample screenshots into the simulator photo library to exercise the account-recognition flow.
---

# Verifying Whole on the iOS Simulator

Reading the diff tells you the code changed. Only the running app tells you the
change worked. Drive it with
[`agent-device`](https://docs.expo.dev/agents/agent-device/), the agent-native
CLI Expo documents for operating a running Expo app.

Start acting immediately — `open` returns the first snapshot, so probing with
`devices`, `appstate`, or `screenshot` first only burns turns:

```bash
.claude/skills/simulator/ad open Whole --foreground
```

**The CLI's own help is the reference, and it matches the installed version, so
read it instead of guessing.** `ad help workflow` covers the loop, refs,
selectors, waits, and recovery; `ad help react-native` covers Metro and RN
hazards; `ad help debugging` covers logs, traces, and video. This file
deliberately does not restate any of that — everything below is true of _this
repo_ and cannot be learned from `ad help`.

## Use the `ad` wrapper, not bare `agent-device`

`.claude/skills/simulator/ad` passes every argument through untouched, and
absorbs two failures that otherwise cost real debugging time here:

- agent-device keys its session by working directory. A command run from
  anywhere but the repo root fails with `SESSION_NOT_FOUND`, which reads like a
  device fault but is only a lost session. The wrapper pins the cwd.
- This machine's default npm registry is an internal mirror that is unreachable
  outside the corporate network, so the `npm install -g agent-device` the
  official docs recommend, and a bare `npx`, both fail. The wrapper points
  `pnpm dlx` at the public registry. Nothing needs installing; a warm call costs
  about 0.3s.

A third session failure the wrapper can't absorb: `DEVICE_IN_USE` on `open`
means another session already holds the simulator, usually one left behind by an
earlier run. Follow the error's hint and reuse it with `--session <name>` rather
than closing it — on a shared simulator that session may belong to someone else.

## Metro must be running first

Whole runs as a dev build, so agent-device cannot reach the app without Metro,
and the failure won't say so plainly. Start it in the background and wait for
readiness rather than sleeping blindly:

```bash
pnpm start                                    # background it
curl -fsS http://127.0.0.1:8081/status        # "packager-status:running"
```

The app also has to be installed: `ad apps --platform ios` should list
`Whole (com.whole.app)`. If it isn't, `pnpm ios` builds and installs it — minutes
on a cold build, so tell the user before paying that cost. `ad doctor` checks
both at once when something feels off.

This is also the strongest reason not to hand-roll `simctl`: the installed app
is a dev client with no bundled `main.jsbundle`, so `simctl launch` parks on the
dev-launcher menu instead of the app, and getting past it means terminating and
re-entering through `whole://expo-development-client/?url=…`. `ad open` does all
of that for you. If you ever see a launcher menu where the app should be, that's
what happened.

After a JS/TS edit, reload rather than relaunch: `ad metro` reloads the dev
server. Screenshotting before the reload lands is a quiet way to "verify" the old
bundle. Reserve `ad open Whole --relaunch` for native changes or when you want
clean app state.

## Deep links beat tapping through screens

Routes come from `src/app/`:

| Route                      | Deep link               |
| -------------------------- | ----------------------- |
| Home                       | `whole://`              |
| Onboarding                 | `whole://onboarding`    |
| Add account                | `whole://accounts/new`  |
| Account detail             | `whole://accounts/<id>` |
| Dev tools (`__DEV__` only) | `whole://dev`           |

```bash
.claude/skills/simulator/ad open Whole whole://accounts/new
```

If the app isn't already foregrounded, iOS answers with a system confirmation
sheet — `在“Whole”中打开？`. That is normal, not a failure: snapshot and press
`打开` to continue. It doesn't appear when the app is already in front, so read
the snapshot rather than assuming either way.

**First launch lands on onboarding.** `src/app/_layout.tsx` gates un-onboarded
users into `/onboarding` and bounces onboarded users out of it. A fresh install
parking you there is that gate working, not a routing bug.

## The snapshot catches i18n regressions a screenshot won't

`snapshot -i` returns the accessibility tree carrying the same strings the user
reads:

```
@e9  [button]     "添加账户"
@e15 [text-field] "账户名称"
```

Whole ships `en` and `zh-Hans` in lockstep, so a missing key surfaces here as a
raw key or an English string sitting in the Chinese tree — easy to miss visually,
obvious in the tree. Assert copy against the snapshot, and screenshot when the
question is genuinely visual (layout, spacing, color, overlap) or when the user
will want to see it. agent-device already downsamples output (~402×874), so the
image is safe to read directly. Pass an absolute path:

```bash
.claude/skills/simulator/ad screenshot /absolute/path/shot.png
```

**Before asserting on any amount, check that asset privacy mode is off.** The
home screen's eye toggle runs every figure through `maskAssetAmount`, replacing
amounts and percentages with dots. Nothing in the snapshot or the screenshot
announces that masking is active — a run can read the screen perfectly and
report meaningless values. This is the one precondition that costs correctness
rather than time.

## OCR recognition needs photos in the library

That flow reads screenshots from the photo library, and agent-device has no
command for it — it's `xcrun simctl addmedia`. The system photo picker is also
invisible to `--settle`, which reports `+0 -0` and looks exactly like a dead
button until an explicit `snapshot -i` reveals it. Read
`references/ocr-fixtures.md` before touching account recognition; it walks the
whole loop and shows which recognized fields you can assert.

## Finishing

`ad close` when done; it keeps the iOS runner warm for next time. Leave Metro
running unless the user asks otherwise — restarting costs more than leaving it
up.

Report what you observed, not what should happen: which screen, which asserted
string, and the screenshot path if you took one.
