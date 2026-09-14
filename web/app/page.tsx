import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Fragment, type CSSProperties, type ReactNode } from "react";
import { preload } from "react-dom";
import { ArrowDown, ArrowRight, Check, Sparkles } from "lucide-react";
import { Faq } from "./components/Faq";
import { Toolkit } from "./components/Toolkit";
import { ToolShowcase, type ShowcaseTool } from "./components/ToolShowcase";
import { Reveal } from "./components/Reveal";
import { ListeningPill, Pane, Scene } from "./components/Scene";
import { SpeedCompare } from "./components/SpeedCompare";
import { DictateAnywhere } from "./components/DictateAnywhere";
import { QuickTools } from "./components/QuickTools";
import { WhatsInside } from "./components/WhatsInside";
import { Intelligence } from "./components/Intelligence";
import { ThemeToggle } from "./components/ThemeToggle";
import { WinDots, ToolIcons } from "./components/WinDots";
import { SubscriptionBill } from "./components/SubscriptionBill";
import { CheckoutNotice } from "./components/pricing/CheckoutNotice";
import { LivePrice, LiveStepNote } from "./components/pricing/LivePrice";
import { PriceLadder } from "./components/pricing/PriceLadder";
import {
  CheckoutCta,
  DOWNLOAD_SOON,
  DownloadCta,
  MAC_DOWNLOAD_SOON,
  MacDownloadCta,
} from "./components/Cta";
import { imageSize } from "@/lib/imageSize";
import { polarConfig } from "@/lib/polar";
import { PRICE, checkoutUrl, contactEmail, downloadUrl, downloadUrlMac, repoUrl, xUrl } from "@/lib/site";

/* "get the pro key" goes through /checkout once Polar is configured - that
   route picks the launch-price step. Decided when the page is built, so set
   POLAR_ACCESS_TOKEN before the deploy, not after. */
const checkoutHref = polarConfig() ? "/checkout" : checkoutUrl;

/* The plain verb list from the brand rules: what the app does, never who is
   supposed to be doing it. */
const HERO_VERBS = ["dictate", "transcribe", "record", "meet", "take notes", "translate"];

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "owntools",
  operatingSystem: "Windows, macOS",
  applicationCategory: "MultimediaApplication",
  description:
    "Dictate, transcribe, record your screen and your calls, take notes and more. Eight tools in one desktop app that runs on your own device.",
  offers: [
    { "@type": "Offer", price: "0", priceCurrency: PRICE.currency, name: "Free (badge on exports)" },
    { "@type": "Offer", price: String(PRICE.amount), priceCurrency: PRICE.currency, name: "Pro (lifetime)" },
  ],
};

/* ---------------------------- tool media ---------------------------- */

/* A clip or screenshot of a tool doing its job, dropped into web/public/shots
   as <tool>.<ext> — mp4/webm wins over png/jpg/webp, and a shot with the same
   name as a clip becomes its poster. Nothing there yet? The row falls back to
   the drawn mockup below. Resolved at build time, so a new file needs a
   rebuild (`pnpm --dir web build`) — see docs/launch-video.md for the list. */
const SHOTS_DIR = join(process.cwd(), "public", "shots");

function shot(name: string): { video?: string; poster?: string; width?: number; height?: number } {
  const pick = (exts: string[]) =>
    exts.map((ext) => `${name}.${ext}`).find((file) => existsSync(join(SHOTS_DIR, file)));
  const video = pick(["mp4", "webm"]);
  const poster = pick(["png", "jpg", "jpeg", "webp"]);
  /* a still is served through next/image, which needs its real size */
  const size = poster ? imageSize(readFileSync(join(SHOTS_DIR, poster))) : null;
  return {
    ...(video ? { video: `/shots/${video}` } : {}),
    ...(poster ? { poster: `/shots/${poster}` } : {}),
    ...(size ?? {}),
  };
}

/* a first guess at a section's height for content-visibility (.cv in
   globals.css): phones, then lg and up */
const cv = (phone: number, wide: number) => ({ "--cv": `${phone}px`, "--cv-lg": `${wide}px` }) as CSSProperties;

/* ------------------------------ window mockups ------------------------------ */

function FocusCard() {
  return (
    <div className="wincard wincard--light floaty w-[210px]" style={{ ["--tilt" as string]: "-4deg" }}>
      <div className="wincard-bar">
        <WinDots icon={ToolIcons.focus} />
        <span className="wincard-title">focus.app</span>
      </div>
      <div className="p-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#6e6e73]">deep focus</p>
        <p className="display mt-1 text-4xl font-bold">25:00</p>
        <div className="mt-3 flex gap-1.5">
          <span className="rounded-full bg-accent px-3 py-1 text-[11px] font-semibold text-white">Start</span>
          <span className="rounded-full border border-[#1d1d1f]/15 px-3 py-1 text-[11px] font-semibold text-[#6e6e73]">Reset</span>
        </div>
      </div>
    </div>
  );
}

function ScreeniCard() {
  return (
    <div className="wincard wincard--light floaty w-[250px]" style={{ ["--tilt" as string]: "3deg", animationDelay: "-2s" }}>
      <div className="wincard-bar">
        <WinDots icon={ToolIcons.video} />
        <span className="wincard-title">demo-take.mp4</span>
      </div>
      <div className="bg-[#101012] p-3">
        <div
          className="h-[110px] rounded-[8px]"
          style={{
            background:
              "radial-gradient(80px 60px at 25% 25%, #0a84ff, transparent 70%), radial-gradient(90px 70px at 80% 30%, #5e5ce6, transparent 70%), radial-gradient(90px 60px at 55% 85%, #32ade6, transparent 70%), #101a2e",
          }}
        >
          <div className="relative left-[18%] top-[22%] h-[60%] w-[64%] rounded-[6px] border border-white/20 bg-white/90 shadow-xl" />
        </div>
        <p className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-white/80">
          <span className="rec-dot inline-block h-2 w-2 rounded-full bg-[#ff453a]" /> REC 00:12 · auto-zoom on
        </p>
      </div>
    </div>
  );
}

function LaunchCard() {
  return (
    <div className="wincard wincard--light floaty w-[230px]" style={{ ["--tilt" as string]: "-2.5deg", animationDelay: "-4s" }}>
      <div className="wincard-bar">
        <WinDots icon={ToolIcons.launch} />
        <span className="wincard-title">yourapp-launch.mp4</span>
      </div>
      <div className="p-5 text-center" style={{ background: "radial-gradient(rgba(29,29,31,0.1) 1px, transparent 1px) 0 0 / 18px 18px, #fff" }}>
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6e6e73]">introducing</p>
        <p className="display mt-1 text-2xl font-extrabold">yourapp</p>
        <span className="mt-3 inline-block h-1.5 w-10 rounded-full bg-accent" />
      </div>
    </div>
  );
}

function BoardCard() {
  return (
    <div className="wincard wincard--light floaty w-[230px]" style={{ ["--tilt" as string]: "2.5deg", animationDelay: "-3s" }}>
      <div className="wincard-bar">
        <WinDots icon={ToolIcons.board} />
        <span className="wincard-title">board.app</span>
      </div>
      <div className="p-4" style={{ background: "radial-gradient(rgba(29,29,31,0.1) 1px, transparent 1px) 0 0 / 14px 14px, #fff" }}>
        <svg viewBox="0 0 200 104" className="block h-[104px] w-full" fill="none" aria-hidden>
          {/* a pasted screenshot */}
          <rect x="8" y="10" width="78" height="52" rx="5" fill="#0a84ff" />
          <rect x="16" y="20" width="44" height="6" rx="3" fill="#fff" fillOpacity="0.9" />
          <rect x="16" y="32" width="60" height="4" rx="2" fill="#fff" fillOpacity="0.55" />
          <rect x="16" y="41" width="50" height="4" rx="2" fill="#fff" fillOpacity="0.55" />
          {/* a hand-drawn box + arrow + circle around it */}
          <rect x="112" y="14" width="76" height="34" rx="9" stroke="#1d1d1f" strokeWidth="2" />
          <path d="M90 36 C 100 36, 102 31, 110 31" stroke="#1d1d1f" strokeWidth="2" strokeLinecap="round" />
          <path d="M105 27 L 111 31 L 105 35" stroke="#1d1d1f" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="150" cy="80" r="14" stroke="#ff9f0a" strokeWidth="2" />
          <path d="M150 50 L 150 64" stroke="#1d1d1f" strokeWidth="2" strokeLinecap="round" />
          <path d="M146 60 L 150 65 L 154 60" stroke="#1d1d1f" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <text x="150" y="35" textAnchor="middle" fontSize="10" fontWeight="600" fill="#1d1d1f" fontFamily="ui-sans-serif, system-ui">why this?</text>
          <text x="40" y="86" fontSize="9" fill="#6e6e73" fontFamily="ui-sans-serif, system-ui">ctrl+v · saved on disk</text>
        </svg>
      </div>
    </div>
  );
}

