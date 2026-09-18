# owntools

**your work. your device.** Dictate, record, transcribe, take notes, plan the
week, clean the disk - nine tools in one desktop app that runs entirely on
your own machine. No account, no cloud, nothing leaves the device.

Windows today, macOS in progress. Website: [owntools.app](https://owntools.app)
· downloads: [Releases](https://github.com/SzymonnSowula/owntools/releases)
· [changelog](https://owntools.app/changelog)

## The tools

| | |
| --- | --- |
| **dictate** | a hotkey in any app, speak, press again: on-device speech recognition (whisper.cpp or NVIDIA Parakeet) types clean text where your cursor is; vocabulary, spoken commands, live captions, file transcription and translation |
| **screeni** | screen recording with auto-zoom on the cursor, an editor (cuts, captions, camera bubble, generated sound effects, transcript-based editing) and offline MP4 export |
| **focus** | timer, tasks, notes, habits, ambient records, scroll guard, workspaces that start your setup |
| **meet** | records both sides of a call, transcribes it on the machine, summarises with a local model |
| **board** | an endless whiteboard (Excalidraw), local boards, paste screenshots |
| **social** | a local-first post scheduler for Bluesky, Mastodon, Telegram, Discord, Slack, X and more, with an MCP server for agents |
| **disk** | a disk-space analyzer: treemap, quick wins, duplicates, installed programs - everything goes to the Recycle Bin, never further |
| **capture** | screenshots with OCR, sent to the board or a post |
| **launch** | a product launch video from a URL |

Plus twelve quick file tools (YouTube → transcript, subtitles, PDF, images,
audio and video converters, GIF), a bar that sits over any app, and an optional
local language model (llama.cpp) for summaries and rewrites. Settings → Privacy
lists every request the app ever made.

## Free and Pro

dictate and the quick file tools are free, with no time limit. A one-time
**Pro key** unlocks every other tool: focus, screeni, capture, board, meet,
social, disk and launch.

- A key is an Ed25519 signature checked on your computer against a public key
  built into the app (`packages/licensing/src/license.ts`). It never phones
  home, and there is no activation server.
- Building from source gives you the free app: dictate, the quick file tools,
  and the other tools locked - the private key that signs Pro keys is not in
  this repository.
- One key covers **one computer at a time**. Moving to a new computer is a
  deactivate on the old one (Settings → License) and a paste on the new; if
  the old computer is gone, write to hello@owntools.app and the key is moved.
- 14-day refund, no questions asked. Terms: [owntools.app/terms](https://owntools.app/terms).

## Build from source

Requirements: Node 22+, [pnpm](https://pnpm.io) 10, a stable Rust toolchain,
and on Windows the Visual Studio Build Tools (C++) and the WebView2 runtime
(already on Windows 11). macOS builds need Xcode's command-line tools; see
[`docs/macos.md`](docs/macos.md) for what is still unverified there.

```bash
pnpm install
pnpm tauri dev                      # the native app, all windows
pnpm dev                            # the frontend alone in a browser (:1430) - recording, hotkeys and the tray are inert
cd web && pnpm dev                  # the website (:3006)
pnpm check                          # typecheck + unit tests; `cargo check` in apps/desktop/src-tauri for Rust
```

A release build (`pnpm --filter desktop tauri build`) produces the NSIS
installer and the updater artefacts, which are signed: either put your own
signing key in `TAURI_SIGNING_PRIVATE_KEY` (`pnpm tauri signer generate`
makes one) or set `bundle.createUpdaterArtifacts` to `false` in
`apps/desktop/src-tauri/tauri.conf.json` for a local build. The speech and
language models are not in the repo either: the app downloads pinned, checksummed
files on first use (`packages/feature-dictation/src/models.ts`,
`packages/feature-llm/src/models.ts`).

## Releases and updates

Installers are never committed. A tag `vX.Y.Z` runs
[`release.yml`](.github/workflows/release.yml), which builds the Windows
installer and a universal macOS `.dmg`, signs the updater artefacts and
attaches them with `latest.json` to a draft GitHub release. Once the release
is published, installed copies offer the update: at start-up, and on demand
under Settings → About → Check for updates. The process, including the
secrets the workflow needs, is [`docs/release.md`](docs/release.md).

## Layout

```
apps/desktop            the Tauri 2 shell: windows, the bar, the hub, onboarding, the updater
apps/desktop/src-tauri  Rust: audio capture, screen capture, disk scanner, dictation engines,
                        the local model, the social MCP server, the tray, the hotkeys
apps/promo              a 30 s launch cut, in Remotion
packages/core           branding, events, the network log, the updater, shared helpers
packages/ui             the marks, WinDots, dialogs, the error boundary
packages/licensing      Pro keys: the validator and the store
packages/feature-*      one package per tool (focus, editor = screeni, dictation, board,
                        social, disk, meet, capture, launch, tools, llm, automations,
                        sync, privacy)
web/                    the website (Next.js): landing, legal pages, the shop on Polar,
                        the thank-you page that shows a buyer's key, share links
docs/                   design, release, macOS and share-link notes
scripts/                the shop setup on Polar, key recovery, gift keys, the app icon
```

Each tool package carries its own notes where they are needed (the social
tool's README, the promo's README); the platform and release specifics are in
`docs/`.

## Contributing

Issues and pull requests are welcome. Run `pnpm check` before opening one; the
CI does the same plus `cargo check` on Windows and macOS. Keep UI copy in
English, one clear sentence where one will do, and never add a network request
without a `purpose` - Settings → Privacy shows every one of them to the person
using the app.

## License

[GNU AGPL-3.0-or-later](LICENSE). The owntools name and the app icon are not
covered by it - use the code, build on it, ship your fork under your own name.
Third-party engines and models (whisper.cpp, sherpa-onnx, llama.cpp, the
models from OpenAI, NVIDIA and Alibaba) are downloaded from their publishers
under their own licences; Remotion, used by the launch tool and the promo
cut, has [its own company licence](https://remotion.dev/license).
