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
    a: "Eight tools behind one hub: dictate (press a hotkey, speak, press again - an on-device model types for you in any app while you are still talking - plus transcription of any audio or video file and a live caption overlay), screeni (screen recordings that auto-zoom on your cursor, with an editor where the transcript is a second timeline, subtitles, chapters, short clips and MP4 export), meet (record any call on this machine - mic and system audio - with a live transcript that tells you from them, your notes, and a summary with decisions and to-dos at the end), focus (a quiet desk with a timer, tasks, a notebook, habits and a time heatmap), launch (paste a URL, get a short video out of it), board (an endless whiteboard: paste screenshots, sketch, boxes and arrows - every board is a file on your disk, exported as PNG or SVG when you want it), disk (see what is actually filling your drive as a treemap, find duplicates and leftovers, and send what you pick to the Recycle Bin) and social (a calendar that schedules posts to your networks from this machine, with a local API and MCP server so AI agents can plan and queue posts that wait for your approval).",
  },
  {
    q: "Does meet join my calls?",
    a: "No. Nothing joins the call and nothing is uploaded. meet listens to what your machine plays through the speakers and to your microphone, on this machine, and writes both down - the mic is \"you\", the speakers are \"them\". It works with any call that makes a sound here: Zoom, Meet, Teams, a lecture in a browser tab. Nobody on the other side sees a bot, and the recording, the transcript and the notes are files in a folder on your disk.",
  },
  {
    q: "What does the on-device model need?",
    a: "Room and patience, honestly. The recommended model is a 2.5 GB download and wants about 4 GB of free RAM while it answers; a lighter one is there for a laptop with 8 GB. It runs on your CPU, so the first answer takes a moment - a summary of an hour-long call is written in chunks and takes longer than a tweet. Everything it produces - meeting summaries, chapters, post variants, dictation formatting - is made here. A cloud key of your own is optional and off by default; if you add one, the Privacy card shows every request it makes and what it was for.",
  },
  {
    q: "How do I know nothing leaves?",
    a: "Look at the receipt. Settings → Privacy lists this month's network requests: every host, what it was for, bytes out and bytes in, and a plain list of what never leaves this device - your voice, your screen, your files, your keys. The only traffic you will find there is what you asked for: a model download, an update check, the post you scheduled. Offline mode refuses all of it, and the app keeps working, because nothing here needs a server.",
  },
  {
    q: "Does sync need an account?",
    a: "No. Point owntools at a folder that another app already syncs - Dropbox, OneDrive, iCloud Drive, Syncthing, anything that puts the same folder on two machines - and your dictionary, history, boards, meetings, automations and looks follow you. Audio, recordings and credentials never sync; those stay on the machine that made them. There is no owntools server in between and nothing to sign into.",
  },
  {
    q: "Which social networks work today?",
    a: "Live now, with a password, a token or a webhook: Bluesky, Mastodon (any instance), Telegram, Discord, Slack, Dev.to and Medium. X and LinkedIn work with your own free developer app - you paste the app's keys once and sign in with the browser. Threads, Instagram, Facebook, Reddit, Pinterest, TikTok, YouTube and about twenty others are in the catalogue as “bring your own app” or “coming soon”: you can save keys for them, but publishing arrives in later builds. Everything publishes from your machine while owntools runs in the tray; there is no owntools server in between.",
  },
  {
    q: "Is my data really local?",
    a: "Yes. No accounts, no telemetry, no cloud rendering. Recordings, notes, boards, meetings, scheduled posts and the keys to your social accounts live in files on your disk. Speech recognition and the language model run on your CPU - audio never leaves the machine. The only outbound traffic is what you asked for - a model download, an update check, the post you scheduled - and Settings → Privacy lists each one.",
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
    a: "Windows 10/11 and macOS 11 or newer - one codebase, one licence, one universal Mac build for both Apple Silicon and Intel. It's a light native app - a few megabytes, not a browser wearing a trench coat. Recording calls with meet is Windows first; the Mac build gets it later.",
  },
  {
    q: "Do I need any setup?",
    a: "No. Install it and it works - there is nothing to sign up for and nothing else to install alongside it. The first time you use dictation it fetches its speech model once (about 575 MB, or a smaller one if your machine is older); the language model is a second one-click download, and optional. After that it runs with the wi-fi off. Saving a video needs nothing extra either.",
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