function SocialCard() {
  const days = ["mon", "tue", "wed", "thu", "fri"];
  const posts: { d: number; top: number; tag: string; text: string; badge: string }[] = [
    { d: 0, top: 6, tag: "#ff375f", text: "new build is out…", badge: "#0085ff" },
    { d: 1, top: 34, tag: "#5e5ce6", text: "small daily workouts…", badge: "#000" },
    { d: 2, top: 18, tag: "#0a84ff", text: "thread: url → video", badge: "#6364ff" },
    { d: 4, top: 46, tag: "#5e5ce6", text: "draft: quiet hour tip", badge: "#0a66c2" },
  ];
  return (
    <div className="wincard wincard--light floaty w-[260px]" style={{ ["--tilt" as string]: "-2deg", animationDelay: "-1.5s" }}>
      <div className="wincard-bar">
        <WinDots icon={ToolIcons.social} />
        <span className="wincard-title">social.app</span>
      </div>
      <div className="p-3">
        <div className="mb-2 flex items-center justify-between text-[10px] font-semibold text-[#6e6e73]">
          <span>april 6 – 12</span>
          <span className="rounded-full bg-accent px-2 py-0.5 text-[9px] font-bold text-white">+ create post</span>
        </div>
        <div className="grid grid-cols-5 gap-1">
          {days.map((d, i) => (
            <div key={d} className={`relative h-[92px] rounded-[6px] border border-[#1d1d1f]/10 ${i === 2 ? "bg-accent/10" : "bg-[#f5f5f7]"}`}>
              <p className={`px-1 pt-0.5 text-[8px] font-bold ${i === 2 ? "text-accent" : "text-[#6e6e73]"}`}>{d}</p>
              {posts
                .filter((p) => p.d === i)
                .map((p) => (
                  <div key={p.text} className="absolute inset-x-0.5 overflow-hidden rounded-[4px] border border-[#1d1d1f]/10 bg-white shadow-sm" style={{ top: p.top }}>
                    <div className="h-[3px]" style={{ background: p.tag }} />
                    <div className="flex items-center gap-1 px-1 py-0.5">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: p.badge }} />
                      <span className="truncate text-[7px] font-medium text-[#1d1d1f]">{p.text}</span>
                    </div>
                  </div>
                ))}
            </div>
          ))}
        </div>
        <p className="mt-2 text-[9px] text-[#6e6e73]">queued by claude · approved by you</p>
      </div>
    </div>
  );
}

/* A small live level, drawn at the size a pill row can hold (LevelMeter is
   built for the listening pill and stands 16 px tall). Deterministic, so the
   server and the client agree. */
function Bars({ heights, className = "" }: { heights: number[]; className?: string }) {
  return (
    <span className={`flex items-end gap-[2px] ${className}`} aria-hidden>
      {heights.map((h, i) => (
        <span key={i} className="w-[2px] rounded-full bg-current" style={{ height: h }} />
      ))}
    </span>
  );
}

/* the dictate row's stand-in: the pill, and the text landing while you are
   still talking - the settled words in ink, the ones still being decoded
   greyed, the way the streaming engine shows them */
const VOICE_COMMANDS = ['"new line"', '"scratch that"', '"send it"'];

function DictateStage() {
  return (
    <div className="w-[300px]">
      <div className="flex items-center gap-2 rounded-full bg-[#0b0b0d] px-4 py-2.5 text-[12px] font-semibold text-white shadow-xl">
        <span className="rec-dot h-2 w-2 rounded-full bg-[#ff453a]" /> listening…
        <Bars heights={[4, 9, 6, 12, 7, 10, 5]} className="ml-0.5 text-white/80" />
        <span className="ml-auto font-mono text-[10px] font-normal text-white/45">ctrl+shift+space</span>
      </div>
      <div className="mt-3 rounded-xl border border-[#1d1d1f]/12 bg-white px-3 py-2.5 shadow-sm">
        <p className="flex items-center justify-between text-[8px] font-bold uppercase tracking-[0.14em] text-[#6e6e73]">
          cursor <span className="text-accent">typing while you speak</span>
        </p>
        <p className="mt-0.5 text-[12px] leading-5 text-[#1d1d1f]">
          the next clear thought lands right here,{" "}
          <span className="text-[#1d1d1f]/40">a few words behind your voice</span>
          <span className="animate-pulse">|</span>
        </p>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {VOICE_COMMANDS.map((c) => (
          <span
            key={c}
            className="rounded-full border border-[#1d1d1f]/12 bg-white px-2 py-0.5 font-mono text-[9.5px] text-[#6e6e73] shadow-sm"
          >
            {c}
          </span>
        ))}
        <span className="rounded-full bg-[#0b0b0d]/85 px-2 py-0.5 text-[9.5px] font-semibold text-white">en · pl</span>
      </div>
    </div>
  );
}

/* the meet row's stand-in: a call being written down as it happens, the two
   sides told apart by where they came from - the mic is you, the speakers are
   them - with your notes underneath */
const MEET_LINES: { who: "you" | "them"; text: string; live?: boolean }[] = [
  { who: "them", text: "can we lock the pricing this week?" },
  { who: "you", text: "yes - one price, paid once. I'll send the page tonight." },
  { who: "them", text: "and the mac build? half the team is on", live: true },
];

function MeetCard() {
  return (
    <div className="wincard wincard--light w-[300px]">
      <div className="wincard-bar">
        <WinDots icon={ToolIcons.meet} />
        <span className="wincard-title">meet.app</span>
      </div>
      <div className="p-3">
        {/* the take, then the two sources, each with its own live level */}
        <div className="flex items-center justify-between text-[9px] font-semibold">
          <span className="flex items-center gap-1 rounded-full bg-[#0b0b0d] px-2 py-1 text-white">
            <span className="rec-dot h-1.5 w-1.5 rounded-full bg-[#ff453a]" /> 32:08 · zoom call
          </span>
          <span className="text-[#6e6e73]">live transcript</span>
        </div>
        <div className="mt-1.5 flex items-center gap-1.5 text-[9px] font-semibold">
          <span className="flex flex-1 items-center gap-1 whitespace-nowrap rounded-full border border-[#1d1d1f]/10 bg-[#f5f5f7] px-2 py-1 text-[#1d1d1f]">
            you <span className="font-normal text-[#6e6e73]">· mic</span>
            <Bars heights={[3, 7, 5, 9, 4]} className="ml-auto text-accent" />
          </span>
          <span className="flex flex-1 items-center gap-1 whitespace-nowrap rounded-full border border-[#1d1d1f]/10 bg-[#f5f5f7] px-2 py-1 text-[#1d1d1f]">
            them <span className="font-normal text-[#6e6e73]">· speakers</span>
            <Bars heights={[6, 9, 4, 8, 6]} className="ml-auto text-cyan" />
          </span>
        </div>

        {/* the transcript, each line owned by a side */}
        <div className="mt-2.5 space-y-1.5">
          {MEET_LINES.map((l, i) => (
            <div key={i} className={`flex items-start gap-1.5 ${l.who === "you" ? "flex-row-reverse" : ""}`}>
              <span
                className={`mt-0.5 shrink-0 rounded-full px-1.5 py-px text-[7.5px] font-bold uppercase tracking-wide text-white ${
                  l.who === "you" ? "bg-accent" : "bg-cyan"
                }`}
              >
                {l.who}
              </span>
              <p
                className={`max-w-[80%] rounded-[8px] px-2 py-1 text-[10px] leading-[14px] text-[#1d1d1f] ${
                  l.who === "you" ? "bg-accent/10" : "bg-[#f5f5f7]"
                }`}
              >
                {l.text}
                {l.live ? <span className="caret text-accent">|</span> : null}
              </p>
            </div>
          ))}
        </div>

        {/* your notes, beside the transcript */}
        <div className="mt-2.5 flex items-center justify-between rounded-[8px] border border-dashed border-[#1d1d1f]/18 px-2 py-1.5 text-[9.5px]">
          <span className="font-semibold text-[#1d1d1f]">your notes</span>
          <span className="text-[#6e6e73]">ask about the invoice</span>
        </div>
        <p className="mt-2 flex items-center justify-between px-0.5 text-[9px] font-semibold text-[#6e6e73]">
          <span>after: summary · decisions · to-dos</span>
          <span className="text-accent">nothing uploads</span>
        </p>
      </div>
    </div>
  );
}

/* ------------------------------ data ------------------------------ */

