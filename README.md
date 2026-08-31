# shipshape

Local-first studio for people who ship. One desktop app (Windows now, macOS next):

- **Focus** — deep-work desktop: usage heatmap, tasks, Notion-style notebook,
  habits, planner, journal, ambient sounds, scroll guard, tray timer.
- **Create** — screen recordings that follow your cursor (auto-zoom), editor
  with timeline, camera PiP, captions, and offline MP4 60 fps export
  (WebCodecs/mediabunny, no ffmpeg needed).
- **Record** — always-on-top recorder overlay (its own window), reachable from
  the sidebar and the tray.

Planned phases (see `~/.claude/plans/` plan file): on-device dictation
(whisper.cpp), URL → product-launch-video generator, macOS port, landing.

The name is "shipshape" (see runner-ups in the file) — see `packages/core/src/branding.ts`,
`apps/desktop/src-tauri/tauri.conf.json` (productName, identifier) and
`apps/desktop/index.html` when rebranding.

## Layout

```
apps/desktop/            Tauri 2 shell (two windows: main + recorder overlay)
  src/                   suite shell (App, SuiteSidebar, CreateModule, overlay entry)
  src-tauri/             one Rust crate: tray, single-instance, usage tracker +
                         scroll guard (Windows-only, stubbed elsewhere), cursor,
                         ffmpeg fallback, legacy-data importer
packages/
  feature-focus/         focus module (views, store, legacy.css scoped to .mod-focus)
  feature-editor/        screeni editor (compositor, zoom, exportVideo, projectIo)
  feature-recorder/      RecorderOverlay (runs in the overlay window)
  licensing/             offline SCRN- license keys (Pro removes the watermark)
  core/                  branding, env, window helpers
```

## Dev

```bash
pnpm install
pnpm tauri dev     # native app (main + hidden recorder window)
pnpm dev           # frontend only on :1430 (recording/tray inert)
```

## Build

```bash
pnpm build                              # tsc + vite
pnpm --filter desktop tauri build       # NSIS installer
```

## Notes

- Styling: Tailwind 4 loaded **without preflight**; focus's legacy CSS is scoped
  under `.mod-focus`, the editor gets a scoped mini-preflight under `.mod-create`.
- Recording flow: capture happens inside the overlay webview; the finished
  recording is written to AppData, then a `recording-finished` event tells the
  main window to open the editor. Never pass MediaStreams between windows.
- First run imports data from the standalone apps (`com.focus.app/focus.json`,
  `app.screeni.desktop/screeni/projects`) without touching the originals.
- License keys: `node ../screeni/scripts/generate-license.mjs` (same checksum).
