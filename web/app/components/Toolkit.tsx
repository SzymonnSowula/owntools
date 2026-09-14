"use client";

import { useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  AudioLines,
  BarChart3,
  Clapperboard,
  Captions,
  Crop,
  FileAudio,
  FileText,
  Film,
  Languages,
  LayoutTemplate,
  Link as LinkIcon,
  ListChecks,
  Mic,
  Music,
  Palette,
  Scissors,
  Shapes,
  Subtitles,
  Timer,
  Users,
  ZoomIn,
} from "lucide-react";

/**
 * "the owntools toolkit" — capabilities browsed by job (voice / media /
 * create / focus), yaps.ai-style layout: numbered tinted cards with mini
 * mockups in a right-bleeding row and a counter + arrows strip. Every card
 * carries its own hue (Apple system colors). The featured-capability banner
 * under the row repeated the first card word for word and went on 2026-09-14.
 */

/* tints — Apple system hues; used only as card washes in this section */
const BLUE = "var(--color-accent)";
const INDIGO = "var(--color-indigo)";
const CYAN = "var(--color-cyan)";
const ORANGE = "#ff9f0a";
const GREEN = "#30d158";
const PINK = "#ff375f";

/* ---------------------------- tiny mockups ---------------------------- */

function MockShell({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-line bg-card/70 p-3">{children}</div>;
}

function ListeningMock() {
  return (
    <MockShell>
      <div className="flex items-center gap-2 rounded-full bg-[#0b0b0d] px-3 py-2">
        <span className="rec-dot h-2 w-2 rounded-full bg-[#ff453a]" />
        <span className="text-[10px] font-semibold text-white">listening…</span>
        <span className="ml-auto font-mono text-[9px] text-white/50">ctrl+shift+space</span>
      </div>
      <div className="mt-2.5 rounded-lg border border-line px-2.5 py-1.5">
        <p className="text-[8px] font-bold uppercase tracking-[0.14em] text-muted">cursor</p>
        <p className="text-[11px]">the next clear thought lands right here.<span className="animate-pulse">|</span></p>
      </div>
    </MockShell>
  );
}

function VaultMock() {
  return (
    <MockShell>
      <div className="flex items-center justify-between rounded-lg border border-line px-2.5 py-1.5">
        <span className="flex items-center gap-1.5 text-[10px] font-bold">
          <AudioLines size={11} className="text-(--tint)" /> quick note
        </span>
        <span className="font-mono text-[9px] text-muted">01:24</span>
      </div>
      <p className="mt-2 text-[11px] font-bold">launch notes</p>
      <div className="mt-1.5 space-y-1.5">
        <div className="h-1.5 w-4/5 rounded bg-line" />
        <div className="h-1.5 w-3/5 rounded bg-line" />
      </div>
      <div className="mt-2 flex gap-1">
        {["text", "checklist", "board"].map((c) => (
          <span key={c} className="rounded border border-line px-1.5 py-0.5 font-mono text-[8px] text-muted">{c}</span>
        ))}
      </div>
    </MockShell>
  );
}

function MeetingsMock() {
  return (
    <MockShell>
      <div className="flex items-center gap-1">
        <span className="h-1.5 flex-[3] rounded-full bg-gradient-to-r from-cyan to-accent opacity-70" />
        <span className="h-1.5 flex-[2] rounded-full bg-gradient-to-r from-cyan to-accent opacity-50" />
        <span className="h-1.5 flex-[3] rounded-full bg-gradient-to-r from-cyan to-accent opacity-70" />
        <span className="ml-1 font-mono text-[9px] text-muted">42:18</span>
      </div>
      {[
        ["them", "00:12", "can we lock the pricing this week?"],
        ["you", "00:19", "yes - one price, paid once."],
      ].map(([who, at, line]) => (
        <div key={at} className="mt-1.5 flex items-center gap-2 rounded-lg border border-line px-2 py-1.5">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-line font-mono text-[8px] uppercase">{who}</span>
          <div>
            <p className="font-mono text-[8px] uppercase text-muted">{who} · {at}</p>
            <p className="text-[10px]">{line}</p>
          </div>
        </div>
      ))}
    </MockShell>
  );
}

function TranscribeMock() {
  return (
    <MockShell>
      <div className="flex items-center justify-between rounded-lg border border-line px-2.5 py-1.5">
        <span className="font-mono text-[10px] font-semibold">field-interview.mp4</span>
        <span className="font-mono text-[9px] text-muted">18:42</span>
      </div>
      <p className="my-1.5 text-center font-mono text-[8px] uppercase tracking-[0.18em] text-muted">- local engine -</p>
      <div className="flex items-center justify-between rounded-lg border border-(--tint)/30 bg-(--tint)/5 px-2.5 py-1.5">
        <div>
          <p className="text-[10px] font-bold">reviewable transcript</p>
          <p className="font-mono text-[8px] text-muted">timed text · ready to export</p>
        </div>
        <span>✓</span>
      </div>
    </MockShell>
  );
}

function RecordMock() {
  return (
    <div className="overflow-hidden rounded-xl border border-line">
      <div
        className="h-[74px]"
        style={{
          background:
            "radial-gradient(60px 44px at 25% 30%, #0a84ff, transparent 70%), radial-gradient(66px 50px at 78% 35%, #5e5ce6, transparent 70%), #101a2e",
        }}
      >
        <div className="relative left-[20%] top-[24%] h-[52%] w-[58%] rounded border border-white/25 bg-white/90 shadow-lg" />
      </div>
      <p className="flex items-center gap-1.5 bg-[#101012] px-3 py-2 text-[10px] font-semibold text-white/80">
        <span className="rec-dot h-1.5 w-1.5 rounded-full bg-[#ff453a]" /> REC 00:12 · auto-zoom on
      </p>
    </div>
  );
}

function SrtMock() {
  return (
    <MockShell>
      <div className="flex items-center justify-between rounded-lg border border-line px-2.5 py-1">
        <span className="font-mono text-[10px] font-semibold">interview.srt</span>
        <span className="font-mono text-[8px] text-muted">utf-8</span>
      </div>
      {[
        ["14", "00:18,240 → 00:21,880", "keep the source close while you edit."],
        ["15", "00:22,010 → 00:24,430", "export when every line is ready."],
      ].map(([n, time, line]) => (
        <div key={n} className="mt-1.5 flex gap-2">
          <span className="font-mono text-[9px] text-(--tint)">{n}</span>
          <div>
            <p className="font-mono text-[8px] text-muted">{time}</p>
            <p className="text-[10px]">{line}</p>
          </div>
        </div>
      ))}
    </MockShell>
  );
}

function BigCaptionMock() {
  return (
    <MockShell>
      <div className="relative h-16 overflow-hidden rounded-lg" style={{ background: "radial-gradient(50px 40px at 50% 30%, color-mix(in srgb, var(--tint) 55%, transparent), #16161b)" }}>
        <span className="absolute bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-black/80 px-2 py-1 text-[9px] font-extrabold uppercase tracking-wide text-white">
          make every <span className="text-(--tint)">word</span> land
        </span>
      </div>
      <div className="mt-2 flex items-center gap-1">
        <span className="h-1.5 flex-1 rounded-full bg-(--tint)/25" />
        <span className="h-1.5 flex-1 rounded-full bg-(--tint)/50" />
        <span className="h-1.5 flex-1 rounded-full bg-(--tint)/25" />
        <span className="ml-1 font-mono text-[8px] uppercase text-muted">mp4</span>
      </div>
    </MockShell>
  );
}

function SilenceMock() {
  const bars = [6, 12, 9, 14, 8, 3, 2, 2, 3, 11, 15, 9, 13, 7];
  return (
    <MockShell>
      <div className="flex h-10 items-center gap-[3px]">
        {bars.map((h, i) => {
          const cut = i >= 5 && i <= 8;
          return (
            <span
              key={i}
              className={`w-[5px] rounded-full ${cut ? "bg-[#ff453a]/35" : "bg-(--tint)"}`}
              style={{ height: `${h * 2.4}px` }}
            />
          );
        })}
      </div>
      <p className="mt-1.5 text-[10px] font-medium text-muted">✓ 2 pauses removed · source kept</p>
    </MockShell>
  );
}

function ExtractMock() {
  const bars = [4, 8, 12, 7, 10, 5, 9, 13, 6];
  return (
    <MockShell>
      <div className="flex items-center gap-2">
        <span className="rounded border border-line px-2 py-1 font-mono text-[9px] font-semibold">demo-take.mp4</span>
        <ArrowRight size={11} className="shrink-0 text-(--tint)" />
        <span className="rounded border border-(--tint)/40 bg-(--tint)/10 px-2 py-1 font-mono text-[9px] font-semibold">demo-take.mp3</span>
      </div>
      <div className="mt-2 flex h-6 items-center gap-[3px]">
        {bars.map((h, i) => (
          <span key={i} className="w-[4px] rounded-full bg-(--tint)/60" style={{ height: `${h * 1.6}px` }} />
        ))}
      </div>
    </MockShell>
  );
}

function FormatsMock() {
  return (
    <MockShell>
      <div className="flex items-end gap-2">
        <div className="flex h-12 w-7 items-end justify-center rounded border border-(--tint)/50 bg-(--tint)/10 pb-0.5 text-[8px] font-bold">9:16</div>
        <div className="flex h-10 w-10 items-end justify-center rounded border border-line pb-0.5 text-[8px] font-bold text-muted">1:1</div>
        <div className="flex h-9 w-14 items-end justify-center rounded border border-line pb-0.5 text-[8px] font-bold text-muted">16:9</div>
        <span className="mb-0.5 ml-1 h-6 w-6 rounded-full border-2 border-white bg-gradient-to-br from-accent to-indigo shadow" />
      </div>
      <p className="mt-2 text-[10px] font-medium text-muted">every aspect + camera bubble</p>
    </MockShell>
  );
}

function BoardMock() {
  return (
    <MockShell>
      <svg viewBox="0 0 180 64" className="block h-16 w-full" fill="none" aria-hidden>
        <rect x="4" y="6" width="52" height="34" rx="4" fill="var(--tint)" fillOpacity="0.9" />
        <rect x="10" y="13" width="28" height="4" rx="2" fill="#fff" fillOpacity="0.9" />
        <rect x="10" y="22" width="38" height="3" rx="1.5" fill="#fff" fillOpacity="0.55" />
        <path d="M60 23 C 72 23, 74 18, 86 18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M81 14 L 87 18 L 81 22" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="92" y="6" width="80" height="26" rx="7" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="132" cy="52" r="9" stroke="var(--tint)" strokeWidth="1.6" />
        <path d="M132 33 L 132 41" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <p className="mt-1 text-[10px] font-medium text-muted">ctrl+v a screenshot, draw around it</p>
    </MockShell>
  );
}

function CaptureMock() {
  return (
    <div className="relative h-[84px] overflow-hidden rounded-xl border border-line bg-[#0f1424]">
      <div className="absolute left-[8%] top-[14%] h-[48%] w-[46%] rounded border border-white/20 bg-white/25" />
      <div className="absolute left-[42%] top-[34%] h-[50%] w-[50%] rounded border border-white/20 bg-white/30" />
      <div className="absolute left-[38%] top-[28%] h-[52%] w-[52%] rounded-[4px] border-2 border-dashed border-white bg-white shadow-[0_0_0_999px_rgba(15,20,36,0.5)]">
        <span className="absolute left-1.5 top-1.5 h-1 w-2/3 rounded bg-[#1d1d1f]/30" />
        <span className="absolute left-1.5 top-[40%] h-[28%] w-[55%] rounded-[2px] border-[1.5px] border-[#ff453a]" />
        <span className="absolute bottom-1 right-1 flex h-3 w-3 items-center justify-center rounded-full bg-[#ff453a] text-[6px] font-bold text-white">1</span>
      </div>
      <span className="absolute bottom-1.5 left-1.5 rounded bg-white/95 px-1.5 py-0.5 font-mono text-[7.5px] text-[#1d1d1f]">
        text copied · Invoice 2026-041
      </span>
    </div>
  );
}

function UrlMock() {
  return (
    <MockShell>
      <div className="flex items-center gap-2 rounded-full border border-line bg-paper px-3 py-1.5">
        <span className="font-mono text-[10px] text-muted">https://</span>
        <span className="font-mono text-[10px] font-semibold">yourapp.com</span>
        <span className="ml-auto flex h-5 w-5 items-center justify-center rounded-full bg-(--tint) text-white">
          <ArrowRight size={10} />
        </span>
      </div>
      <p className="mt-2 text-[10px] font-medium text-muted">name, tagline & colors - detected</p>
    </MockShell>
  );
}

function TemplatesMock() {
  return (
    <MockShell>
      <div className="flex gap-2">
        <div className="flex h-14 flex-1 flex-col items-center justify-center rounded border border-(--tint)/50 bg-(--tint)/10">
          <span className="display text-[9px] font-extrabold">keynote</span>
          <span className="mt-0.5 h-0.5 w-5 rounded bg-(--tint)" />
        </div>
        <div className="flex h-14 flex-1 items-center justify-center rounded border border-line">
          <span className="h-6 w-8 rounded-sm border border-line bg-card shadow-sm" />
        </div>
        <div className="relative h-14 flex-1 rounded border border-line">
          <span className="absolute left-1.5 top-2 h-4 w-5 rotate-[-6deg] rounded-sm border border-line bg-card shadow-sm" />
          <span className="absolute right-1.5 top-4 h-4 w-5 rotate-[5deg] rounded-sm border border-line bg-card shadow-sm" />
        </div>
      </div>
      <p className="mt-2 text-[10px] font-medium text-muted">6 style packs</p>
    </MockShell>
  );
}

function BrandMock() {
  return (
    <MockShell>
      <div className="flex items-center gap-1.5">
        <span className="h-5 w-5 rounded-full bg-accent" />
        <span className="h-5 w-5 rounded-full bg-indigo" />
        <span className="h-5 w-5 rounded-full bg-cyan" />
        <span className="h-5 w-5 rounded-full border border-line bg-[#1d1d1f]" />
        <span className="ml-2 rounded bg-(--tint)/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold">#0a84ff</span>
      </div>
      <p className="mt-2 text-[10px] font-medium text-muted">brand color pulled from your page</p>
    </MockShell>
  );
}

function RenderMock() {
  return (
    <MockShell>
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] font-semibold">yourapp-launch.mp4</span>
        <span className="rounded bg-[#30d158]/15 px-1.5 py-0.5 text-[9px] font-bold text-[#30d158]">1080p60</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
        <div className="h-full w-[72%] rounded-full bg-(--tint)" />
      </div>
      <p className="mt-1.5 text-[10px] font-medium text-muted">rendering on your machine - no upload</p>
    </MockShell>
  );
}