/* the studio rows — a spectrum down the page: cyan → blue → indigo */
const TOOL_ROWS: ShowcaseTool[] = [
  {
    name: "screeni",
    icon: "video",
    file: "screen-capture.mp4",
    tint: "#32ade6",
    trigger: "hit record",
    headline: "recordings that look edited - without editing",
    desc: "The zoom follows your cursor, and you cut the video by deleting words from its transcript.",
    chips: ["auto-zoom", "edit by transcript", "auto-captions", "MP4 · 60 fps"],
    media: shot("screeni"),
    ground: "tide",
    mock: <ScreeniCard />,
  },
  {
    name: "dictate",
    icon: "dictate",
    file: "dictate.app",
    tint: "#1e9bf0",
    trigger: "ctrl + shift + space",
    headline: "write, prompt and reply - with your voice",
    desc: "One hotkey turns your voice into text in any app - about four times faster than typing.",
    chips: ["any app", "types as you speak", "voice commands", "offline"],
    media: shot("dictate"),
    ground: "meadow",
    mock: <DictateStage />,
  },
  {
    name: "meet",
    icon: "meet",
    file: "meet.app",
    tint: "#1490f2",
    trigger: "any call, any app",
    headline: "the call, written down - and who said what",
    desc: "Transcribes any call as it happens, tells you apart from them, and writes the summary and to-dos at the end.",
    chips: ["no bot joins", "summary & to-dos", "Markdown export", "Windows first"],
    media: shot("meet"),
    ground: "dawn",
    mock: <MeetCard />,
  },
  {
    name: "focus",
    icon: "focus",
    file: "focus.app",
    tint: "#0a84ff",
    trigger: "one thing at a time",
    headline: "a desk that keeps you honest",
    desc: "A fullscreen timer, one task for the day, habits, notes and a map of where your hours went.",
    chips: ["fullscreen timer", "tasks & habits", "linked notes", "screen-time heatmap"],
    media: shot("focus"),
    ground: "dawn",
    mock: <FocusCard />,
  },
  {
    name: "board",
    icon: "board",
    file: "board.app",
    tint: "#2b78f5",
    trigger: "ctrl + v",
    headline: "paste a screenshot, think around it",
    desc: "An endless whiteboard for boxes, arrows and screenshots. Every board is a file on your disk.",
    chips: ["shapes & arrows", "paste screenshots", "PNG · SVG export"],
    media: shot("board"),
    ground: "mist",
    mock: <BoardCard />,
  },
  {
    name: "social",
    icon: "social",
    file: "social.app",
    tint: "#4a67ec",
    trigger: "write once",
    headline: "run your social media on autopilot",
    desc: "One calendar for all your networks. AI agents can queue posts too, and each one waits for your approval.",
    chips: ["week · month · list", "AI agents over MCP", "review queue", "7 networks live"],
    media: shot("social"),
    ground: "dusk",
    mock: <SocialCard />,
  },
  {
    name: "disk",
    icon: "disk",
    file: "disk.app",
    tint: "#0a84ff",
    trigger: "where did it all go",
    headline: "see what is eating the drive",
    desc: "A map of your drive that finds duplicates and old caches, and only ever moves files to the Recycle Bin.",
    chips: ["treemap", "duplicate finder", "apps by size", "Recycle Bin only"],
    media: shot("disk"),
    ground: "mist",
    mock: <DiskCard />,
  },
  {
    name: "launch",
    icon: "launch",
    file: "yourapp-launch.mp4",
    tint: "#5e5ce6",
    trigger: "paste a url",
    headline: "a launch video from a link",
    desc: "Paste a URL and get a keynote-style video made from the page, rendered on your device.",
    chips: ["6 style packs", "16:9 · 9:16 · 1:1", "brand colors detected"],
    media: shot("launch"),
    ground: "dusk",
    mock: <LaunchCard />,
  },
];

const MOMENTS = [
  {
    ground: "meadow" as const,
    motif: "voice" as const,
    window: "rather-talk.you",
    title: "when you'd rather talk than type",
    desc: "Say the email, the essay or the reply - clean text lands where your cursor is.",
    tools: ["dictate"],
  },
  {
    ground: "tide" as const,
    motif: "rec" as const,
    window: "just-show-it.you",
    title: "when showing beats explaining",
    desc: "Record a bug, a lesson or a how-to, and the zoom follows your cursor.",
    tools: ["screeni"],
  },
  {
    ground: "dusk" as const,
    motif: "wave" as const,
    window: "hours-of-audio.you",
    title: "when you're sitting on hours of audio",
    desc: "Turn a lecture, an interview or a voice memo into text or subtitles, without uploading it.",
    tools: ["dictate", "screeni"],
  },
  {
    ground: "dawn" as const,
    motif: "meet" as const,
    window: "the-call-you-wont-remember.you",
    title: "when it's a call you will not remember",
    desc: "Get the transcript, the decisions and the to-dos, with no bot on the call.",
    tools: ["meet"],
  },
  {
    ground: "dawn" as const,
    motif: "timer" as const,
    window: "quiet-hour.you",
    title: "when the day needs a quiet hour",
    desc: "Pick one task and let a fullscreen timer guard the hour.",
    tools: ["focus"],
  },
  {
    ground: "mist" as const,
    motif: "sketch" as const,
    window: "wont-fit-in-a-line.you",
    title: "when the idea won't fit in a line",
    desc: "Sketch the plan on an endless board that stays exactly where you left it.",
    tools: ["board"],
  },
  {
    ground: "mist" as const,
    motif: "treemap" as const,
    window: "drive-is-full.you",
    title: "when the drive says it is full",
    desc: "See what fills it, then send the junk to the Recycle Bin.",
    tools: ["disk"],
  },
  {
    ground: "tide" as const,
    motif: "week" as const,
    window: "the-week-is-written.you",
    title: "when the posts are written but the week isn't",
    desc: "Queue the whole week in one calendar - every post waits for your yes.",
    tools: ["social"],
  },
];

/* A motif for a nature tile: one recognisable thing from the app, small enough
   to read at 72–92px. Drawn rather than picked off an icon sheet, so the tiles
   belong to the same hand as the scenes above them. Shared by the moments and
   the free-tool cards. */
const MOTIFS: Record<string, ReactNode> = {
  voice: (
    <span className="layer absolute inset-x-3 top-1/2 flex -translate-y-1/2 items-center justify-center gap-[3px] !rounded-full bg-[#0b0b0d]/90 py-2">
      <span className="rec-dot mr-1 h-1.5 w-1.5 rounded-full bg-[#ff453a]" />
      {[7, 12, 9, 14, 8].map((h, i) => (
        <span key={i} className="w-[3px] rounded-full bg-white" style={{ height: h }} />
      ))}
    </span>
  ),
  rec: (
    <>
      <span className="layer absolute inset-x-3 top-4 h-9 !rounded-md bg-[#101a2e]" />
      <span className="layer absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1.5 !rounded-full bg-[#0b0b0d]/90 px-2.5 py-1 text-[9px] font-semibold text-white">
        <span className="rec-dot h-1.5 w-1.5 rounded-full bg-[#ff453a]" /> REC
      </span>
    </>
  ),
  wave: (
    <span className="absolute inset-0 flex items-center justify-center gap-[3px]">
      {[10, 20, 34, 22, 40, 26, 14, 30, 18, 8].map((h, i) => (
        <span key={i} className="w-[3px] rounded-full bg-white/85" style={{ height: h }} />
      ))}
    </span>
  ),
  timer: (
    <svg className="absolute inset-0 m-auto" width="52" height="52" viewBox="0 0 52 52" aria-hidden>
      <circle cx="26" cy="26" r="21" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="5" />
      <circle
        cx="26"
        cy="26"
        r="21"
        fill="none"
        stroke="#fff"
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray="132"
        strokeDashoffset="44"
        transform="rotate(-90 26 26)"
      />
    </svg>
  ),
  sketch: (
    <svg className="absolute inset-0 h-full w-full" viewBox="0 0 92 92" aria-hidden>
      <path
        d="M14 62 C 26 34, 40 70, 52 40 S 74 26, 80 34"
        fill="none"
        stroke="#0a84ff"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <circle cx="80" cy="34" r="5" fill="#0a84ff" />
    </svg>
  ),
  caption: (
    <span className="absolute inset-0 flex flex-col items-center justify-center gap-1.5">
      <span className="h-1.5 w-10 rounded-full bg-white/85" />
      <span className="h-1.5 w-14 rounded-full bg-white/85" />
      <span className="h-1.5 w-8 rounded-full bg-white/55" />
    </span>
  ),
  treemap: (
    <span className="absolute inset-0 m-auto grid h-[62px] w-[62px] grid-cols-3 grid-rows-3 gap-[3px]">
      <span className="col-span-2 row-span-2 rounded-[3px] bg-accent" />
      <span className="rounded-[3px] bg-indigo/80" />
      <span className="rounded-[3px] bg-cyan" />
      <span className="rounded-[3px] bg-indigo/60" />
      <span className="rounded-[3px] bg-accent/70" />
      <span className="rounded-[3px] bg-cyan/70" />
    </span>
  ),
  week: (
    <span className="absolute inset-0 grid grid-cols-4 content-center gap-1.5 p-4">
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
        <span
          key={i}
          className={`h-3.5 rounded-[3px] ${i === 2 || i === 5 ? "bg-white" : "bg-white/35"}`}
        />
      ))}
    </span>
  ),
  /* two voices: the louder one is you, the quieter one is them - the same
     drawing as the meet glyph in the window bars */
  meet: (
    <span className="absolute inset-0 flex items-center justify-center gap-3">
      <span className="flex items-end gap-[3px]">
        {[12, 26, 18, 34, 20].map((h, i) => (
          <span key={i} className="w-[4px] rounded-full bg-white" style={{ height: h }} />
        ))}
      </span>
      <span className="flex items-end gap-[3px]">
        {[10, 18, 24, 14, 8].map((h, i) => (
          <span key={i} className="w-[4px] rounded-full bg-white/55" style={{ height: h }} />
        ))}
      </span>
    </span>
  ),
};

