# owntools on macOS

What works, what needs an Apple certificate, what still needs a real Mac to
verify, and how to build it. The release mechanics both platforms share:
`docs/release.md`.

The macOS port was written against the APIs, not against a Mac — there was no
Apple hardware in reach. Anything not marked **unverified** below is meant to
be compiled and unit-tested on CI's macOS runner — but until 2026-09-14 that
runner never got past `tauri-build`'s feature check (see "On CI"), so no macOS
code had actually been compiled before then. Work the checklist in §7 the
first time you have a MacBook in front of you; it is ordered so the things
that would sink the product fail first. §8 is how to get a build onto a Mac
that is not yours.

---

## 1. Building

### On a Mac

```bash
pnpm install
pnpm tauri dev                                   # run it
pnpm --filter desktop tauri build                # .app + .dmg for this Mac
pnpm --filter desktop tauri build --target universal-apple-darwin   # both chips
```

The universal build needs both Rust targets:

```bash
rustup target add aarch64-apple-darwin x86_64-apple-darwin
```

`tauri.macos.conf.json` is picked up automatically next to `tauri.conf.json`
(as is `Info.plist`), so nothing has to be passed on the command line: it
switches the bundle targets to `app` + `dmg`, sets the deployment target to
macOS 11, turns on the hardened runtime and points at `entitlements.plist`.

`macOSPrivateApi` is not optional either: the dictation pill is a
**transparent, undecorated** window, and on macOS the transparent-background
API is private. Tauri gates it behind both the config flag and the cargo
feature `macos-private-api`, and **both live in the shared files** —
`app.macOSPrivateApi` in `tauri.conf.json`, the feature on the main `tauri`
line of `Cargo.toml`. `tauri-build` compares that line with the config and does
not read `[target.'cfg(target_os = "macos")']` tables; with the feature
declared there (the first version of the port) every macOS build stopped with
"The `tauri` dependency features on the `Cargo.toml` file does not match the
allowlist" before a line of our code compiled. On Windows the flag and the
feature change nothing. Without them the pill comes up as an opaque grey
rectangle. It also rules out a Mac App Store build — which is fine, because a
sandboxed build could not run the disk analyzer anyway.

### On CI

`.github/workflows/release.yml` builds a universal `.dmg` on `macos-14` after
the Windows job. It runs second on purpose: `latest.json` is one release asset
that tauri-action merges platform by platform, and two jobs writing it at the
same time lose one of them.

`.github/workflows/ci.yml` runs `cargo check --all-targets` and `cargo test` on
both Windows and macOS for every push. That macOS leg is the only thing that
compiles the `#[cfg(target_os = "macos")]` arms — the FFI in `mac.rs`,
`cursor.rs` and `input_track.rs` — so a red CI there is a real macOS break, not
a flake.

---

## 2. Signing and notarization

**Without an Apple Developer Program membership ($99/yr) a downloaded .dmg
opens with "owntools is damaged and can't be opened. You should move it to the
Trash."** That is not a warning a normal user works around; it reads as
malware. Treat the certificate as part of shipping to macOS, not as polish.

Once you have the membership:

1. Create a **Developer ID Application** certificate in the Apple Developer
   portal, install it in Keychain Access, export it as a `.p12` with a password.
2. Create an **app-specific password** at <https://appleid.apple.com> for
   notarization (the Apple ID password itself will not work).
3. Add the repository secrets:

   | Secret | Value |
   | --- | --- |
   | `APPLE_CERTIFICATE` | base64 of the `.p12` |
   | `APPLE_CERTIFICATE_PASSWORD` | the `.p12` password |
   | `APPLE_SIGNING_IDENTITY` | `Developer ID Application: Your Name (TEAMID)` |
   | `APPLE_ID` | the Apple ID e-mail |
   | `APPLE_PASSWORD` | the app-specific password |
   | `APPLE_TEAM_ID` | the ten-character team id |

   ```bash
   base64 -i cert.p12 | gh secret set APPLE_CERTIFICATE
   ```