function TranslateMock() {
  return (
    <MockShell>
      <div className="flex items-stretch gap-2">
        <div className="flex-1 rounded-lg border border-line p-2">
          <p className="font-mono text-[8px] uppercase text-muted">pl</p>
          <p className="mt-1 text-[10px]">mów po swojemu.</p>
        </div>
        <ArrowRight size={11} className="shrink-0 self-center text-(--tint)" />
        <div className="flex-1 rounded-lg border border-(--tint)/40 bg-(--tint)/10 p-2">
          <p className="font-mono text-[8px] uppercase text-muted">en</p>
          <p className="mt-1 text-[10px]">read it in english.</p>
        </div>
      </div>
      <p className="mt-2 text-center font-mono text-[8px] uppercase tracking-[0.14em] text-muted">meaning preserved</p>
    </MockShell>
  );
}

function TimerMock() {
  return (
    <MockShell>
      <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted">deep focus</p>
      <p className="display mt-0.5 text-3xl">25:00</p>
      <div className="mt-2 flex gap-1.5">
        <span className="rounded-full bg-(--tint) px-2.5 py-0.5 text-[10px] font-semibold text-white">Start</span>
        <span className="rounded-full border border-line px-2.5 py-0.5 text-[10px] font-semibold text-muted">Reset</span>
      </div>
    </MockShell>
  );
}