const FREE_TOOLS = [
  {
    title: "Speech to text",
    ground: "meadow" as const,
    motif: "voice" as const,
    desc: "Any audio or video file to text, offline.",
    href: "#pricing",
  },
  {
    title: "Subtitle (.srt) generator",
    ground: "tide" as const,
    motif: "caption" as const,
    desc: "Timed captions from speech, saved as SRT.",
    href: "#pricing",
  },
  {
    title: "Video → audio",
    ground: "dawn" as const,
    motif: "wave" as const,
    desc: "Pull the audio track out of any video.",
    href: "#pricing",
  },
];

/* the social tile's week: tuesday is today, so monday's post and tuesday's
   morning one have already gone out (dimmed) and four are still queued */
const SOCIAL_WEEK: { day: string; posts: { tint: string; sent?: boolean }[] }[] = [
  { day: "mon", posts: [{ tint: "bg-accent", sent: true }] },
  { day: "tue", posts: [{ tint: "bg-indigo", sent: true }, { tint: "bg-cyan" }] },
  { day: "wed", posts: [{ tint: "bg-accent" }] },
  { day: "thu", posts: [] },
  { day: "fri", posts: [{ tint: "bg-indigo" }, { tint: "bg-accent" }] },
];

/* a friend checks in — the pitch in someone else's words */
const CHAT: { who: string; at: string; me?: boolean; text: string }[] = [
  { who: "friend", at: "22:14", text: "did you try owntools?" },
  { who: "you", at: "22:16", me: true, text: "every day. I talk, it types." },
  { who: "friend", at: "22:16", text: "another subscription?" },
  { who: "you", at: "22:17", me: true, text: "no - paid once. the app I open the most." },
];

/* ------------------------------ roadmap ------------------------------ */

/* the course: ports behind us, the one we're in, the ones ahead */
const COURSE: { t: string; state: "done" | "now" | "next" }[] = [
  { t: "dictate anywhere", state: "done" },
  { t: "record with auto-zoom", state: "done" },
  { t: "transcribe anything", state: "done" },
  { t: "url → launch video", state: "done" },
  { t: "workspaces & sessions", state: "done" },
  { t: "board - an endless whiteboard", state: "done" },
  { t: "social - schedule everywhere", state: "done" },
  { t: "disk - see what fills the drive", state: "done" },
  { t: "meet - any call, written down", state: "done" },
  { t: "a model of your own", state: "done" },
  { t: "macOS - coming soon", state: "now" },
  { t: "mate, the agent", state: "next" },
];

/* how far along the course we are — derived, so adding a port cannot leave the
   headline count and the drawn line disagreeing with the list under them */
const PORTS_DONE = COURSE.filter((p) => p.state === "done").length;
const NOW_INDEX = COURSE.findIndex((p) => p.state === "now");
/* the accent line stops on the dot we are standing on */
const COURSE_PROGRESS = `${(((NOW_INDEX < 0 ? PORTS_DONE - 1 : NOW_INDEX) + 0.5) / COURSE.length) * 100}%`;

const AGENTS = ["OpenClaw", "Hermes", "Claude", "ChatGPT", "Codex", "Cursor"];

const SOCIAL_POINTS = [
  { t: "one calendar, every network.", d: "Drag posts around a week, month or list view." },
  { t: "write once, tune per network.", d: "Live previews and each network's character limit as you type." },
  { t: "agents plan, you approve.", d: "Agents queue posts through a local MCP server, and nothing goes out without your yes." },
  { t: "posts from your device.", d: "Each post goes out on time from the tray, with retries and an undo log." },
];

/* A treemap of a drive: big blocks are the folders eating the space, and the
   two tinted ones are what the cleanup sheet would offer to take back. Laid
   out by hand rather than by the real squarify pass — this is a picture of the
   tool, and it only has to be true to what the tool shows. */
const DISK_BLOCKS = [
  { label: "node_modules", size: "18.4 GB", x: 0, y: 0, w: 46, h: 58, tint: "#0a84ff" },
  { label: "Videos", size: "12.1 GB", x: 46, y: 0, w: 32, h: 34, tint: "#5e5ce6" },
  { label: "Downloads", size: "9.7 GB", x: 78, y: 0, w: 22, h: 34, tint: "#32ade6", win: true },
  { label: "Steam", size: "8.2 GB", x: 46, y: 34, w: 29, h: 24, tint: "#5e5ce6" },
  { label: "caches", size: "4.4 GB", x: 75, y: 34, w: 25, h: 24, tint: "#32ade6", win: true },
  { label: "Documents", size: "3.9 GB", x: 0, y: 58, w: 28, h: 42, tint: "#0a84ff" },
  { label: "Pictures", size: "3.1 GB", x: 28, y: 58, w: 24, h: 42, tint: "#32ade6" },
  { label: "AppData", size: "2.6 GB", x: 52, y: 58, w: 26, h: 42, tint: "#5e5ce6" },
  { label: "the rest", size: "1.8 GB", x: 78, y: 58, w: 22, h: 42, tint: "#0a84ff" },
];

function DiskCard() {
  return (
    <div className="wincard wincard--light w-[290px]">
      <div className="wincard-bar">
        <WinDots icon={ToolIcons.disk} />
        <span className="wincard-title">disk.app</span>
      </div>
      <div className="p-2.5">
        <div className="relative h-[150px] w-full overflow-hidden rounded-[8px] bg-[#0b1220]">
          {DISK_BLOCKS.map((b) => (
            <span
              key={b.label}
              className="absolute overflow-hidden border border-[#0b1220] px-1.5 py-1"
              style={{
                left: `${b.x}%`,
                top: `${b.y}%`,
                width: `${b.w}%`,
                height: `${b.h}%`,
                background: b.tint,
                opacity: b.win ? 1 : 0.62,
                boxShadow: b.win ? "inset 0 0 0 1.5px rgba(255,255,255,0.85)" : undefined,
              }}
            >
              <span className="block truncate text-[8.5px] font-semibold leading-none text-white">{b.label}</span>
              <span className="mt-0.5 block truncate text-[7.5px] leading-none text-white/70">{b.size}</span>
            </span>
          ))}
        </div>
        <p className="mt-2 flex items-center justify-between px-0.5 text-[10px] font-semibold text-[#1d1d1f]">
          <span>C: · 64.2 GB scanned</span>
          <span className="text-accent">14.1 GB in quick wins</span>
        </p>
      </div>
    </div>
  );
}

