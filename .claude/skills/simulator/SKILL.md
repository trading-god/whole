---
name: simulator
description: Run Whole on the iOS Simulator or the Android Emulator and verify a change actually works — drive the real app with agent-device (accessibility snapshot, tap, type, deep links, screenshots) instead of guessing from the code. Use this whenever you have touched anything under src/app, src/components, src/features, or src/i18n and want to confirm it renders and behaves correctly; whenever the user says 跑起来看看 / 截图 / 验证一下 / 试一下 / 模拟器 / 安卓 / simulator / emulator / screenshot / "does this actually work"; and whenever a task is only really done once the real UI has been seen. Also covers loading OCR sample screenshots into either device's photo library to exercise the account-recognition flow.
---

# Verifying Whole on the iOS Simulator and Android Emulator

Drive the app with [`agent-device`](https://docs.expo.dev/agents/agent-device/). **Its own help is the reference, and it matches the installed version**: `ad help` (loop, targets, rules), `ad help manual-qa` (command shapes), `ad help react-native` (Metro, overlays, dev servers, sessions), `ad help debugging`. Everything below is true of this repo and this machine and cannot be learned from the help.

## The `ad` wrapper

`.claude/skills/simulator/ad` passes arguments through verbatim, pins the cwd to the repo root (agent-device keys sessions by working directory — a command run from anywhere else dies with `SESSION_NOT_FOUND`), and points `pnpm dlx` at the public registry (this machine's default is an unreachable internal mirror). A globally installed `agent-device` wins if present; nothing needs installing.

## What the help cannot tell you

- Whole is a dev build: Metro must be running (`pnpm start`, then `curl -fsS http://127.0.0.1:8081/status`) and the app installed (`pnpm ios` / `pnpm android`). An installed build older than the source red-screens on a missing native module — suspect that before the diff. After node_modules changes, restart Metro with `pnpm start --clear`: stale Metro state makes Android die with `TypeError: property is not writable` while iOS keeps working.
- The Android emulator is wired by hand — agent-device starts nothing. The only AVD here is `whole-test`:

  ```bash
  "$ANDROID_HOME/emulator/emulator" -avd whole-test &
  adb wait-for-device shell 'while [ "$(getprop sys.boot_completed)" != "1" ]; do sleep 2; done'
  adb reverse tcp:8081 tcp:8081
  adb shell am start -a android.intent.action.VIEW \
    -d "whole://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081" com.whole.app
  ```

  Without the deep link the dev client parks on the dev-launcher menu. The AVD is sized to match the iOS simulator's iPhone 17 Pro (12 GB RAM, 256 GB userdata, 1206×2622 @ 460 dpi) so it CAN run Gemma — the settings Test button passes on it. That needs the 12 GB `hw.ramSize`: at the old 2 GB the model load breaches the lowmemorykiller min watermark and the whole app process is killed before any verdict renders. Android-only quirks: the launcher's grey gear bubble covers the home add button (not an app bug); `scroll up` at a page top pulls down the quick-settings shade (recover with a deep link); a post-reload `Can't perform a React state update…` warning is reload residue (a cold relaunch doesn't reproduce it); a wiped `-wipe-data` run also deletes the agent-device snapshot-helper APK — re-run `ad devices` (or any session-opening command) so it reinstalls, and the first launch after a wipe opens the dev menu once (press Continue).

- With sessions live on both platforms, pass `--platform` and `--session` (`ios` / `android`) on every command. `DEVICE_IN_USE` on `open` means another session already holds that device; follow the error and reuse the named session with `--session <name>` rather than closing it, because it may belong to someone else.
- Deep links beat tapping through screens: `whole://` (home), `whole://onboarding`, `whole://accounts/new`, `whole://accounts/<id>`, `whole://settings`. A first launch lands on onboarding — that is the `_layout` gate working, not a routing bug. An iOS deep link to a backgrounded app raises the system sheet 「在“Whole”中打开？」— press `打开`.
- Assert copy against `snapshot -i`: en and zh-Hans ship in lockstep, so a missing key surfaces as a raw key or an English string sitting in the Chinese tree. Before asserting on any amount, check that asset privacy mode is off — the eye toggle runs every figure through `maskAssetAmount`, and nothing in the snapshot or screenshot announces the masking.
- The OCR flow reads the photo library, which agent-device cannot reach: on iOS `xcrun simctl addmedia booted <png>`, on Android `adb push <png> /sdcard/Pictures/` plus a `MEDIA_SCANNER_SCAN_FILE` broadcast. Read `references/ocr-fixtures.md` before touching recognition — it covers the picker being invisible to `--settle` and which recognized fields to assert.
- When done, run `ad close` for every session you opened so the devices are released; leave Metro running. Report what you observed — screen, asserted string, screenshot path — not what should happen.