function TasksMock() {
  const rows: [string, boolean][] = [
    ["send the invoice", true],
    ["record the walkthrough", false],
    ["reply to three emails", false],
  ];
  return (
    <MockShell>
      <div className="space-y-2">
        {rows.map(([t, done]) => (
          <div key={t} className="flex items-center gap-2">
            <span
              className={`flex h-3.5 w-3.5 items-center justify-center rounded border text-[8px] ${
                done ? "border-(--tint) bg-(--tint) text-white" : "border-line"
              }`}
            >
              {done ? "✓" : ""}
            </span>
            <span className={`text-[11px] ${done ? "text-muted line-through" : ""}`}>{t}</span>
          </div>
        ))}
      </div>
    </MockShell>
  );
}

function NotesMock() {
  return (
    <MockShell>
      <p className="text-[11px] font-bold">launch notes</p>
      <div className="mt-2 space-y-1.5">
        <div className="h-1.5 w-4/5 rounded bg-line" />
        <div className="h-1.5 w-3/5 rounded bg-line" />
        <div className="h-1.5 w-2/3 rounded bg-line" />
      </div>
      <span className="mt-2.5 inline-block rounded bg-(--tint)/10 px-1.5 py-0.5 text-[10px] font-semibold">
        [[launch plan]] · 3 backlinks
      </span>
    </MockShell>
  );
}