function SocialCalendarCard() {
  const days = ["mon 6", "tue 7", "wed 8", "thu 9", "fri 10", "sat 11", "sun 12"];
  const hours = ["9 am", "10 am", "11 am", "1 pm", "3 pm"];
  const cells: Record<string, { tag: string; tagColor: string; text: string; badge: string; draft?: boolean; done?: boolean; review?: boolean }> = {
    "0-0": { tag: "news", tagColor: "#ff375f", text: "new build: board + social", badge: "#0085ff", done: true },
    "1-1": { tag: "personal", tagColor: "#5e5ce6", text: "small daily workouts beat…", badge: "#000000" },
    "2-0": { tag: "product", tagColor: "#0a84ff", text: "thread: url → video 🧵", badge: "#6364ff" },
    "2-3": { tag: "news", tagColor: "#ff375f", text: "record button now in the tray", badge: "#26a5e4" },
    "3-2": { tag: "product", tagColor: "#0a84ff", text: "dictation tip: quiet rooms", badge: "#0a66c2", review: true },
    "4-1": { tag: "personal", tagColor: "#5e5ce6", text: "draft: quiet hour", badge: "#0085ff", draft: true },
    "5-4": { tag: "product", tagColor: "#0a84ff", text: "weekly changelog", badge: "#5865f2", review: true },
  };
  return (
    <div className="wincard w-full max-w-[560px]">
      <div className="wincard-bar">
        <WinDots icon={ToolIcons.social} />
        <span className="wincard-title">social.app - april 6 – 12, 2026</span>
        <span className="ml-auto rounded-full bg-accent px-2.5 py-0.5 text-[10px] font-bold text-white">+ create post</span>
      </div>
      <div className="p-3">
        <div className="grid grid-cols-[38px_repeat(7,minmax(0,1fr))] gap-px overflow-hidden rounded-[10px] border border-line bg-line text-[9px]">
          <div className="bg-card" />
          {days.map((d, i) => (
            <div key={d} className={`bg-card px-1 py-1.5 text-center font-bold ${i === 2 ? "text-accent" : "text-muted"}`}>
              {d}
            </div>
          ))}
          {hours.map((h, r) => (
            <Fragment key={h}>
              <div className="bg-card px-1 py-2 text-right text-[8px] text-muted">{h}</div>
              {days.map((_, c) => {
                const cell = cells[`${c}-${r}`];
                const past = c < 2 || (c === 2 && r < 1);
                return (
                  <div
                    key={`${c}-${r}`}
                    className={`relative min-h-[46px] bg-card p-0.5 ${c === 2 ? "bg-accent/5" : ""}`}
                    style={past ? { backgroundImage: "repeating-linear-gradient(135deg, transparent 0 5px, var(--color-line) 5px 6px)" } : undefined}
                  >
                    {c === 2 && r === 1 ? <span className="absolute inset-x-0 top-[40%] h-px bg-[#ff453a]" /> : null}
                    {cell ? (
                      <div
                        className={`overflow-hidden rounded-[5px] border bg-card shadow-sm ${cell.done ? "opacity-80" : ""} ${
                          cell.review ? "border-dashed border-[#ff9f0a]/70" : "border-line"
                        }`}
                      >
                        <div className="px-1 py-px text-[7px] font-bold uppercase tracking-wide text-white" style={{ background: cell.tagColor }}>
                          {cell.tag}
                        </div>
                        <div className="flex items-start gap-1 px-1 py-1">
                          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full" style={{ background: cell.badge }} />
                          <span className="line-clamp-2 text-[8px] leading-[1.25] text-ink">
                            {cell.draft ? <span className="text-muted">Draft: </span> : null}
                            {cell.review ? <span className="font-semibold text-[#ff9f0a]">Review: </span> : null}
                            {cell.text}
                          </span>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </Fragment>
          ))}
        </div>
        <div className="mt-2 flex items-center justify-between text-[10px] text-muted">
          <span>3 scheduled · 2 awaiting your review · 1 draft · 1 published</span>
          <span>queued by claude code over mcp · approved by you</span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ small pieces ------------------------------ */

function AppleGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M16.7 12.6c0-2.4 2-3.6 2.1-3.6-1.1-1.7-2.9-1.9-3.6-1.9-1.5-.2-3 .9-3.8.9s-2-.9-3.3-.9c-1.7 0-3.2 1-4.1 2.5-1.7 3-.4 7.5 1.3 9.9.8 1.2 1.8 2.5 3.1 2.5 1.2 0 1.7-.8 3.2-.8s1.9.8 3.2.8 2.2-1.2 3-2.4c.9-1.4 1.3-2.7 1.3-2.8 0 0-2.4-.9-2.4-3.6zM14.3 4.7c.7-.8 1.1-2 1-3.2-1 0-2.2.7-2.9 1.5-.6.7-1.2 1.9-1 3 1.1.1 2.2-.5 2.9-1.3z" />
    </svg>
  );
}

function WindowsGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden>
      <rect x="0" y="0" width="6.4" height="6.4" rx="0.8" />
      <rect x="7.6" y="0" width="6.4" height="6.4" rx="0.8" />
      <rect x="0" y="7.6" width="6.4" height="6.4" rx="0.8" />
      <rect x="7.6" y="7.6" width="6.4" height="6.4" rx="0.8" />
    </svg>
  );
}

function BrandMark({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ""}`}>
      <svg width="18" height="18" viewBox="0 0 12 12" aria-hidden>
        <path d="M6 0.8L10.4 7.6H1.6L6 0.8ZM2 9H10L8.6 11.2H3.4L2 9Z" fill="currentColor" />
      </svg>
      <span className="display text-[17px] font-bold tracking-[-0.03em]">owntools</span>
    </span>
  );
}

function SectionHead({
  kicker,
  kickerClass,
  title,
  sub,
}: {
  kicker: string;
  kickerClass?: string;
  title: React.ReactNode;
  sub?: string;
}) {
  return (
    <Reveal className="mx-auto max-w-2xl text-center">
      <p className={`kicker ${kickerClass ?? ""}`}>{kicker}</p>
      <h2 className="display mt-3 text-4xl md:text-5xl">{title}</h2>
      {sub ? <p className="mx-auto mt-4 max-w-xl text-muted">{sub}</p> : null}
    </Reveal>
  );
}

/* ------------------------------ page ------------------------------ */

export default function Home() {
  /* the ASCII texture on the hero sky is the largest thing in the first
     screen, so it is fetched with the HTML rather than found in the CSS later */
  preload("/wallpapers/ascii-grid.webp", { as: "image", type: "image/webp", fetchPriority: "high" });

  return (
    <div id="top">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      {/* nav */}
      <header className="fixed inset-x-0 top-0 z-40 px-3">
        <div
          className="mx-auto mt-3 flex max-w-5xl items-center justify-between rounded-full border border-line px-4 py-2.5 backdrop-blur-xl md:mt-4 md:px-5"
          style={{ background: "var(--nav-bg)" }}
        >
          <a href="#top" aria-label="owntools home">
            <BrandMark />
          </a>
          <nav className="flex items-center gap-3 text-sm font-medium text-muted md:gap-5">
            <a href="#tools" className="hidden transition hover:text-ink md:block">tools</a>
            <a href="#intelligence" className="hidden transition hover:text-ink md:block">on-device</a>
            <a href="#pricing" className="hidden transition hover:text-ink md:block">pricing</a>
            <a href="#faq" className="hidden transition hover:text-ink md:block">faq</a>
            <ThemeToggle />
            {/* before launch this leads to pricing, where the status is spelled out */}
            <a href={downloadUrl ?? "#pricing"} className="btn btn-accent !h-9 !px-4 text-[13px]">
              get owntools
            </a>
          </nav>
        </div>
      </header>

      {/* hero — the sky above the desk */}
      <section className="hero-sky ground ground--wide relative overflow-hidden">
        {/* No windows up here any more: four of them plus two sticky notes
            turned the first screen into scatter, the focus timer went on
            2026-09-13, and the screen recorder clip moved into its studio row
            on 2026-09-15. */}
        <div className="relative mx-auto max-w-3xl px-5 pb-24 pt-36 text-center md:pb-36 md:pt-52">
          <h1
            className="display text-5xl font-extrabold sm:text-6xl md:text-[80px] md:leading-[0.98] lg:text-[92px]"
            style={{ textShadow: "0 2px 24px rgba(10,30,60,0.35)" }}
          >
            your work.
            <br />
            your device.
          </h1>
          {/* The headline is a promise; this line says what the thing is, in
              words a non-native reader gets on one pass. */}
          <p
            className="mx-auto mt-7 max-w-xl text-balance text-lg font-medium text-white md:text-xl"
            style={{ textShadow: "0 1px 12px rgba(10,30,60,0.4)" }}
          >
            Eight tools in one desktop app. Nothing leaves your computer.
          </p>
          <ul className="mx-auto mt-7 flex flex-wrap items-center justify-center gap-2">
            {HERO_VERBS.map((verb) => (
              <li
                key={verb}
                className="rounded-full border border-white/25 bg-white/12 px-3 py-1 text-[13px] font-semibold text-white backdrop-blur-md"
              >
                {verb}
              </li>
            ))}
          </ul>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            {downloadUrl || downloadUrlMac ? (
              <>
                <DownloadCta
                  className="btn btn-light"
                  fallback={
                    <>
                      <WindowsGlyph /> {DOWNLOAD_SOON}
                    </>
                  }
                >
                  <WindowsGlyph /> download for windows
                </DownloadCta>
                <MacDownloadCta
                  className="btn btn-light"
                  fallback={
                    <>
                      <AppleGlyph /> {MAC_DOWNLOAD_SOON}
                    </>
                  }
                >
                  <AppleGlyph /> download for mac
                </MacDownloadCta>
              </>
            ) : (
              /* Before launch exactly one thing here works, so it is the only
                 thing that looks clickable. Two identical dead buttons side by
                 side taught the reader the whole hero was inert. */
              <>
                <a href="#tools" className="btn btn-light">
                  see the tools <ArrowDown size={15} />
                </a>
                <span className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-4 py-2 text-[13px] font-medium text-white/85 backdrop-blur-md">
                  <WindowsGlyph />
                  <AppleGlyph />
                  windows &amp; mac - launching soon
                </span>
              </>
            )}
          </div>

          <p
            className="mx-auto mt-6 text-[13px] font-medium text-white/75"
            style={{ textShadow: "0 1px 14px rgba(10,30,60,0.45)" }}
          >
            paid once · no account · works offline
          </p>
        </div>
      </section>

      {/* 01 — one app bento. Every tile is a scene: a ground for weather, panes
          for depth, and at least one thing running off the frame so the tile
          reads as a window onto the app rather than a swatch with a logo. */}
      <section className="cv mx-auto max-w-6xl px-5 py-16 md:py-24" style={cv(2000, 1000)}>
        <Reveal>
          <div className="flex items-center gap-4">
            <p className="font-mono text-[11px] font-bold uppercase tracking-[0.2em]">
              <span className="text-accent">01</span>
              <span className="ml-3">one app, everything you own</span>
            </p>
            <span className="h-px flex-1 bg-line" aria-hidden />
          </div>
        </Reveal>

        <div className="mt-8 grid gap-5 lg:grid-cols-3">
          {/* left column */}
          <div className="flex flex-col gap-5 lg:col-span-2">
            {/* dictation — the big one */}
            <Reveal>
              <div className="bento">
                <Scene ground="meadow" className="h-64 !rounded-none md:h-72">
                  <ListeningPill className="absolute left-8 top-8" />
                  <Pane className="absolute left-14 top-[86px] w-[min(300px,62%)] p-3.5">
                    <p className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-muted">
                      cursor
                    </p>
                    <p className="mt-0.5 text-[13px] leading-6 text-ink">
                      the next clear thought lands right here.
                      <span className="caret text-accent">|</span>
                    </p>
                  </Pane>
                  {/* the destinations, running off the right edge */}
                  <Pane className="absolute -right-8 top-16 w-44 p-3">
                    <p className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-muted">
                      lands in
                    </p>
                    <ul className="mt-1.5 space-y-1 text-[11.5px] font-medium text-ink">
                      <li className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-accent" /> any text field</li>
                      <li className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-indigo" /> your terminal</li>
                      <li className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-cyan" /> the whiteboard</li>
                    </ul>
                  </Pane>
                  <span className="layer absolute bottom-5 left-8 !rounded-full bg-white/92 px-3 py-1 text-[11px] font-semibold text-[#1d1d1f]">
                    whisper · parakeet · on your cpu
                  </span>
                </Scene>
                <div className="p-5 md:p-6">
                  <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted">dictation</p>
                  <h3 className="display mt-1.5 text-xl">speak to any app.</h3>
                  <p className="mt-1.5 max-w-xl text-sm leading-6 text-muted">
                    Press a key and talk - the text appears where your cursor is.
                  </p>
                </div>
              </div>
            </Reveal>

            {/* focus + social, side by side */}
            <div className="grid gap-5 sm:grid-cols-2">
              <Reveal delay={0.05}>
                <div className="bento h-full">
                  <Scene ground="dawn" className="h-40 !rounded-none">
                    <Pane className="absolute left-1/2 top-1/2 w-40 -translate-x-1/2 -translate-y-1/2 px-5 py-3 text-center">
                      <p className="font-mono text-[8px] font-bold uppercase tracking-[0.14em] text-muted">
                        deep focus
                      </p>
                      <p className="display text-3xl text-ink">25:00</p>
                      <span className="mt-2 block h-1 overflow-hidden rounded-full bg-ink/10">
                        <span className="block h-full w-2/3 rounded-full bg-accent" />
                      </span>
                    </Pane>
                    <span className="layer absolute bottom-4 -right-6 !rounded-full bg-[#0b0b0d]/90 py-1.5 pl-3 pr-8 text-[10.5px] font-semibold text-white">
                      3 of 4 · notifications off
                    </span>
                  </Scene>
                  <div className="p-5">
                    <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted">focus</p>
                    <h3 className="display mt-1.5 text-lg">one task. zero noise.</h3>
                  </div>
                </div>
              </Reveal>
              <Reveal delay={0.1}>
                <div className="bento h-full">
                  <Scene ground="dusk" className="h-40 !rounded-none">
                    <Pane className="absolute left-1/2 top-[45%] w-52 -translate-x-1/2 -translate-y-1/2 px-3 py-2.5">
                      <p className="flex items-center justify-between font-mono text-[8px] font-bold uppercase tracking-[0.14em] text-muted">
                        <span>this week</span>
                        <span className="text-accent">4 queued</span>
                      </p>
                      <div className="mt-1.5 grid grid-cols-5 gap-1">
                        {SOCIAL_WEEK.map(({ day, posts }) => {
                          const today = day === "tue";
                          return (
                            <div
                              key={day}
                              className={`h-11 rounded-[5px] border border-line px-0.5 pt-0.5 ${today ? "bg-accent/10" : "bg-paper"}`}
                            >
                              <p className={`text-[7px] font-bold ${today ? "text-accent" : "text-muted"}`}>{day}</p>
                              {posts.map((post, i) => (
                                <span
                                  key={i}
                                  className={`mt-0.5 block h-1.5 rounded-full ${post.tint} ${post.sent ? "opacity-35" : ""}`}
                                />
                              ))}
                            </div>
                          );
                        })}
                      </div>
                    </Pane>
                    {/* the one that just went out, sliding off frame */}
                    <span className="layer absolute -left-4 bottom-3 flex items-center gap-1.5 !rounded-full bg-[#0b0b0d]/90 py-1.5 pl-7 pr-3.5 text-[10.5px] font-semibold text-white">
                      <Check size={12} className="text-[#30d158]" /> posted · tue 09:00
                    </span>
                  </Scene>
                  <div className="p-5">
                    <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted">social</p>
                    <h3 className="display mt-1.5 text-lg">plan the week. it posts itself.</h3>
                  </div>
                </div>
              </Reveal>
            </div>
          </div>

          {/* right column */}
          <div className="flex flex-col gap-5">
            <Reveal delay={0.08}>
              <div className="bento">
                <Scene ground="tide" className="h-56 !rounded-none">
                  <div className="layer absolute inset-x-6 top-7 overflow-hidden !rounded-xl">
                    <div
                      className="h-28"
                      style={{
                        background:
                          "radial-gradient(70px 50px at 28% 32%, #0a84ff, transparent 70%), radial-gradient(76px 56px at 76% 38%, #5e5ce6, transparent 70%), #101a2e",
                      }}
                    >
                      <div className="relative left-[20%] top-[24%] h-[52%] w-[58%] rounded border border-white/25 bg-white/90 shadow-lg" />
                    </div>
                    <p className="flex items-center gap-1.5 bg-[#101012] px-3 py-2 text-[10px] font-semibold text-white/80">
                      <span className="rec-dot h-1.5 w-1.5 rounded-full bg-[#ff453a]" /> REC · auto-zoom on
                    </p>
                  </div>
                  {/* the cursor the zoom is chasing */}
                  <svg className="absolute bottom-8 right-9" width="26" height="26" viewBox="0 0 24 24" aria-hidden>
                    <path d="M5 2.5 19 12.2 12.4 13.2 9.6 19.6Z" fill="#fff" stroke="#1d1d1f" strokeWidth="1.4" strokeLinejoin="round" />
                  </svg>
                  <span className="absolute bottom-6 right-6 h-11 w-11 rounded-full border-2 border-white/70" aria-hidden />
                </Scene>
                <div className="p-5">
                  <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted">screeni</p>
                  <h3 className="display mt-1.5 text-balance text-lg">a screen recorder that automates all the work.</h3>
                  <p className="mt-1.5 text-sm leading-6 text-muted">
                    Auto-zoom, silence cuts and captions, done for you.
                  </p>
                </div>
              </div>
            </Reveal>
            <Reveal delay={0.12}>
              <div className="bento flex-1">
                <Scene ground="mist" className="h-44 !rounded-none">
                  {/* four subscriptions behind one file */}
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="relative h-[104px] w-[210px]">
                      {[
                        { t: "$8 / mo", x: -74, y: -26, r: -9 },
                        { t: "$12 / mo", x: 76, y: -30, r: 8 },
                        { t: "$9 / mo", x: -68, y: 30, r: -5 },
                        { t: "$15 / mo", x: 72, y: 34, r: 6 },
                      ].map((c) => (
                        <span
                          key={c.t}
                          className="absolute left-1/2 top-1/2 w-[74px] rounded-lg border border-line bg-card/75 px-2 py-1.5 text-center font-mono text-[9px] text-muted line-through shadow-sm"
                          style={{
                            transform: `translate(-50%,-50%) translate(${c.x}px, ${c.y}px) rotate(${c.r}deg)`,
                          }}
                        >
                          {c.t}
                        </span>
                      ))}
                      <span className="pane absolute left-1/2 top-1/2 w-36 -translate-x-1/2 -translate-y-1/2 px-3.5 py-3 text-center">
                        <span className="block font-mono text-[8.5px] text-muted">owntools.exe</span>
                        <span className="display block text-lg font-bold text-ink">pay once</span>
                        <span className="mt-0.5 block text-[10px] font-semibold text-accent">yours forever</span>
                      </span>
                    </div>
                  </div>
                </Scene>
                <div className="p-5">
                  <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted">one-time purchase</p>
                  <h3 className="display mt-1.5 text-lg">stop renting your tools.</h3>
                  <p className="mt-1.5 text-sm leading-6 text-muted">
                    One payment instead of a stack of subscriptions.
                  </p>
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* the toolkit — browse capabilities by tool */}
      <section className="cv dotted overflow-hidden border-y border-line py-16 md:py-24" style={cv(1100, 900)}>
        <div className="mx-auto max-w-6xl px-5">
          <Reveal>
            <Toolkit />
          </Reveal>
        </div>
      </section>

      {/* the studio — one tool at a time */}
      <section id="tools" className="cv py-20 md:py-28" style={cv(7600, 6400)}>
        <div className="mx-auto max-w-7xl px-5">
          <Reveal className="mx-auto max-w-2xl text-center">
            <h2 className="display text-4xl md:text-5xl">eight tools, one desk, zero cloud</h2>
          </Reveal>
          <div className="mt-16 md:mt-24">
            <ToolShowcase tools={TOOL_ROWS} />
          </div>
        </div>
      </section>

      <Intelligence />

      <QuickTools />

      {/* social — the scheduler agents can drive */}
      <section id="social" className="cv border-t border-line py-20 md:py-28" style={cv(1700, 1100)}>
        <div className="mx-auto max-w-6xl px-5">
          <Reveal className="mx-auto max-w-3xl text-center">
            <p className="kicker">social</p>
            <h2 className="display mt-4 text-4xl leading-[1.08] sm:text-5xl md:text-6xl">
              run your social media on <span className="marker">autopilot</span> with AI agents
            </h2>
            <p className="mx-auto mt-5 max-w-2xl text-[15px] leading-7 text-muted md:text-base">
              Schedule posts from one calendar, or let an AI agent plan the week for your approval.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
              <span className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">use any agent</span>
              {AGENTS.map((a) => (
                <span key={a} className="rounded-full border border-line bg-card px-3 py-1 text-[12.5px] font-semibold">
                  {a}
                </span>
              ))}
            </div>
          </Reveal>

          <div className="mt-14 grid items-center gap-10 lg:grid-cols-[1fr_1fr] lg:gap-16">
            <Reveal className="flex justify-center">
              <SocialCalendarCard />
            </Reveal>
            <Reveal delay={0.08}>
              <ul className="space-y-4 text-[15px] leading-7 text-muted">
                {SOCIAL_POINTS.map((p) => (
                  <li key={p.t} className="flex gap-3">
                    <Check size={16} className="mt-1.5 shrink-0 text-accent" />
                    <span>
                      <strong className="text-ink">{p.t}</strong> {p.d}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-6 rounded-[14px] border border-line bg-card p-4 text-[13px] leading-6 text-muted">
                <span className="font-semibold text-ink">Live now:</span> Bluesky, Mastodon, Telegram, Discord, Slack,
                Dev.to and Medium. X and LinkedIn work with your own developer app; more networks are coming.
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      <DictateAnywhere />

      <WhatsInside />

      <SpeedCompare />

      {/* personas */}
      {/* personas - a full-width section around the column, so content-visibility's
          paint containment has room for the cards' shadows */}
      <section id="who" className="cv px-5 py-16 md:py-24" style={cv(2100, 1100)}>
        <div className="mx-auto max-w-6xl">
          <SectionHead kicker="what it's for" title="eight moments, not eight job titles" />
          <div className="mt-12 grid gap-5 sm:grid-cols-2">
            {MOMENTS.map((p, i) => (
              <Reveal
                key={p.title}
                delay={(i % 2) * 0.08}
                className={i === MOMENTS.length - 1 && MOMENTS.length % 2 ? "sm:col-span-2" : undefined}
              >
                <div className="wincard h-full" style={{ transform: `rotate(${i % 2 ? 0.4 : -0.4}deg)` }}>
                  <div className="wincard-bar">
                    <WinDots />
                    <span className="wincard-title">{p.window}</span>
                  </div>
                  <div className="flex gap-4 p-6 sm:gap-5">
                    <Scene ground={p.ground} className="h-[92px] w-[92px] shrink-0 !rounded-xl">
                      {MOTIFS[p.motif]}
                    </Scene>
                    <div className="min-w-0">
                      <h3 className="display text-xl">{p.title}</h3>
                      <p className="mt-2 text-[14px] leading-6 text-muted">{p.desc}</p>
                      <div className="mt-3 flex gap-1.5">
                        {p.tools.map((t) => (
                          <span key={t} className="rounded-full bg-accent/10 px-2.5 py-0.5 text-[11px] font-semibold text-accent">
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* free tools */}
      <section id="free-tools" className="cv dotted border-y border-line px-5 py-14 md:py-20" style={cv(900, 480)}>
        <div className="mx-auto max-w-6xl">
          <SectionHead kicker="free tools" title="useful on their own" sub="Free in the desktop app, no sign-up." />
          <div className="mx-auto mt-10 grid max-w-xl gap-4 lg:max-w-5xl lg:grid-cols-3">
            {FREE_TOOLS.map((tool, i) => (
              <Reveal key={tool.title} delay={i * 0.07}>
                <a href={tool.href} className="wincard block h-full transition hover:-translate-y-0.5">
                  <div className="wincard-bar">
                    <WinDots />
                    <span className="wincard-title">{tool.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.tool</span>
                  </div>
                  <div className="flex items-center gap-4 p-5">
                    <Scene ground={tool.ground} className="h-[72px] w-[72px] shrink-0 !rounded-xl">
                      {MOTIFS[tool.motif]}
                    </Scene>
                    <div className="min-w-0">
                      <h3 className="display text-[15px] font-bold">{tool.title.toLowerCase()}</h3>
                      <p className="mt-1 text-pretty text-[13px] text-muted">{tool.desc}</p>
                    </div>
                  </div>
                </a>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* a message from the founder */}
      <section className="cv px-5 py-20 md:py-28" style={cv(760, 640)}>
        <div className="mx-auto max-w-[640px]">
          <Reveal>
            <div className="wincard">
              <div className="wincard-bar">
                <span className="wincard-title">from founder</span>
              </div>
              <div className="space-y-4 p-7 text-[15px] leading-7 text-muted sm:p-10 md:text-[15.5px] md:leading-8">
                <p className="text-ink">
                  I needed four apps to get through a working day: dictation, screen recording, notes
                  and a focus timer.
                </p>
                <p>
                  Four logins, four monthly bills, and each one sent my voice or my screen to a
                  server.
                </p>
                <p>
                  owntools does all of it on your own computer. No account, it works offline, and
                  everything you make stays a file you own.
                </p>
                <p>Missing something? Write to me - I read every message.</p>
                <p className="pt-2 text-ink">szymon - building owntools</p>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* the math — ten subscriptions against one payment */}
      <SubscriptionBill />

      {/* pricing — a window to the sky */}
      <section id="pricing" className="cv sky-day ground ground--wide px-5 py-16 md:py-24" style={cv(2300, 1500)}>
        <div className="mx-auto max-w-4xl">
          <Reveal className="text-center">
            <p className="text-xs font-bold uppercase tracking-[0.16em] opacity-60">pricing</p>
            <h2 className="display mt-3 text-4xl md:text-5xl">free, or paid once</h2>
            <p className="mt-3 opacity-75">Every tool is free. Pro removes the badge from exports, for good.</p>
          </Reveal>
          <CheckoutNotice />
          <div className="mt-12 grid gap-6 md:grid-cols-2">
            <Reveal>
              <div className="wincard wincard--light h-full">
                <div className="wincard-bar">
                  <WinDots />
                  <span className="wincard-title">free.plan</span>
                </div>
                <div className="p-7">
                  <h3 className="display text-lg">free</h3>
                  <p className="text-[13px] text-[#6e6e73]">every tool, no limits</p>
                  <p className="display mt-3 text-5xl font-extrabold">$0</p>
                  <ul className="mt-5 space-y-2.5 text-sm text-[#6e6e73]">
                    <li className="flex gap-2"><Check size={15} className="mt-0.5 text-accent" /> all eight tools</li>
                    <li className="flex gap-2"><Check size={15} className="mt-0.5 text-accent" /> MP4 export up to 60 fps</li>
                    <li className="flex gap-2"><Check size={15} className="mt-0.5 text-accent" /> a small badge on exported videos</li>
                  </ul>
                  <DownloadCta className="btn mt-7 w-full border border-[#1d1d1f]/20 bg-white font-semibold text-[#1d1d1f] hover:bg-[#f5f5f7]">
                    download
                  </DownloadCta>
                </div>
              </div>
            </Reveal>
            <Reveal delay={0.08}>
              <div className="relative h-full pt-3">
                <span className="display absolute left-1/2 top-0 z-10 -translate-x-1/2 rounded-full bg-accent px-3.5 py-1 text-[11px] font-bold text-white shadow-lg">
                  popular
                </span>
                <div className="wincard wincard--light h-full">
                  <div className="wincard-bar" style={{ background: "#eaf4ff" }}>
                  <WinDots />
                  <span className="wincard-title">pro.plan</span>
                </div>
                <div className="p-7">
                  <h3 className="display text-lg">pro</h3>
                  <p className="text-[13px] text-[#6e6e73]">yours forever, no subscription</p>
                  <LivePrice
                    className="mt-3"
                    priceClass="font-display text-5xl font-extrabold tracking-[-0.045em]"
                    mutedClass="text-base font-medium text-[#6e6e73]"
                  />
                  <LiveStepNote className="mt-1.5 block text-[12.5px] font-semibold text-accent" />
                  <ul className="mt-4 space-y-2.5 text-sm text-[#6e6e73]">
                    <li className="flex gap-2"><Check size={15} className="mt-0.5 text-accent" /> no badge on exports</li>
                    <li className="flex gap-2"><Check size={15} className="mt-0.5 text-accent" /> lifetime updates</li>
                    <li className="flex gap-2"><Check size={15} className="mt-0.5 text-accent" /> offline key, no account</li>
                  </ul>
                  <CheckoutCta href={checkoutHref} className="btn btn-accent mt-7 w-full">
                    get the pro key
                  </CheckoutCta>
                  </div>
                </div>
              </div>
            </Reveal>
          </div>

          {/* the launch-price ladder: the rule is static, the counts are live */}
          <Reveal delay={0.06} className="mt-6">
            <PriceLadder />
          </Reveal>

          {/* the pitch, in someone else's words */}
          <Reveal delay={0.1} className="mt-8">
            <div className="terminal">
              <div className="terminal-bar">
                <WinDots />
                <span className="ml-1.5 text-[11px] font-medium text-white/40">messages.log</span>
                <span className="ml-auto text-[10px] font-semibold uppercase tracking-[0.1em] text-white/30">
                  tuesday, 22:14
                </span>
              </div>
              <div className="terminal-body">
                <div className="space-y-2.5">
                  {CHAT.map((m) => (
                    <p key={m.at + m.who} className="flex flex-wrap gap-x-2">
                      <span className={`w-[44px] shrink-0 ${m.me ? "ok" : "prompt"}`}>{m.me ? "you" : "friend"}</span>
                      <span className="w-[34px] shrink-0 text-white/25">{m.at}</span>
                      <span className={`w-full sm:w-auto sm:flex-1 ${m.me ? "cmd" : "text-white/70"}`}>
                        {m.text}
                      </span>
                    </p>
                  ))}
                </div>

                <div className="mt-5 flex flex-col items-start gap-4 border-t border-white/10 pt-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-white/45">
                    <span className="ok">✓</span> one payment · offline key · no account
                  </p>
                  <a
                    href="#faq"
                    className="btn !h-10 shrink-0 bg-white/10 !px-5 text-[13px] text-white hover:bg-white/20"
                  >
                    questions? read the faq
                  </a>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* faq */}
      <section id="faq" className="cv px-5 py-16 md:py-24" style={cv(1500, 1100)}>
        <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-[1fr_320px]">
          <div>
            <Reveal>
              <p className="kicker">support</p>
              <h2 className="display mt-3 text-4xl">frequently asked questions</h2>
            </Reveal>
            <div className="mt-8">
              <Faq />
            </div>
          </div>
          <Reveal delay={0.1} className="lg:pt-24">
            <div className="wincard">
              <div className="wincard-bar">
                <WinDots />
                <span className="wincard-title">help.app</span>
              </div>
              <div className="p-6">
                <p className="text-sm leading-6 text-muted">Still have a question? Ask - every message gets read.</p>
                {xUrl ? (
                  <a href={xUrl} rel="noreferrer" className="btn btn-primary mt-5 !h-10 w-full text-[13px]">
                    ask on x <ArrowRight size={14} />
                  </a>
                ) : contactEmail ? (
                  <a href={`mailto:${contactEmail}`} className="btn btn-primary mt-5 !h-10 w-full text-[13px]">
                    write to us <ArrowRight size={14} />
                  </a>
                ) : (
                  <p className="mt-5 text-[13px] font-medium text-muted">
                    contact details will be published before launch.
                  </p>
                )}
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* footer */}
      {/* roadmap — the course, mostly sailed */}
      <section id="roadmap" className="cv mx-auto max-w-6xl px-5 pb-16 pt-4 md:pb-24" style={cv(520, 420)}>
        <Reveal>
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="kicker">roadmap</p>
              <h2 className="display mt-2 text-3xl md:text-4xl">the course</h2>
            </div>
            <p className="pb-1 text-[13px] text-muted">{PORTS_DONE} ports behind us</p>
          </div>
        </Reveal>

        <Reveal delay={0.06}>
          <div className="mt-9 overflow-x-auto pb-1">
            <ol className="relative flex min-w-[980px] items-start">
              <span className="absolute inset-x-0 top-[6px] border-t border-dashed border-line" aria-hidden />
              <span
                className="absolute left-0 top-[6px] border-t-2 border-accent"
                style={{ width: COURSE_PROGRESS }}
                aria-hidden
              />
              {COURSE.map((p) => (
                <li key={p.t} className="relative flex flex-1 flex-col items-center px-1 text-center">
                  <span
                    className={
                      p.state === "done"
                        ? "h-[13px] w-[13px] rounded-full bg-accent"
                        : p.state === "now"
                          ? "rec-dot h-[13px] w-[13px] rounded-full bg-accent ring-4 ring-accent/20"
                          : "h-[13px] w-[13px] rounded-full border-2 border-line bg-paper"
                    }
                  />
                  <span className={`mt-3 text-[12.5px] leading-4 ${p.state === "next" ? "text-muted" : "font-semibold"}`}>
                    {p.t}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </Reveal>

        {/* the next port, the one worth naming */}
        <Reveal delay={0.1}>
          <div
            className="mt-10 flex flex-col gap-4 rounded-[16px] border border-line p-5 md:flex-row md:items-center md:gap-6 md:p-6"
            style={{ background: "color-mix(in srgb, var(--color-indigo) 5%, transparent)" }}
          >
            <span className="glow-icon shrink-0" style={{ ["--tint" as string]: "var(--color-indigo)" }}>
              <Sparkles className="h-4 w-4" />
            </span>
            <div>
              <p className="display text-xl">
                next port - <span className="text-indigo">mate</span>
              </p>
              <p className="mt-1 text-[14px] text-muted">
                An agent that gets things done with your tools, and asks before every step.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 md:ml-auto">
              {["asks first", "stays local"].map((c) => (
                <span key={c} className="rounded-full border border-indigo/25 px-2.5 py-1 text-[12px] font-medium text-indigo">
                  {c}
                </span>
              ))}
            </div>
          </div>
        </Reveal>
      </section>

      <footer className="dotted border-t border-line px-5 pb-10 pt-16">
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
            <BrandMark />
            <p className="text-xs text-muted">© {new Date().getFullYear()} owntools · your work stays yours</p>
          </div>
          <div className="mt-10 grid gap-10 text-sm sm:grid-cols-2 lg:grid-cols-5">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted">product</p>
              <div className="mt-3 flex flex-col gap-2 text-muted">
                <DownloadCta className="transition hover:text-ink">download for windows</DownloadCta>
                <a className="transition hover:text-ink" href="#pricing">pricing</a>
                <a className="transition hover:text-ink" href="#tools">tools</a>
                <span className="cursor-default">macos - soon</span>
              </div>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted">the studio</p>
              <div className="mt-3 flex flex-col gap-2 text-muted">
                <a className="transition hover:text-ink" href="#tools">focus - deep work</a>
                <a className="transition hover:text-ink" href="#tools">screeni - recording</a>
                <a className="transition hover:text-ink" href="#tools">launch - announce</a>
                <a className="transition hover:text-ink" href="#tools">dictate - voice</a>
                <a className="transition hover:text-ink" href="#tools">meet - calls</a>
                <a className="transition hover:text-ink" href="#tools">board - whiteboard</a>
                <a className="transition hover:text-ink" href="#tools">disk - drive space</a>
                <a className="transition hover:text-ink" href="#social">social - scheduler</a>
              </div>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted">free tools</p>
              <div className="mt-3 flex flex-col gap-2 text-muted">
                <a className="transition hover:text-ink" href="#free-tools">speech to text</a>
                <a className="transition hover:text-ink" href="#free-tools">subtitle generator</a>
                <a className="transition hover:text-ink" href="#free-tools">video → audio</a>
              </div>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted">company</p>
              <div className="mt-3 flex flex-col gap-2 text-muted">
                {xUrl ? (
                  <a className="transition hover:text-ink" href={xUrl} rel="noreferrer">owntools on x</a>
                ) : null}
                <a className="transition hover:text-ink" href="#faq">faq</a>
                <a className="transition hover:text-ink" href="/changelog">changelog</a>
                <a className="transition hover:text-ink" href={repoUrl} rel="noreferrer">github</a>
                {contactEmail ? (
                  <a className="transition hover:text-ink" href={`mailto:${contactEmail}`}>contact</a>
                ) : null}
              </div>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted">legal</p>
              <div className="mt-3 flex flex-col gap-2 text-muted">
                <a className="transition hover:text-ink" href="/privacy">privacy</a>
                <a className="transition hover:text-ink" href="/terms">terms</a>
                <a className="transition hover:text-ink" href="/refunds">refunds</a>
              </div>
            </div>
          </div>
          <p
            className="display outline-word mt-14 select-none text-center text-[16vw] font-extrabold leading-none md:text-[150px]"
            aria-hidden
          >
            owntools
          </p>
        </div>
      </footer>
    </div>
  );
}
