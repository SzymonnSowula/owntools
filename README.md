# shipshape

Local-first desktop studio: four tools in one Tauri 2 app, running entirely on
your own machine (Windows now, macOS next).

- **dictate** — press a hotkey (Ctrl+Shift+Space) in any app, speak, press
  again; on-device whisper.cpp types clean text where your cursor is.
  Transcribes and translates any audio or video file, exports `.srt`.
- **screeni** — screen recording with cinematic auto-zoom on the cursor, an
  editor (auto-cut silence, captions, camera bubble) and offline MP4 export
  (WebCodecs / mediabunny — no ffmpeg).
- **focus** — fullscreen timer and stopwatch, tasks, notes, habits,
  screen-time heatmap, ambient records, scroll guard, workspaces that start
  your setup.
- **launch** — paste a URL, get a keynote-style launch video (six style packs,
  16:9 / 9:16 / 1:1, 15–60 s) plus store-screenshot prompts.

Free, with a "made with shipshape" badge on video exports; a one-time Pro key
(offline, no account) removes it. The app has three windows — main, recorder
overlay and the dictation pill — and one hub. The landing page lives in `web/`.

Project context for agents and contributors (conventions, architecture notes,
current state): [`CLAUDE.md`](CLAUDE.md). Brand and design spec:
[`docs/brand-design.md`](docs/brand-design.md).

## Layout

```
apps/desktop            Tauri 2 shell: 3 windows (main / recorder / dictation),
                        Hub launcher + quick-tool modals, FocusTimerOverlay,
                        workspace sessions (ritual.ts / SessionSheet /
                        WorkspaceSetup, Rust launcher.rs)
packages/feature-focus  7 views (Today, Tasks, Notes, Habits, Stats, Sounds,
                        Settings); merged hubs with tabs; voice notes;
                        lib/audio = context/noise/voices/vinyl/records/piano
packages/feature-editor screeni: compositor, zoom, exportVideo, silence
                        (auto-cut), srt, transcribe, TranscribeModal,
                        ExtractAudioModal
packages/feature-launch launch engine (`@shipshape/launch-engine`, the one
                        workspace package under packages/): engine/ = style
                        packs + seeded takes + beat sheet + Remotion
                        composition, shared by desktop and web; LaunchView
                        studio; store shots; pageIntel
packages/feature-dictation  engine.ts (models / settings / prompt /
                        transcribe), cleanup.ts, DictationPill, DictateView
packages/feature-board  board: Excalidraw whiteboard — local boards in AppData,
                        screenshot paste/drop, PNG/SVG/.excalidraw export
packages/{core,ui,licensing}  branding / audio / env · WinDots · license keys
web/                    landing (Next 16, port 3006) + the free launch video
                        maker (app/tools/launch-video-maker, server route
                        app/api/launch-intel, engine imported from
                        packages/feature-launch)
docs/                   brand & design spec, release process, build history
```

## Commands

```bash
pnpm install && pnpm tauri dev      # native app (all three windows)
pnpm dev                            # frontend only on :1430 (recording/tray inert)
pnpm --filter desktop tauri build   # NSIS installer
cd web && pnpm dev                  # landing on :3006
pnpm test                           # unit tests (vitest)
pnpm typecheck                      # tsc across the workspace
```

## Landing (`web/`)

Links, price and contact points come from `NEXT_PUBLIC_*` variables — every
one is documented in [`web/.env.example`](web/.env.example). Unset download or
checkout URLs render as honest "launching soon" states instead of dead links,
and the price is defined once, in `web/lib/site.ts`.

## Releasing

The release process (versioning, signing, updater manifest, installer upload)
is described in [`docs/release.md`](docs/release.md). The essentials:

- **License keys**: `node scripts/generate-license.mjs [count]` prints offline
  `SCRN-…` Pro keys.
- **Updater key**: the private signing key lives outside the repo, in
  `~/.tauri/shipshape.key`. Never commit it.
- **Identifier**: `app.suite.desktop` must never change — it is the AppData
  path that holds the whisper engine, the models and all user data.
  Rebranding touches `packages/core/src/branding.ts`, `productName`, the HTML
  titles and the Cargo crate name (`src-tauri/Cargo.toml` + `main.rs`), never
  the identifier.

## Notes

- **Styling**: Tailwind 4 **without preflight** in the desktop app; focus's
  legacy CSS is scoped under `.mod-focus`, the editor gets a scoped
  mini-preflight under `.mod-create`. Un-layered `suite.css` overrides always
  win — never rely on bundle order.
- **Recording flow**: capture happens in the `recorder` overlay window; the
  finished project is written to AppData, then a `recording-finished` event
  tells the main window to open the editor. Never pass MediaStreams between
  windows.
- **Whisper**: pinned whisper.cpp b4938; models live side by side in
  `<AppData>/whisper`, default `ggml-large-v3-turbo-q5_0.bin` (~575 MB), with
  an in-app model manager.
- **Export**: offline WebCodecs via mediabunny; the free tier watermarks
  "made with shipshape", a `SCRN-…` key removes it.