function HeatmapMock() {
  const cells = [3, 6, 2, 8, 5, 1, 7, 4, 9, 3, 6, 8, 2, 5, 7, 1, 4, 8, 6, 3, 9];
  return (
    <MockShell>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((v, i) => (
          <span key={i} className="aspect-square rounded-[3px] bg-(--tint)" style={{ opacity: 0.12 + v * 0.09 }} />
        ))}
      </div>
      <p className="mt-2 text-[9px] font-medium uppercase tracking-[0.12em] text-muted">where the hours went</p>
    </MockShell>
  );
}

/* ------------------------------- data ------------------------------- */

type JobKey = "voice" | "media" | "create" | "focus";

type Card = { title: string; tags: string; desc: string; tint: string; icon: ReactNode; mock: ReactNode };

const TOOLKIT: Record<
  JobKey,
  {
    strip: string;
    cards: Card[];
  }
> = {
  voice: {
    strip: "voice in, text out",
    cards: [
      {
        title: "desktop dictation",
        tags: "any app",
        desc: "Speak, and it types where your cursor is.",
        tint: ORANGE,
        icon: <Mic size={15} />,
        mock: <ListeningMock />,
      },
      {
        title: "voice notes",
        tags: "capture · organise · revisit",
        desc: "Catch the idea before it slips away.",
        tint: GREEN,
        icon: <AudioLines size={15} />,
        mock: <VaultMock />,
      },
      {
        title: "meetings, live",
        tags: "who said what",
        desc: "Any call, transcribed as it happens.",
        tint: CYAN,
        icon: <Users size={15} />,
        mock: <MeetingsMock />,
      },
      {
        title: "file transcription",
        tags: "audio or video",
        desc: "Drop in a file, get the text.",
        tint: BLUE,
        icon: <FileAudio size={15} />,
        mock: <TranscribeMock />,
      },
      {
        title: "screen recording",
        tags: "auto-zoom · camera",
        desc: "Your screen, filmed like a real demo.",
        tint: INDIGO,
        icon: <ZoomIn size={15} />,
        mock: <RecordMock />,
      },
    ],
  },
  media: {
    strip: "caption, cut and convert",
    cards: [
      {
        title: "subtitles",
        tags: "audio or video · srt",
        desc: "Timed captions you can review line by line.",
        tint: INDIGO,
        icon: <Subtitles size={15} />,
        mock: <SrtMock />,
      },
      {
        title: "auto captions",
        tags: "styled · finished mp4",
        desc: "Every spoken word, visible on screen.",
        tint: PINK,
        icon: <Captions size={15} />,
        mock: <BigCaptionMock />,
      },
      {
        title: "auto cut",
        tags: "pauses · dead air",
        desc: "Pauses are cut out for you.",
        tint: ORANGE,
        icon: <Scissors size={15} />,
        mock: <SilenceMock />,
      },
      {
        title: "video → audio",
        tags: "extract the track",
        desc: "Pull the sound out of any video file.",
        tint: GREEN,
        icon: <Music size={15} />,
        mock: <ExtractMock />,
      },
      {
        title: "every format",
        tags: "9:16 · 1:1 · 16:9",
        desc: "Record once, publish everywhere.",
        tint: CYAN,
        icon: <Film size={15} />,
        mock: <FormatsMock />,
      },
    ],
  },
  create: {
    strip: "think it through, announce it loudly",
    cards: [
      {
        title: "whiteboard",
        tags: "endless canvas · screenshots",
        desc: "Boxes, arrows and screenshots, saved as files.",
        tint: BLUE,
        icon: <Shapes size={15} />,
        mock: <BoardMock />,
      },
      {
        title: "screenshots that read",
        tags: "ctrl+shift+4 · mark up · ocr",
        desc: "Mark up a screenshot and copy its text.",
        tint: CYAN,
        icon: <Crop size={15} />,
        mock: <CaptureMock />,
      },
      {
        title: "url → video",
        tags: "paste a link",
        desc: "Paste a link, get a launch video.",
        tint: INDIGO,
        icon: <LinkIcon size={15} />,
        mock: <UrlMock />,
      },
      {
        title: "keynote templates",
        tags: "6 styles",
        desc: "Big type, product shots, floating windows.",
        tint: PINK,
        icon: <LayoutTemplate size={15} />,
        mock: <TemplatesMock />,
      },
      {
        title: "brand auto-detect",
        tags: "colors · logo · shot",
        desc: "Colors and logo, taken from your page.",
        tint: ORANGE,
        icon: <Palette size={15} />,
        mock: <BrandMock />,
      },
      {
        title: "offline render",
        tags: "webcodecs · 60 fps",
        desc: "Frame-accurate MP4, rendered on your device.",
        tint: CYAN,
        icon: <Clapperboard size={15} />,
        mock: <RenderMock />,
      },
      {
        title: "translation",
        tags: "99 languages",
        desc: "Speak any language, read it in English.",
        tint: GREEN,
        icon: <Languages size={15} />,
        mock: <TranslateMock />,
      },
    ],
  },
  focus: {
    strip: "plan, focus and review",
    cards: [
      {
        title: "fullscreen timer",
        tags: "timer · stopwatch",
        desc: "A timer that takes over the screen.",
        tint: BLUE,
        icon: <Timer size={15} />,
        mock: <TimerMock />,
      },
      {
        title: "tasks & day plan",
        tags: "one task a day",
        desc: "Pick the task that matters. Park the rest.",
        tint: GREEN,
        icon: <ListChecks size={15} />,
        mock: <TasksMock />,
      },
      {
        title: "linked notes",
        tags: "plain files · backlinks",
        desc: "Plain-file notes with backlinks.",
        tint: ORANGE,
        icon: <FileText size={15} />,
        mock: <NotesMock />,
      },
      {
        title: "screen-time heatmap",
        tags: "honest hours",
        desc: "See where the day actually went.",
        tint: INDIGO,
        icon: <BarChart3 size={15} />,
        mock: <HeatmapMock />,
      },
    ],
  },
};

