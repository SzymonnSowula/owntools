/** One public build of the desktop app. Newest entry first. */
export type ChangelogEntry = {
  /** Semver, without a leading "v". */
  version: string;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  /** One-line headline for the release. */
  title: string;
  /** What changed, one bullet each. */
  notes: string[];
};

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "0.3.0",
    date: "2026-09-18",
    title: "nine tools, the bar, and the source on GitHub",
    notes: [
      "The bar - a small capsule that sits over any app: dictate, record, start a focus session or a meeting from anywhere, no window to find first. On by default, movable, hidden with one click.",
      "meet - records both sides of a call, transcribes it on the machine as it goes, and summarises it with a local model; to-dos land in focus, a recap can go to social.",
      "capture - screenshots with a region picker, annotations and on-device OCR; send them to the board or a post. disk - a disk-space analyzer with a treemap, quick wins, duplicates and installed programs; everything goes to the Recycle Bin, never further.",
      "dictate - a second engine (NVIDIA Parakeet, ten times faster on long takes), words arrive while you speak, spoken commands (new line, scratch that, send it), per-app profiles, live captions, a vocabulary of spellings and replacements, a history of takes.",
      "screeni - generated sound effects (clicks, typing, zooms) timed from a native input track, transitions, look presets, image overlays, lower thirds, a script tab that cuts by sentence and finds fillers and retakes, share links.",
      "Intelligence - one optional local language model (llama.cpp, Qwen3) for every tool, or your own cloud key. Automations, sync through a folder you already sync, a privacy receipt listing every request the app ever made, and a Settings screen of its own with a Storage page.",
      "Twelve quick file tools on the hub: YouTube to transcript, subtitles, PDF, images, audio, video, GIF - all on the device.",
      "Pro keys are now signed (OWNT-…): the source is public on GitHub under AGPL-3.0, so a key is a signature the app checks, not a format anyone can print. One key covers one computer at a time. Settings → About gained Check for updates.",
    ],
  },
  {
    version: "0.2.0",
    date: "2026-09-02",
    title: "social - schedule posts, let agents plan them",
    notes: [
      "social - a sixth tool: a week / month / list calendar, a composer with per-network tabs, previews, threads, Unicode bold and italic, emoji, media library and per-network character limits; drag posts between slots; drafts, tags, repeat rules; a runner that publishes from the tray with retries, native notifications and a catch-up sheet for posts missed while the app was closed.",
      "Live networks: Bluesky, Mastodon, Telegram, Discord, Slack, Dev.to, Medium. X and LinkedIn with your own developer app (OAuth in the browser, loopback redirect). About 25 more are listed as bring-your-own-app or coming soon - keys can be saved, publishing follows in later builds.",
      "Agents: a local REST API and an MCP server (Streamable HTTP) on 127.0.0.1 with a bearer token, so Claude Code, Cursor, Codex, OpenClaw, Hermes - and ChatGPT through a tunnel - can list channels and create, update or publish posts. Every agent-made post lands in the calendar for review.",
      "In-app AI in the composer with your own key: Anthropic or any OpenAI-compatible endpoint (OpenAI, Ollama, LM Studio). Off by default; nothing is sent unless a key is configured.",
    ],
  },
  {
    version: "0.1.0",
    date: "2026-09-01",
    title: "first public build",
    notes: [
      "dictate - press a hotkey in any app, speak, press again; on-device whisper.cpp types clean text where your cursor is. Transcribe or translate any audio or video file, export .srt.",
      "screeni - screen recording with cinematic auto-zoom on the cursor, an editor with auto-cut silence and captions, offline MP4 export.",
      "focus - fullscreen timer and stopwatch, tasks, notes, habits, screen-time heatmap, ambient records, scroll guard, workspaces that start your setup.",
      "launch - paste a URL, get a launch video in six styles and three formats, plus store-screenshot prompts.",
      "board - an endless whiteboard (Excalidraw inside): paste or drop screenshots, sketch boxes and arrows, keep many boards, export PNG, SVG or .excalidraw. Every board is a folder on your disk.",
    ],
  },
];
