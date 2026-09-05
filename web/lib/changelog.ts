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
    version: "0.2.0",
    date: "2026-09-02",
    title: "social — schedule posts, let agents plan them",
    notes: [
      "social — a sixth tool: a week / month / list calendar, a composer with per-network tabs, previews, threads, Unicode bold and italic, emoji, media library and per-network character limits; drag posts between slots; drafts, tags, repeat rules; a runner that publishes from the tray with retries, native notifications and a catch-up sheet for posts missed while the app was closed.",
      "Live networks: Bluesky, Mastodon, Telegram, Discord, Slack, Dev.to, Medium. X and LinkedIn with your own developer app (OAuth in the browser, loopback redirect). About 25 more are listed as bring-your-own-app or coming soon — keys can be saved, publishing follows in later builds.",
      "Agents: a local REST API and an MCP server (Streamable HTTP) on 127.0.0.1 with a bearer token, so Claude Code, Cursor, Codex, OpenClaw, Hermes — and ChatGPT through a tunnel — can list channels and create, update or publish posts. Every agent-made post lands in the calendar for review.",
      "In-app AI in the composer with your own key: Anthropic or any OpenAI-compatible endpoint (OpenAI, Ollama, LM Studio). Off by default; nothing is sent unless a key is configured.",
    ],
  },
  {
    version: "0.1.0",
    date: "2026-09-01",
    title: "first public build",
    notes: [
      "dictate — press a hotkey in any app, speak, press again; on-device whisper.cpp types clean text where your cursor is. Transcribe or translate any audio or video file, export .srt.",
      "screeni — screen recording with cinematic auto-zoom on the cursor, an editor with auto-cut silence and captions, offline MP4 export.",
      "focus — fullscreen timer and stopwatch, tasks, notes, habits, screen-time heatmap, ambient records, scroll guard, workspaces that start your setup.",
      "launch — paste a URL, get a launch video in six styles and three formats, plus store-screenshot prompts.",
      "board — an endless whiteboard (Excalidraw inside): paste or drop screenshots, sketch boxes and arrows, keep many boards, export PNG, SVG or .excalidraw. Every board is a folder on your disk.",
      "free launch video maker on the web — the same engine in the browser, no sign-up.",
    ],
  },
];
