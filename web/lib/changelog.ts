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
    version: "0.3.3",
    date: "2026-09-19",
    title: "two more quick tools: cut-outs and pictures",
    notes: [
      "Remove background - drop photos in, get the subject on a transparent, blurred or coloured backdrop. The model runs on this computer, on the graphics card where there is one, and nothing is uploaded. Free, like every quick file tool.",
      "Generate an image - a prompt in, a picture out: on the device (FLUX.2 klein, Z-Image Turbo or Stable Diffusion 1.5, downloaded once) or with your own key at one of 23 sources, among them OpenAI, Google, Replicate, fal.ai and a ComfyUI or AUTOMATIC1111 server on your desk. A finished picture can go straight to the background remover. Every request shows in Settings → Privacy, and Offline mode refuses them.",
      "Settings → Intelligence gained an Images card: which models are installed, where pictures come from, your keys.",
      "The site's download button now always leads to the newest installer.",
    ],
  },
  {
    version: "0.3.2",
    date: "2026-09-18",
    title: "dictate is the free tool",
    notes: [
      "Free is now dictate - the hotkey, the pill, live captions, its models - and the quick file tools. Every other tool comes with the Pro key: focus, screeni, capture and board join meet, social, disk and launch.",
      "Nothing is deleted by the change: tasks, notes, boards, recordings and screenshots made before stay on the computer, untouched, and open again with a key.",
      "Without a key the bar still dictates; Record, Focus, Meeting and Screenshot lead to the plans, and so do the screenshot shortcut and the tray's items. Time tracking and the scroll guard stay off while focus is locked.",
    ],
  },
  {
    version: "0.3.1",
    date: "2026-09-18",
    title: "free and Pro",
    notes: [
      "owntools Pro now holds four tools: meet, social, disk and launch. dictate, screeni, focus, board, capture and the twelve quick file tools stay free, and exported videos keep their small badge without a key.",
      "A Pro tool without a key shows what it does and two ways forward - get a key, or paste the one you have - instead of itself. Activating a key opens the tool on the spot; the hub marks the four with a pro tag.",
      "For agents: the local social API still answers every read without a key and refuses changes with a plain message saying why.",
    ],
  },
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