const TABS: JobKey[] = ["voice", "media", "create", "focus"];

/* ------------------------------ component ------------------------------ */

export function Toolkit() {
  const [tab, setTab] = useState<JobKey>("voice");
  const scroller = useRef<HTMLDivElement>(null);
  const t = TOOLKIT[tab];

  const switchTab = (k: JobKey) => {
    setTab(k);
    scroller.current?.scrollTo({ left: 0 });
  };

  return (
    <div>
      {/* header: copy left, job switcher right */}
      <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-xl">
          <p className="kicker flex items-center gap-2 !text-indigo">
            <span className="h-1.5 w-1.5 rounded-full bg-indigo" /> 02 · the owntools toolkit
          </p>
          <h2 className="display mt-3 text-4xl md:text-5xl">
            everything you say,
            <br />
            show and share.
          </h2>
        </div>
        <div className="lg:pb-2 lg:text-right">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted">browse by job</p>
          <div className="mt-2.5 inline-flex rounded-full border border-line bg-card p-1 shadow-sm">
            {TABS.map((k) => (
              <button
                key={k}
                onClick={() => switchTab(k)}
                className={`rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition sm:px-4 ${
                  tab === k ? "bg-accent text-white shadow" : "text-muted hover:text-ink"
                }`}
              >
                {k}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* capability cards — start at the container's left edge, bleed out to
          the right viewport edge and emerge from a fog there */}
      <div className="relative mt-10" style={{ marginRight: "calc(50% - 50vw / var(--zoom))" }}>
        <div ref={scroller} className="toolkit-row flex snap-x gap-5 overflow-x-auto pr-32 md:pr-48">
          {t.cards.map((card, i) => (
            <div
              key={`${tab}-${card.title}`}
              className={`glow-card flex w-[300px] shrink-0 snap-start flex-col p-6 sm:w-[360px] ${i === 0 ? "toolkit-lead" : ""}`}
              style={{ ["--tint" as string]: card.tint }}
            >
              <div className="flex items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
                <span>0{i + 1}</span>
                <span className="ml-auto truncate">{card.tags}</span>
                <a
                  href="#tools"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line transition hover:border-(--tint)"
                  style={{ color: card.tint }}
                  aria-label={`more about ${card.title}`}
                >
                  <ArrowRight size={12} />
                </a>
              </div>
              <div className="mt-5 flex items-center gap-3">
                <span className="glow-icon">{card.icon}</span>
                <h3 className="display text-[19px]">{card.title}</h3>
              </div>
              <p className="mt-2.5 text-[14px] leading-6 text-muted">{card.desc}</p>
              <div className="mt-auto pt-8">{card.mock}</div>
            </div>
          ))}
        </div>
        <div className="toolkit-fog" aria-hidden />
      </div>

      {/* counter + arrows strip */}
      <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted">{t.strip}</span>
        <div className="flex items-center gap-3">
          <span className="hidden text-[10px] font-bold uppercase tracking-[0.18em] text-muted sm:block">
            0{t.cards.length} capabilities
          </span>
          <button
            onClick={() => scroller.current?.scrollBy({ left: -380, behavior: "smooth" })}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-line text-muted transition hover:border-accent/50 hover:text-ink"
            aria-label="scroll capabilities left"
          >
            <ArrowLeft size={14} />
          </button>
          <button
            onClick={() => scroller.current?.scrollBy({ left: 380, behavior: "smooth" })}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-line text-muted transition hover:border-accent/50 hover:text-ink"
            aria-label="scroll capabilities right"
          >
            <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