The release workflow detects `APPLE_CERTIFICATE` and switches to the signed
path; without it the same build runs unsigned so the pipeline still produces
something testable.

Until then, the honest instruction for a tester is:

```bash
xattr -dr com.apple.quarantine /Applications/owntools.app
```

Put that on the download page if you ship unsigned, and be explicit that it is
a workaround. Do not tell people to right-click → Open: on recent macOS that no
longer works for an unsigned app from a `.dmg`.

---

## 3. Permissions macOS will ask for

Every string a user reads in these dialogs is in `Info.plist`. A missing key is
not a warning — macOS kills the process the moment it touches the resource.

| Permission | Needed for | How it is asked |
| --- | --- | --- |
| **Microphone** | dictation, voice notes, the mic track in a recording | system prompt on first use |
| **Screen Recording** | screeni | system prompt from WebKit on first `getDisplayMedia`; the user must then restart the app — macOS is strict about this |
| **Accessibility** | typing a transcript into *another* app | **never prompted automatically.** `permissions.rs accessibility_status` reports it and dictate → Overview shows a banner with a button that opens the sheet |
| **Input Monitoring** | the editor's optional key-timing track | prompted by the first `CGEventSourceKeyState` call; without it a take simply has no typing track |
| **Files and Folders** | the disk analyzer reading Desktop / Documents / Downloads | system prompt per folder |
| **Full Disk Access** | the disk analyzer seeing *everything* | not promptable — the user grants it in System Settings, and without it parts of the volume read as empty |
| **Apple Events (Finder)** | "move to Trash" in the disk analyzer | system prompt on first use |

Accessibility is the one that bites, because its failure is silent: without it
`CGEventPost` succeeds and not one character is typed. That is why it has a
status command of its own and a banner rather than a prompt.

---

## 4. The speech engines on macOS

| Engine | macOS | Notes |
| --- | --- | --- |
| **Parakeet** (sherpa-onnx) | ✅ works | `sherpa-onnx-v1.13.7-osx-universal2-shared-no-tts.tar.bz2`, pinned with its SHA-256 in `models.ts`. Same universal binary on Intel and Apple Silicon. |
| **Whisper** (whisper.cpp) | ⚠️ needs one workflow run | No whisper.cpp release ships a macOS CLI: v1.8.5–v1.9.3 and b4938 carry Windows and Linux binaries only, and b4938's one Apple artifact is an `xcframework` — a library, not `whisper-cli`. |

Parakeet is the dictation engine anyway, and on macOS it is the *only* one until
whisper is built. What a Mac is missing without whisper: transcribing an
existing file, subtitles/SRT, and translate-to-English. The app says so rather
than offering a download it cannot run (`engineAvailable`, `modelAvailable`).

**To turn whisper on for macOS**, once:

1. Actions → **whisper.cpp for macOS** → Run workflow (tag `b4938`).
   It builds arm64 with Metal and x86_64 with Accelerate, `lipo`s them into one
   universal `whisper-cli`, ad-hoc signs it (Apple Silicon refuses to run an
   unsigned binary, and `lipo` invalidates the linker's signature), proves it
   runs, and publishes it on the tag `whisper-macos-b4938`.
2. The job summary prints the exact `WHISPER_RUNTIMES.macos` block — url, byte
   count and SHA-256. Paste it into
   `packages/feature-dictation/src/models.ts`.
3. Ship. Nothing else changes: the download path, the checksum check and the
   unpack are the same ones Windows uses.

The app refuses to install an engine whose SHA-256 it does not already know,
and that rule does not get an exception because the binary happens to be ours.

---

## 5. What is different on macOS, and why

- **Typing into other apps** — Windows uses `SendInput` with
  `KEYEVENTF_UNICODE`; macOS posts a `CGEvent` carrying a unicode string
  (`mac.rs type_text`), 16 UTF-16 units per event, 4 ms apart. Same pacing,
  same reason: apps with their own input queues drop characters that arrive
  faster.
- **Pointer coordinates** — Quartz reports the pointer in *points*; on a Retina
  screen a point is two pixels, while Tauri reports monitors in physical pixels.
  `cursor.rs` multiplies by the backing scale of the display the pointer is on,
  which is exactly the convention tao uses for a monitor's origin. Getting this
  wrong would put the drawn cursor at half its true offset — the macOS version
  of the two-monitor bug the editor already has scars from.
- **Keeping the recorder bar out of the recording** — `WDA_EXCLUDEFROMCAPTURE`
  on Windows, `NSWindowSharingNone` on macOS.
- **The hotkey** — the binding is `ctrl+shift+space` on both (Tauri maps `ctrl`
  to Control on macOS, and ⌘⇧Space is Apple's own character picker). Only the
  label changes: a Mac reads **⌃⇧Space**.
- **Trash** — `SHFileOperationW` with `FOF_ALLOWUNDO` on Windows, Finder via
  `osascript` on macOS. Neither ever deletes for good.

### Windows-only, and honest about it

- The **usage sampler** and the **scroll guard** compile to no-ops
  (`lib.rs`), so the frontend can keep calling them.
- **Window capture matching** (`capture.rs platform::windows`) returns an empty
  list, so a *window* recording gets no capture rectangle and cursor effects
  stay off rather than landing in the wrong place. Full-screen takes are
  matched normally, which is the case the editor asks for anyway.
- The **disk analyzer's Applications page** reads the Windows registry; on
  macOS it returns nothing. Scanning, duplicates, the treemap and Trash all
  work.

---

## 6. Speed

The resident recognizer (`parakeet.rs`) removes the model load from every take.
Measured on the Windows dev machine (i5-10300H, 4 physical cores), 3.9 s of
speech:

| | |
| --- | --- |
| one-shot CLI, 7 threads (what shipped before) | 6100–6500 ms |
| resident recognizer, 7 threads | 1100–1300 ms |
| resident recognizer, 4 threads | **660–770 ms** |

A MacBook should do better than the last row — Apple Silicon's performance
cores are considerably faster per core than a 2020 mobile i5 — but that is a
prediction, not a measurement. `recognizer_threads` counts *performance* cores
on Apple Silicon (`hw.perflevel0.physicalcpu`), because scheduling ONNX matrix
multiplies onto efficiency cores drags the whole batch down.

Worth trying on real hardware: sherpa-onnx accepts `--provider=coreml`. It is
not wired up because there is no way to tell from here whether the official
universal build includes the CoreML execution provider, and a provider that
fails to initialise takes the recognizer down with it.

---

## 7. First-run checklist on real hardware

In this order — the things that would sink the product fail first.

1. **It opens.** Gatekeeper, the window, the tray icon, the five themes.
2. **Dictation, the whole loop.** Install Parakeet (63 MB engine + 670 MB
   model), grant the microphone, record a test take on the Overview page, then
   ⌃⇧Space into TextEdit. Check the timing line under the transcript — a
   four-second take on a warm model should be well under a second. If nothing
   is typed into TextEdit but the test take works, it is Accessibility.
3. **The pill does not steal focus.** This is the macOS version of the bug that
   made ⌃⇧Space "do nothing" on Windows for a while: if the pill takes the
   keyboard, the transcript is typed into the pill instead of the app behind it.
   `focusable: false` is supposed to prevent it. **Unverified.**
4. **Screen recording.** Grant it, restart, record the full screen, check that
   the recorder bar is *not* in the take, then check where the drawn cursor
   lands on a Retina display — that is the points-vs-pixels conversion in §5.
5. **The disk analyzer.** Scan the home folder: how long, how much memory, do
   the folder-permission prompts read sensibly, does "move to Trash" put the
   file in the Trash.
6. **The editor.** Open a take, scrub, export, and confirm sound effects come
   out in the exported file.
7. **The updater.** Install an older version, publish a newer one, check that
   the `.app.tar.gz` update applies.

Everything in this list is compiled and unit-tested; none of it has been run on
a Mac. Say so to the first testers — an honest "beta on macOS" costs less than
a bad review.

---

## 8. A build for someone else's Mac

No Mac on the desk is not a blocker for testing: CI builds the app, a person
with a Mac runs it.

1. **Build.** Actions → **macOS test build** → Run workflow
   (`gh workflow run macos-test-build.yml`; the target defaults to universal,
   which runs on Apple Silicon and Intel). It is `tauri build` with an ad-hoc
   signature (`signingIdentity: "-"` — Apple Silicon will not start an unsigned
   binary) and without updater artifacts, so it needs no secrets. Expect
   roughly half an hour for universal; `aarch64-apple-darwin` alone is faster
   when the Mac is known to be Apple Silicon.
2. **Hand it over.** The run page carries an `owntools-macos-…` artifact (kept
   14 days) with the `.dmg` and a zipped `.app` as a spare. Send the `.dmg`.
3. **On the Mac.** Drag owntools into Applications, then once in Terminal:
   `xattr -dr com.apple.quarantine /Applications/owntools.app` — without a
   Developer ID and notarization macOS calls the app "damaged" otherwise.
   Permissions as in §3. **Every new test build is a new signature**, and TCC
   ties Microphone / Screen Recording / Accessibility grants to it: after an
   update the old entries silently stop applying, so remove owntools from those
   lists and allow it again rather than debugging a "broken" feature.
4. **What to send back.** macOS version and chip (Apple menu → About This
   Mac), screenshots of anything wrong, and the log:
   `~/Library/Logs/app.owntools.desktop/owntools.log`.
5. **Expect WebKit, not Chromium.** On macOS the UI runs in WKWebView, which
   uses the system's WebKit, so what works depends on the Mac's macOS / Safari
   version. The frontend has only ever run in WebView2. What WebKit has
   (researched 2026-09-14, not yet seen on hardware):
   - **`getDisplayMedia`** goes through the system picker (macOS 14+). Tauri's
     auto-granted media permission broke it on macOS 14.0; WebKit fixed that in
     2024, which points to macOS 14.6 / Safari 17.6+ (inferred;
     [wry #1195](https://github.com/tauri-apps/wry/issues/1195) is still open).
     It captures **no system audio**, and on macOS 15+ ScreenCaptureKit ignores
     `NSWindowSharingNone`, so **the recorder bar will most likely be in the
     take** (Apple DTS: there is no public API to prevent capture).
   - **`MediaRecorder`** writes MP4 (H.264 + AAC) since Safari 14.1 and WebM
     only since Safari 18.4. The recorder asks for WebM only
     (`feature-editor/src/lib/recorder.ts`) and names every take `screen.webm`
     (`projectIo.ts`), so an older WebKit writes MP4 bytes under a `.webm`
     name. The export's non-WebCodecs fallback is WebM-only too
     (`exportVideo.ts`). Dictation already falls back to `audio/mp4`.
   - **WebCodecs**: `VideoEncoder` since Safari 16.4, `AudioEncoder` only since
     Safari 26 (AAC and Opus; no MP3 or FLAC), so an MP4 export *with sound*
     needs Safari 26. Feature-detect, never assume.

   §9 is the native answer to all three.

---

## 9. Better on a Mac than on Windows

The port is not the goal; the Mac has system features Windows does not, and
owntools should use them. Researched 2026-09-14 against Apple's and Tauri's
docs (Tauri 2.11.5 in the lock) — none of it has run on hardware yet. Ordered
by value for effort; the prerequisite is what decides *when*.

**Decide first: the minimum macOS.** 11.0 today. 14.2 would buy the system
screen-sharing picker, Core Audio process taps (the only way meet can hear the
other side without a virtual driver) and a WebKit without the capture bug
above. Macs that cannot run 14 are from 2017 or older.

| # | What | For | Prerequisite |
| --- | --- | --- | --- |
| 1 | **Menu bar and Dock.** `TrayIcon::set_title` puts the running focus timer or the REC time next to the menu bar icon (macOS only). `set_badge_label` / `set_badge_count` for posts waiting for review. `set_progress_bar` draws export and model-download progress on the Dock tile. `set_activation_policy(Accessory)` while closed to the tray, `Regular` when the window opens — a menu bar app when hidden, a normal app when not. `titleBarStyle: "Overlay"` + `trafficLightPosition` for real traffic lights instead of the Windows-style buttons in `SuiteTitleBar`. | focus, screeni, social, dictate | none — all in Tauri already |
| 2 | **Vision text recognition** (`VNRecognizeTextRequest`, macOS 10.15+, through `objc2-vision`) replaces capture's "OCR: not on this platform yet". Polish is reported as supported on current macOS by third parties, not by Apple — read `supportedRecognitionLanguages` at runtime. | capture | none |
| 3 | **`owntools://` links** (tauri-plugin-deep-link): Shortcuts, Raycast, Alfred and Stream Deck start a focus session, dictation, a recording or a new board. Plus **Services menu** actions on selected text in any app — "Add to focus tasks", "Draft a post", "Summarize" (`NSServices` in Info.plist with `NSRequiredContext`, or macOS hides them; a handler through objc2). | focus, social, Intelligence | the app installed in /Applications (schemes cannot be registered at runtime) |
| 4 | **Keychain** for social tokens and the cloud API key instead of `credentials.json` (`keyring` / `security-framework`, file keychain, no entitlement). | social, Intelligence | Developer ID — with ad-hoc signing every update re-prompts |
| 5 | **meet on a Mac**: Core Audio process tap for "them" + the mic for "you", same segment events as WASAPI. Needs `NSAudioCaptureUsageDescription`. | meet | macOS 14.2, Developer ID |
| 6 | **Native recorder on ScreenCaptureKit**: the system picker, the app's own windows excluded by the content filter (the only reliable way now that `NSWindowSharingNone` is ignored), `showsCursor = false` so the editor draws the *only* pointer — WebView2 on Windows always bakes the real one in — system audio (13+), microphone (15+), `SCRecordingOutput` straight to a file, and the content rect for `captureRect` without shape matching. | screeni | macOS 14, Developer ID (without the picker macOS 15 re-asks for Screen Recording monthly) |
| 7 | **Apple Intelligence as an Intelligence backend** (Foundation Models): no 2.5 GB download on Apple Silicon. Apple publishes Apache-2.0 C bindings, so Rust can call it without writing Swift. 4K-token context and **no Polish** — English-first, Qwen stays the default. Same story for `SpeechAnalyzer` (on-device long-form transcription, no Polish): an optional English engine, Parakeet stays. | meet summaries, social, dictate | macOS 26, Apple Silicon, Apple Intelligence on |
| 8 | **Widgets and Controls**: a focus widget on the desktop / in Notification Center with Start and Pause (interactive, macOS 14+), today's tasks, the next scheduled post; Control Center and menu bar controls for dictate / focus / record (macOS 26). A Swift widget extension built in Xcode, signed with its own entitlements and copied into `Contents/PlugIns` (Tauri has no extension support; `bundle.macOS.files` copies without signing), plus an App Group with the team-ID prefix to share state. App Intents / Spotlight actions are Swift-only and come after this. | focus, dictate, screeni, social | Developer ID, a Swift extension + a CI step, macOS 14 / 26 |

Rows 1–3 can ship before the Apple certificate; from row 4 on, the $99
membership is a prerequisite anyway — ad-hoc signed builds lose every
permission and keychain grant on each update.
