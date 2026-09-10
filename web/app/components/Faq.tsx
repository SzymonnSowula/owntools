"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

const ITEMS: { q: string; a: ReactNode }[] = [
  {
    q: "Who is it for?",
    a: "Anyone whose work happens on a screen. It was built for people who talk faster than they type, sit on hours of recordings, have to show something to someone who isn't in the room, or just need a quiet hour - students, teachers, writers, support and sales folks, researchers, developers, parents doing admin. No job title required.",
  },
  {
    q: "What exactly is in the app?",
    a: "Seven tools behind one hub: dictate (press a hotkey, speak, press again - on-device Whisper types for you in any app - plus transcription of any audio or video file), screeni (screen recordings that auto-zoom on your cursor, with an editor, subtitles and MP4 export), focus (a quiet desk with a timer, tasks, a notebook, habits and a time heatmap), launch (paste a URL, get a short video out of it), board (an endless whiteboard: paste screenshots, sketch, boxes and arrows - every board is a file on your disk, exported as PNG or SVG when you want it), social (a calendar that schedules posts to your networks from this machine, with a local API and MCP server so AI agents can plan and queue posts for you to review) and disk (see what is actually filling your drive as a treemap, find duplicates and leftovers, and send what you pick to the Recycle Bin).",
  },
  {
    q: "Which social networks work today?",
    a: "Live now, with a password, a token or a webhook: Bluesky, Mastodon (any instance), Telegram, Discord, Slack, Dev.to and Medium. X and LinkedIn work with your own free developer app - you paste the app's keys once and sign in with the browser. Threads, Instagram, Facebook, Reddit, Pinterest, TikTok, YouTube and about twenty others are in the catalogue as “bring your own app” or “coming soon”: you can save keys for them, but publishing arrives in later builds. Everything publishes from your machine while owntools runs in the tray; there is no owntools server in between.",
  },
  {
    q: "Is my data really local?",
    a: "Yes. No accounts, no telemetry, no cloud rendering. Recordings, notes, boards, scheduled posts and the keys to your social accounts live in files on your disk. Speech recognition runs on your CPU via whisper.cpp - audio never leaves the machine. The only outbound traffic is the post you scheduled, sent straight to the network you chose.",
  },
  {
    q: "What's the difference between free and Pro?",
    a: "Nothing except a small \"made with owntools\" badge on exported videos. Every feature is in the free version. A one-time Pro key removes the badge forever.",
  },
  {
    q: "How does the Pro key work?",
    a: (
      <>
        It’s an offline license key: paste it into the app once and the badge is gone. No account,
        no activation server, nothing to log into - the key is checked on your machine, so it keeps
        working with the wi-fi off. Use it on the devices you own. If it isn’t for you, there’s a
        14-day, no-questions-asked{" "}
        <a href="/refunds" className="font-semibold text-accent underline underline-offset-4">
          refund
        </a>
        .
      </>
    ),
  },
  {
    q: "Which platforms?",
    a: "Windows 10/11 and macOS 11 or newer - one codebase, one licence, one universal Mac build for both Apple Silicon and Intel. It's a light native app - a few megabytes, not a browser wearing a trench coat.",
  },
  {
    q: "Do I need any setup?",
    a: "No. Install it and it works - there is nothing to sign up for and nothing else to install alongside it. The first time you use dictation it fetches its speech model once (about 575 MB, or a smaller one if your machine is older); after that it runs with the wi-fi off. Saving a video needs nothing extra either.",
  },
];

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <div className="divide-y divide-line border-t border-line">
      {ITEMS.map((item, i) => {
        const isOpen = open === i;
        return (
          <div key={item.q}>
            <button
              className="flex w-full items-center justify-between gap-4 py-5 text-left text-lg font-semibold tracking-[-0.03em] transition hover:text-accent"
              onClick={() => setOpen(isOpen ? null : i)}
              aria-expanded={isOpen}
            >
              {item.q}
              <ChevronDown
                size={18}
                className={`shrink-0 text-muted transition-transform duration-300 ${isOpen ? "rotate-180" : ""}`}
              />
            </button>
            {isOpen ? <p className="pb-5 text-[15px] leading-7 text-muted">{item.a}</p> : null}
          </div>
        );
      })}
    </div>
  );
}
