"use client";

import { useState } from "react";

const ITEMS = [
  {
    q: "What exactly is in the app?",
    a: "Four tools behind one hub: focus (deep-work desktop with tasks, notebook, habits and a time heatmap), screeni (screen recordings that auto-zoom on your cursor, with an editor and MP4 export), launch (paste a URL, get a product launch video) and dictate (hold a hotkey, speak, and on-device Whisper types for you in any app).",
  },
  {
    q: "Is my data really local?",
    a: "Yes. No accounts, no telemetry, no cloud rendering. Recordings, notes and stats live in files on your disk. Speech recognition runs on your CPU via whisper.cpp — audio never leaves the machine.",
  },
  {
    q: "What's the difference between free and Pro?",
    a: "Nothing except a small \"made with shipshape\" badge on exported videos. Every feature is in the free version. A one-time Pro key removes the badge forever.",
  },
  {
    q: "Which platforms?",
    a: "Windows 10/11 today; macOS is in active development from the same codebase. It's a light native app (Tauri), not Electron and not a browser tab.",
  },
  {
    q: "Do I need ffmpeg or any setup?",
    a: "No. Videos render on-device frame by frame (WebCodecs) straight to MP4 with audio. Dictation downloads its engine and model once (~150 MB) and then works fully offline.",
  },
];

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <div className="mx-auto max-w-2xl divide-y divide-line">
      {ITEMS.map((item, i) => {
        const isOpen = open === i;
        return (
          <div key={item.q}>
            <button
              className="flex w-full items-center justify-between gap-4 py-5 text-left text-lg font-semibold tracking-[-0.03em]"
              onClick={() => setOpen(isOpen ? null : i)}
              aria-expanded={isOpen}
            >
              {item.q}
              <span className="text-muted">{isOpen ? "–" : "+"}</span>
            </button>
            {isOpen ? <p className="pb-5 text-[15px] leading-7 text-muted">{item.a}</p> : null}
          </div>
        );
      })}
    </div>
  );
}
