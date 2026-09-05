import { Fragment } from "react";
import { ArrowRight, Check, Play, Sparkles } from "lucide-react";
import { DemoZoom } from "./components/DemoZoom";
import { Faq } from "./components/Faq";
import { Toolkit } from "./components/Toolkit";
import { Reveal } from "./components/Reveal";
import { ThemeToggle } from "./components/ThemeToggle";
import { WinDots, ToolIcons } from "./components/WinDots";
import { CheckoutCta, DOWNLOAD_SOON, DownloadCta } from "./components/Cta";
import { PRICE, contactEmail, downloadUrl, repoUrl, xUrl } from "@/lib/site";

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "shipshape",
  operatingSystem: "Windows, macOS",
  applicationCategory: "MultimediaApplication",
  description:
    "Dictate into any app, transcribe audio and video, record your screen, take notes, sketch on a whiteboard, schedule social posts, translate, and turn a link into a video — a desktop app that runs entirely on your own machine.",
  offers: [
    { "@type": "Offer", price: "0", priceCurrency: PRICE.currency, name: "Free (badge on exports)" },
    { "@type": "Offer", price: String(PRICE.amount), priceCurrency: PRICE.currency, name: "Pro (lifetime)" },
  ],
};

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
        <p className="mt-2 text-[9px] text-[#6e6e73]">queued by claude · reviewed by you</p>
      </div>
    </div>
  );
}

function DictateCard() {
  return (
    <div className="floaty" style={{ ["--tilt" as string]: "2deg", animationDelay: "-5.5s" }}>
      <div className="flex items-center gap-2 rounded-full bg-[#0b0b0d]/95 px-5 py-3 text-[13px] font-semibold text-white shadow-2xl">
        <span className="rec-dot h-2.5 w-2.5 rounded-full bg-[#ff453a]" />
        listening… <span className="font-normal text-white/50">ctrl+shift+space</span>
      </div>
    </div>
  );
}

function NoteSticker({ text, tilt, className }: { text: string; tilt: string; className?: string }) {
  return (
    <div
      className={`floaty rounded-[10px] border border-[#1d1d1f]/10 bg-[#fff8c4] px-3 py-2 text-[11px] font-medium text-[#1d1d1f]/80 shadow-md ${className ?? ""}`}
      style={{ ["--tilt" as string]: tilt }}
    >
      {text}
    </div>
  );
}

function TerminalCard() {
  return (
    <div className="terminal w-full max-w-[520px]">
      <div className="terminal-bar">
        <WinDots />
        <span className="ml-1.5 text-[11px] font-medium text-white/40">claude — ~/dev/yourapp</span>
      </div>
      <div className="terminal-body">
        <p><span className="prompt">➜</span> <span className="cmd">claude</span></p>
        <p className="text-white/35">─ Claude Code · ~/dev/yourapp ─</p>
        <p className="mt-2">
          <span className="prompt">›</span> <span className="cmd">add dark mode to the settings view, persist it, and update the tests</span>
        </p>
        <p className="text-white/40 italic">…spoken, not typed — 3.4s via shipshape dictate</p>
        <p className="mt-2"><span className="ok">✓</span> 4 files changed · tests passing</p>
        <div className="mt-3 flex items-center gap-2">
          <span className="flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-[11px] font-semibold text-white">
            <span className="rec-dot h-1.5 w-1.5 rounded-full bg-[#ff453a]" /> listening…
          </span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ data ------------------------------ */

const LOOP = [
  {
    n: "01",
    name: "board",
    line: "think it through",
    desc: "An endless whiteboard. Paste a screenshot, draw boxes and arrows around it, move things until they make sense — every board is a file on your disk.",
  },
  {
    n: "02",
    name: "focus",
    line: "do the work",
    desc: "A full-screen timer that owns your screen, tasks with a daily plan, notes with backlinks, a heatmap of real screen time — and a scroll-guard that locks X until the task is done.",
  },
  {
    n: "03",
    name: "screeni",
    line: "record it beautifully",
    desc: "Hit record; every click gets a smooth cinematic zoom. Auto-cut the pauses, add captions from speech, wrap it in a clean frame — export crisp MP4, rendered on your machine.",
  },
  {
    n: "04",
    name: "launch",
    line: "share it widely",
    desc: "Paste any URL. shipshape grabs the name, tagline, colors and hero shot, then renders a keynote-style video from templates. Seconds, not evenings.",
  },
  {
    n: "05",
    name: "dictate",
    line: "say it everywhere",
    desc: "Press a hotkey in any app — an email, a message, a form, a prompt box — speak, press it again. On-device Whisper types clean text right where your cursor is.",
  },
  {
    n: "06",
    name: "social",
    line: "post it everywhere",
    desc: "Write once, schedule to every network from a calendar. Let an agent draft the week over the local API, then review each post before it goes out — from your machine, not a cloud.",
  },
];

const TOOL_ROWS = [
  {
    name: "screeni",
    tint: "text-cyan",
    kicker: "the wow-machine",
    headline: "recordings that look edited — without editing",
    desc: "Auto-zoom follows your cursor so viewers always look at the right pixel. Trim, split, camera bubble, TikTok-style captions. Offline render straight to MP4 60 fps.",
    chips: ["auto-zoom", "auto-cut silence", "auto-captions (Whisper)", ".srt export", "9:16 · 1:1 · 16:9", "no ffmpeg, no upload"],
    mock: <ScreeniCard />,
  },
  {
    name: "dictate",
    tint: "text-accent",
    kicker: "your fastest keyboard",
    headline: "write, prompt and reply — with your voice",
    desc: "Ctrl+Shift+Space anywhere: an email, a message, an essay, a form, a prompt box. ~4× faster than typing, on-device, in English and Polish.",
    chips: ["works in every app", "voice notes → your vault", "transcribe meetings & files", "translate to English", "100% offline"],
    mock: <DictateCard />,
  },
  {
    name: "focus",
    tint: "text-accent",
    kicker: "the calm desk",
    headline: "a desk that keeps you honest",
    desc: "One MIT for the day, a timer that can take over the whole screen, habits, notes and an automatic heatmap of where your hours actually went.",
    chips: ["fullscreen timer + stopwatch", "tasks & day plan", "notes with backlinks", "scroll-guard for x.com", "screen-time heatmap"],
    mock: <FocusCard />,
  },
  {
    name: "board",
    tint: "text-accent",
    kicker: "the endless whiteboard",
    headline: "paste a screenshot, think around it",
    desc: "An infinite canvas for the messy part: boxes, arrows, hand-drawn notes, screenshots dropped straight from the clipboard. Many boards, each one a file on your disk — export PNG or SVG when it's ready.",
    chips: ["shapes, arrows & freehand", "paste or drop screenshots", "text in three fonts", "layers & opacity", "PNG · SVG · .excalidraw export", "no account, no sync"],
    mock: <BoardCard />,
  },
  {
    name: "social",
    tint: "text-accent",
    kicker: "the scheduler agents can drive",
    headline: "run your social media on autopilot",
    desc: "A visual calendar for every network you post to. Write once with per-network previews and limits, or let Claude Code, Cursor, Codex, ChatGPT, OpenClaw or Hermes queue the week over a local MCP server — every post waits in the calendar for your review.",
    chips: ["week · month · list", "per-network previews & limits", "threads, tags, repeats", "local REST + MCP API", "bluesky · mastodon · telegram · discord · slack · dev.to · medium", "x & linkedin with your own app"],
    mock: <SocialCard />,
  },
  {
    name: "launch",
    tint: "text-indigo",
    kicker: "the announcement engine",
    headline: "a launch video from a URL",
    desc: "Three templates in the shipshape aesthetic — keynote type, product showcase, floating windows. Your colors, your screenshot, your announcement.",
    chips: ["URL → video", "3 templates", "brand color auto-detect", "MP4 in seconds", "try it free in the browser →"],
    mock: <LaunchCard />,
    href: "/tools/launch-video-maker",
  },
];

const MOMENTS = [
  {
    window: "rather-talk.you",
    title: "when you'd rather talk than type",
    desc: "An email, a message, an essay, a long reply, a form nobody enjoys filling in. Press the hotkey, say it, press again — clean text lands wherever your cursor already is.",
    tools: ["dictate"],
  },
  {
    window: "just-show-it.you",
    title: "when showing beats explaining",
    desc: "A bug, a lesson, a how-to for someone who isn't in the room. Hit record and the zoom follows your cursor, so whoever watches always looks at the right thing.",
    tools: ["screeni"],
  },
  {
    window: "hours-of-audio.you",
    title: "when you're sitting on hours of audio",
    desc: "A lecture, an interview, a meeting you recorded, a voice memo from a walk. Drop the file in and read it back as text or subtitles — without uploading a second of it.",
    tools: ["dictate", "screeni"],
  },
  {
    window: "quiet-hour.you",
    title: "when the day needs a quiet hour",
    desc: "One task that actually matters, a timer that can take over the whole screen, notes that link to each other, and an honest map of where the hours went.",
    tools: ["focus"],
  },
  {
    window: "wont-fit-in-a-line.you",
    title: "when the idea won't fit in a line",
    desc: "A plan, a flow, a screenshot that needs three arrows and a question mark. Paste it onto an endless board, draw around it, and come back tomorrow to find it exactly where you left it.",
    tools: ["board"],
  },
  {
    window: "the-week-is-written.you",
    title: "when the posts are written but the week isn't",
    desc: "Five networks, one announcement, and a calendar that shows the whole week at a glance. Queue them from the composer — or let an agent do the queuing — and every post waits for your yes.",
    tools: ["social"],
  },
];

const FREE_TOOLS = [
  {
    title: "Launch video maker",
    desc: "Keynote-style product video, rendered in your browser. Free, no sign-up.",
    href: "/tools/launch-video-maker",
    live: true,
  },
  {
    title: "Speech to text",
    desc: "Transcribe any audio or video file on-device — in the free desktop app.",
    href: "#pricing",
    live: false,
  },
  {
    title: "Subtitle (.srt) generator",
    desc: "Timed captions from speech, exported as SRT — in the free desktop app.",
    href: "#pricing",
    live: false,
  },
  {
    title: "Video → audio",
    desc: "Pull the audio track out of any video — in the free desktop app.",
    href: "#pricing",
    live: false,
  },
];

/* a friend checks in — the pitch in someone else's words */
const CHAT: { who: string; at: string; me?: boolean; text: string }[] = [
  { who: "friend", at: "22:14", text: "hey! how is it going? did you ever test that shipshape thing?" },
  {
    who: "you",
    at: "22:16",
    me: true,
    text: "every day now. I talk, it types — notes, emails, prompts. and the screen recordings come out looking edited.",
  },
  { who: "friend", at: "22:16", text: "worth it? is it another subscription" },
  {
    who: "you",
    at: "22:17",
    me: true,
    text: "paid once, unlocked forever. cheapest thing I bought this year and the one I open the most.",
  },
  { who: "friend", at: "22:18", text: "ok. downloading it now." },
];

/* ------------------------------ roadmap ------------------------------ */

/* the course: ports behind us, the one we're in, the ones ahead */
const COURSE: { t: string; state: "done" | "now" | "next" }[] = [
  { t: "dictate anywhere", state: "done" },
  { t: "record with auto-zoom", state: "done" },
  { t: "transcribe anything", state: "done" },
  { t: "url → launch video", state: "done" },
  { t: "workspaces & sessions", state: "done" },
  { t: "board — an endless whiteboard", state: "done" },
  { t: "social — schedule everywhere", state: "done" },
  { t: "one look, day & night", state: "now" },
  { t: "mate, the agent", state: "next" },
  { t: "macOS", state: "next" },
  { t: "a model of your own", state: "next" },
];

const AGENTS = ["OpenClaw", "Hermes", "Claude", "ChatGPT", "Codex", "Cursor"];

const SOCIAL_POINTS = [
  { t: "one calendar, every network.", d: "Week, month or list. Drag a post to another slot, filter by channel, tag or status." },
  { t: "write once, tune per network.", d: "A global text plus a tab for each channel, live previews, per-network character limits, threads where they exist, Unicode bold and italic where they don't." },
  { t: "agents plan, you approve.", d: "A local REST + MCP server with a token. An agent lists your channels and queues the week; nothing leaves the calendar without you." },
  { t: "publishes from your machine.", d: "shipshape runs in the tray and sends each post straight to the network at its time — retries, a notification, and a catch-up sheet if the app was closed." },
];

function SocialCalendarCard() {
  const days = ["mon 6", "tue 7", "wed 8", "thu 9", "fri 10", "sat 11", "sun 12"];
  const hours = ["9 am", "10 am", "11 am", "1 pm", "3 pm"];
  const cells: Record<string, { tag: string; tagColor: string; text: string; badge: string; draft?: boolean; done?: boolean }> = {
    "0-0": { tag: "news", tagColor: "#ff375f", text: "new build: board + social", badge: "#0085ff", done: true },
    "1-1": { tag: "personal", tagColor: "#5e5ce6", text: "small daily workouts beat…", badge: "#000000" },
    "2-0": { tag: "product", tagColor: "#0a84ff", text: "thread: url → video 🧵", badge: "#6364ff" },
    "2-3": { tag: "news", tagColor: "#ff375f", text: "record button now in the tray", badge: "#26a5e4" },
    "3-2": { tag: "product", tagColor: "#0a84ff", text: "dictation tip: quiet rooms", badge: "#0a66c2" },
    "4-1": { tag: "personal", tagColor: "#5e5ce6", text: "draft: quiet hour", badge: "#0085ff", draft: true },
    "5-4": { tag: "product", tagColor: "#0a84ff", text: "weekly changelog", badge: "#5865f2" },
  };
  return (
    <div className="wincard w-full max-w-[560px]">
      <div className="wincard-bar">
        <WinDots icon={ToolIcons.social} />
        <span className="wincard-title">social.app — april 6 – 12, 2026</span>
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
                      <div className={`overflow-hidden rounded-[5px] border border-line bg-card shadow-sm ${cell.done ? "opacity-80" : ""}`}>
                        <div className="px-1 py-px text-[7px] font-bold uppercase tracking-wide text-white" style={{ background: cell.tagColor }}>
                          {cell.tag}
                        </div>
                        <div className="flex items-start gap-1 px-1 py-1">
                          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full" style={{ background: cell.badge }} />
                          <span className="line-clamp-2 text-[8px] leading-[1.25] text-ink">
                            {cell.draft ? <span className="text-muted">Draft: </span> : null}
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
          <span>4 scheduled · 1 draft · 1 published</span>
          <span>queued by claude code over mcp · reviewed by you</span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ small pieces ------------------------------ */

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
      <span className="display text-[17px] font-bold tracking-[-0.03em]">shipshape</span>
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
  return (
    <div id="top">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      {/* nav */}
      <header className="fixed inset-x-0 top-0 z-40 px-3">
        <div
          className="mx-auto mt-3 flex max-w-5xl items-center justify-between rounded-full border border-line px-4 py-2.5 backdrop-blur-xl md:mt-4 md:px-5"
          style={{ background: "var(--nav-bg)" }}
        >
          <a href="#top" aria-label="shipshape home">
            <BrandMark />
          </a>
          <nav className="flex items-center gap-3 text-sm font-medium text-muted md:gap-5">
            <a href="#tools" className="hidden transition hover:text-ink md:block">tools</a>
            <a href="#who" className="hidden transition hover:text-ink md:block">what it’s for</a>
            <a href="#roadmap" className="hidden transition hover:text-ink md:block">roadmap</a>
            <a href="/tools/launch-video-maker" className="hidden transition hover:text-ink md:block">free tools</a>
            <a href="#pricing" className="hidden transition hover:text-ink md:block">pricing</a>
            <ThemeToggle />
            {/* before launch this leads to pricing, where the status is spelled out */}
            <a href={downloadUrl ?? "#pricing"} className="btn btn-accent !h-9 !px-4 text-[13px]">
              get shipshape
            </a>
          </nav>
        </div>
      </header>

      {/* hero — the sky above the desk */}
      <section className="hero-sky ascii-sky relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 hidden xl:block" aria-hidden>
          <div className="relative mx-auto h-full max-w-[1600px]">
            <div className="absolute left-[3%] top-32"><FocusCard /></div>
            <div className="pointer-events-auto absolute right-[2%] top-28"><DemoZoom /></div>
            <div className="absolute bottom-[14%] left-[6%]"><LaunchCard /></div>
            <div className="absolute bottom-[22%] right-[7%]"><DictateCard /></div>
            <NoteSticker text="say it, don't type it" tilt="-6deg" className="absolute left-[24%] top-24" />
            <NoteSticker text="no cloud. promise." tilt="5deg" className="absolute bottom-[12%] right-[26%]" />
          </div>
        </div>

        <div className="relative mx-auto max-w-3xl px-5 pb-24 pt-32 text-center md:pb-40 md:pt-44 lg:pb-44 lg:pt-48">
          <p className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/15 px-4 py-1.5 text-[13px] font-semibold text-white backdrop-blur-md md:text-sm">
            one app instead of six subscriptions
          </p>
          <h1
            className="display text-5xl font-extrabold sm:text-6xl md:text-[80px] md:leading-[0.98] lg:text-[92px]"
            style={{ textShadow: "0 2px 24px rgba(10,30,60,0.35)" }}
          >
            your work.
            <br />
            your device.
          </h1>
          <p className="mt-6 text-lg font-medium text-white md:text-xl" style={{ textShadow: "0 1px 12px rgba(10,30,60,0.4)" }}>
            Dictate anywhere, transcribe anything, record your screen, take notes,
            sketch on a whiteboard, schedule your posts, translate, turn a link into a video.
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
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
            <a href="/tools/launch-video-maker" className="btn btn-ghost">
              <Play size={15} /> try a free tool in the browser
            </a>
          </div>
          <p className="mt-5 text-[13px] font-medium text-white/80">
            also for macOS — soon <ArrowRight size={12} className="inline" />
          </p>
          <p
            className="mx-auto mt-8 max-w-md text-sm leading-6 text-white"
            style={{ textShadow: "0 1px 14px rgba(10,30,60,0.55)" }}
          >
            shipshape does all of it on your own machine — nothing is uploaded, nothing is
            logged, and the core tools keep working with the wi-fi off.
            <br />
            <span className="text-white/85">paid once · no accounts · everything on your device</span>
          </p>
        </div>
      </section>

      {/* 01 — one app bento */}
      <section className="mx-auto max-w-6xl px-5 py-16 md:py-24">
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
                <div className="nature flex h-64 items-center justify-center p-6 md:h-72">
                  <div className="relative w-full max-w-sm">
                    <div className="mx-auto flex w-fit items-center gap-2 rounded-full bg-[#0b0b0d]/90 px-4 py-2.5 text-xs font-semibold text-white shadow-xl">
                      <span className="rec-dot h-2 w-2 rounded-full bg-[#ff453a]" /> listening…{" "}
                      <span className="font-normal text-white/50">ctrl+shift+space</span>
                    </div>
                    <div className="mt-3 rounded-xl bg-white/95 p-3.5 shadow-xl">
                      <p className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-[#6e6e73]">cursor</p>
                      <p className="mt-0.5 text-[13px] text-[#1d1d1f]">
                        the next clear thought lands right here.<span className="animate-pulse text-accent">|</span>
                      </p>
                    </div>
                  </div>
                </div>
                <div className="p-5 md:p-6">
                  <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted">dictation</p>
                  <h3 className="display mt-1.5 text-xl">speak to any app.</h3>
                  <p className="mt-1.5 max-w-xl text-sm leading-6 text-muted">
                    Press a key, talk, press it again. Clean text lands wherever your cursor is — a
                    note, an email, code, a prompt. Your voice never leaves the room.
                  </p>
                </div>
              </div>
            </Reveal>

            {/* focus + launch, side by side */}
            <div className="grid gap-5 sm:grid-cols-2">
              <Reveal delay={0.05}>
                <div className="bento h-full">
                  <div className="nature flex h-36 items-center justify-center p-4">
                    <div className="relative rounded-xl bg-white/95 px-5 py-3 text-center shadow-xl">
                      <p className="font-mono text-[8px] font-bold uppercase tracking-[0.14em] text-[#6e6e73]">deep focus</p>
                      <p className="display text-2xl text-[#1d1d1f]">25:00</p>
                    </div>
                  </div>
                  <div className="p-5">
                    <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted">focus</p>
                    <h3 className="display mt-1.5 text-lg">one task. zero noise.</h3>
                  </div>
                </div>
              </Reveal>
              <Reveal delay={0.1}>
                <div className="bento h-full">
                  <div className="nature flex h-36 items-center justify-center p-4">
                    <div className="relative rounded-xl bg-white/95 px-5 py-3 text-center shadow-xl">
                      <p className="font-mono text-[8px] font-bold uppercase tracking-[0.14em] text-[#6e6e73]">introducing</p>
                      <p className="display text-xl font-extrabold text-[#1d1d1f]">yourapp</p>
                      <span className="mx-auto mt-1 block h-1 w-8 rounded-full bg-accent" />
                    </div>
                  </div>
                  <div className="p-5">
                    <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted">launch</p>
                    <h3 className="display mt-1.5 text-lg">your url becomes a video.</h3>
                  </div>
                </div>
              </Reveal>
            </div>

          </div>

          {/* right column */}
          <div className="flex flex-col gap-5">
            <Reveal delay={0.08}>
              <div className="bento">
                <div className="nature flex h-56 items-center justify-center p-5">
                  <div className="relative w-full max-w-[220px] overflow-hidden rounded-xl border border-white/30 shadow-2xl">
                    <div
                      className="h-24"
                      style={{
                        background:
                          "radial-gradient(70px 50px at 28% 32%, #0a84ff, transparent 70%), radial-gradient(76px 56px at 76% 38%, #5e5ce6, transparent 70%), #101a2e",
                      }}
                    >
                      <div className="relative left-[20%] top-[26%] h-[50%] w-[58%] rounded border border-white/25 bg-white/90 shadow-lg" />
                    </div>
                    <p className="flex items-center gap-1.5 bg-[#101012] px-3 py-2 text-[10px] font-semibold text-white/80">
                      <span className="rec-dot h-1.5 w-1.5 rounded-full bg-[#ff453a]" /> REC · auto-zoom on
                    </p>
                  </div>
                </div>
                <div className="p-5">
                  <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted">screen recording</p>
                  <h3 className="display mt-1.5 text-lg">looks edited. isn’t.</h3>
                  <p className="mt-1.5 text-sm leading-6 text-muted">
                    The zoom follows your cursor. Silence cuts itself. Captions write themselves.
                  </p>
                </div>
              </div>
            </Reveal>
            <Reveal delay={0.12}>
              <div className="bento flex-1">
                <div className="nature flex h-44 items-center justify-center p-5">
                  <div className="relative">
                    <div className="absolute -left-10 top-2 w-24 rotate-[-7deg] rounded-lg bg-white/90 p-2 shadow-lg">
                      <p className="font-mono text-[8px] text-[#6e6e73]">focus.app</p>
                    </div>
                    <div className="absolute -right-12 top-4 w-24 rotate-[6deg] rounded-lg bg-white/90 p-2 shadow-lg">
                      <p className="font-mono text-[8px] text-[#6e6e73]">launch.app</p>
                    </div>
                    <div className="relative w-28 rounded-lg bg-white p-2.5 shadow-xl">
                      <p className="font-mono text-[8px] text-[#6e6e73]">shipshape.exe</p>
                      <p className="mt-0.5 font-mono text-[9px] font-bold text-[#1d1d1f]">~3 MB</p>
                    </div>
                  </div>
                </div>
                <div className="p-5">
                  <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted">built native</p>
                  <h3 className="display mt-1.5 text-lg">windows today. macos next.</h3>
                  <p className="mt-1.5 text-sm leading-6 text-muted">
                    A light native app — not a browser wearing a trench coat.
                  </p>
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* the toolkit — browse capabilities by tool */}
      <section className="dotted overflow-hidden border-y border-line py-16 md:py-24">
        <div className="mx-auto max-w-6xl px-5">
          <Reveal>
            <Toolkit />
          </Reveal>
        </div>
      </section>

      {/* the loop */}
      <section className="mx-auto max-w-6xl px-5 py-16 md:py-24">
        <SectionHead
          kicker="the loop"
          title={
            <>
              from a thought to something
              <br className="hidden md:block" /> you can share.
            </>
          }
          sub="Most apps cover one step of that. shipshape covers all six — and every file stays on your machine."
        />
        <div className="mt-10 grid gap-5 sm:grid-cols-2 md:mt-14 lg:grid-cols-3">
          {LOOP.map((step, i) => (
            <Reveal key={step.n} delay={i * 0.08} className="relative">
              <div className="wincard h-full" style={{ transform: `rotate(${i % 2 ? 0.5 : -0.5}deg)` }}>
                <div className="wincard-bar">
                  <WinDots icon={ToolIcons[step.name as keyof typeof ToolIcons]} />
                  <span className="wincard-title">{step.name}.app</span>
                </div>
                <div className="p-5">
                  <p className="text-xs font-bold tracking-[0.08em] text-accent">{step.n}</p>
                  <h3 className="display mt-1 text-lg">{step.line}</h3>
                  <p className="mt-2 text-[13.5px] leading-6 text-muted">{step.desc}</p>
                </div>
              </div>
              {i < LOOP.length - 1 ? (
                <span className="absolute -right-4 top-1/2 hidden -translate-y-1/2 text-xl text-muted lg:block" aria-hidden>
                  →
                </span>
              ) : null}
            </Reveal>
          ))}
        </div>
      </section>

      {/* tool deep-dives */}
      <section id="tools" className="py-16 md:py-24">
        <div className="mx-auto max-w-6xl px-5">
          <SectionHead
            kicker="the studio"
            title="six tools, one desk, zero cloud"
            sub="Use one of them or all six — nothing here assumes what your job is."
          />
          <div className="mt-16 flex flex-col gap-20">
            {TOOL_ROWS.map((tool, i) => (
              <Reveal key={tool.name}>
                <div className={`flex flex-col items-center gap-10 lg:gap-16 ${i % 2 ? "lg:flex-row-reverse" : "lg:flex-row"}`}>
                  <div className="flex shrink-0 justify-center lg:w-[300px]">{tool.mock}</div>
                  <div className="max-w-xl">
                    <p className={`kicker ${tool.tint}`}>{tool.kicker}</p>
                    <h3 className="display mt-2 text-3xl">{tool.headline}</h3>
                    <p className="mt-3 text-[15px] leading-7 text-muted">{tool.desc}</p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {tool.chips.map((chip) =>
                        tool.href && chip.endsWith("→") ? (
                          <a
                            key={chip}
                            href={tool.href}
                            className="rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs font-semibold text-accent transition hover:bg-accent/20"
                          >
                            {chip}
                          </a>
                        ) : (
                          <span key={chip} className="rounded-full border border-line bg-card px-3 py-1 text-xs font-medium text-muted">
                            {chip}
                          </span>
                        ),
                      )}
                    </div>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* social — the scheduler agents can drive */}
      <section id="social" className="border-t border-line py-20 md:py-28">
        <div className="mx-auto max-w-6xl px-5">
          <Reveal className="mx-auto max-w-3xl text-center">
            <p className="kicker">social</p>
            <h2 className="display mt-4 text-4xl leading-[1.08] sm:text-5xl md:text-6xl">
              run your social media on <span className="marker">autopilot</span> with AI agents
            </h2>
            <p className="mx-auto mt-5 max-w-2xl text-[15px] leading-7 text-muted md:text-base">
              Plan, generate, and schedule posts automatically to 30+ social media networks — then review and edit everything in a visual calendar.
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
                <span className="font-semibold text-ink">honest status.</span> Live today: Bluesky, Mastodon, Telegram, Discord, Slack, Dev.to, Medium.
                X and LinkedIn: with your own free developer app. Threads, Instagram, Facebook, Reddit, Pinterest, TikTok, YouTube and ~20 more:
                in the catalogue, publishing arrives in later builds.
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* dictate everywhere — big typography + agentic terminal */}
      <section className="dotted border-y border-line py-20 md:py-28">
        <div className="mx-auto max-w-6xl px-5">
          <Reveal className="text-center">
            <p className="kicker">integrations</p>
            <h2 className="display mt-4 text-4xl leading-[1.05] sm:text-5xl sm:leading-[1.02] md:text-7xl">
              <span className="dim">dictate works</span> anywhere
              <br />
              you can <span className="dim">type</span>
            </h2>
            <p className="mt-5 text-muted">
              Slack, Notion, Gmail, a search box, a form…
              <br />
              <span className="text-ink">you say it, shipshape types it.</span>
            </p>
          </Reveal>

          <div className="mt-20 flex flex-col items-center gap-10 lg:flex-row lg:gap-16">
            <Reveal className="max-w-md">
              <p className="kicker !text-cyan">beep boop</p>
              <h3 className="display mt-2 text-3xl">faster agentic workflows</h3>
              <p className="mt-3 text-[15px] leading-7 text-muted">
                One example of “anywhere”: a terminal. Use shipshape dictate with Claude Code,
                Cursor or any agentic coding app — talk through the change and skip the typing.
              </p>
              <ul className="mt-5 space-y-3 text-sm text-muted">
                <li className="flex gap-2.5">
                  <Check size={16} className="mt-0.5 shrink-0 text-accent" />
                  <span><strong className="text-ink">works where you code.</strong> One hotkey drives a whole fleet of agents faster than you can type.</span>
                </li>
                <li className="flex gap-2.5">
                  <Check size={16} className="mt-0.5 shrink-0 text-accent" />
                  <span><strong className="text-ink">less typing, more building.</strong> Give agents more context by talking through the change out loud.</span>
                </li>
              </ul>
            </Reveal>
            <Reveal delay={0.1} className="flex w-full justify-center lg:w-auto">
              <TerminalCard />
            </Reveal>
          </div>
        </div>
      </section>

      {/* personas */}
      <section id="who" className="mx-auto max-w-6xl px-5 py-16 md:py-24">
        <SectionHead
          kicker="what it's for"
          title="six moments, not six job titles"
          sub="There is no niche here. If you talk, record, listen or just need to concentrate, one of these is already your day."
        />
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
                <div className="p-6">
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
            </Reveal>
          ))}
        </div>
      </section>

      {/* free tools */}
      <section id="free-tools" className="dotted border-y border-line px-5 py-14 md:py-20">
        <div className="mx-auto max-w-6xl">
          <SectionHead kicker="free tools" title="useful on their own" sub="A taste of the studio — no sign-up, no install for the browser ones." />
          <div className="mx-auto mt-10 grid max-w-4xl gap-4 sm:grid-cols-2">
            {FREE_TOOLS.map((tool, i) => (
              <Reveal key={tool.title} delay={(i % 2) * 0.07}>
                <a href={tool.href} className="wincard block h-full transition hover:-translate-y-0.5">
                  <div className="wincard-bar">
                    <WinDots />
                    <span className="wincard-title">{tool.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.tool</span>
                    {tool.live ? (
                      <span className="ml-auto rounded-full bg-[#30d158]/15 px-2 py-0.5 text-[10px] font-bold text-[#30d158]">
                        LIVE IN BROWSER
                      </span>
                    ) : null}
                  </div>
                  <div className="p-5">
                    <h3 className="display text-[15px] font-bold">{tool.title.toLowerCase()}</h3>
                    <p className="mt-1 text-[13px] text-muted">{tool.desc}</p>
                  </div>
                </a>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* a message from the founder */}
      <section className="px-5 py-20 md:py-28">
        <div className="mx-auto max-w-[640px]">
          <Reveal>
            <div className="wincard">
              <div className="wincard-bar">
                <span className="wincard-title">from founder</span>
              </div>
              <div className="space-y-4 p-7 text-[15px] leading-7 text-muted sm:p-10 md:text-[15.5px] md:leading-8">
                <p className="text-ink">
                  I counted it one evening: four apps to get through one working day. one to turn
                  my voice into text, one to record the screen, one to hold the notes, one to keep
                  me off the internet for an hour.
                </p>
                <p>
                  four logins, four charges every month, and every one of them sending my voice and
                  my screen to a server I will never see.
                </p>
                <p>
                  <span className="text-ink">
                    why pay for all the other tools if you can have it in one simple app?
                  </span>{" "}
                  that question is the whole thing. I could not find an honest answer, so I stopped
                  looking and started building.
                </p>
                <p>
                  shipshape is the desk I wanted: dictate, record, write, sketch, focus. one window, one
                  hotkey, no account. it keeps working with the wi-fi off, and everything you make
                  stays a file on your machine — not a row in somebody’s database.
                </p>
                <p>
                  I am building it on my own and in the open. it is free while it grows, and if it
                  ever saves you an hour, one payment keeps it yours for good — no renewals, no
                  seats, no plan to outgrow.
                </p>
                <p>
                  if something is missing, write to me. I read all of it, and most of what is in the
                  app started as somebody’s message.
                </p>
                <p className="pt-2 text-ink">szymon — building shipshape</p>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* pricing — a window to the sky */}
      <section id="pricing" className="sky-day px-5 py-16 md:py-24">
        <div className="mx-auto max-w-4xl">
          <Reveal className="text-center">
            <p className="text-xs font-bold uppercase tracking-[0.16em] opacity-60">pricing</p>
            <h2 className="display mt-3 text-4xl md:text-5xl">shipshape, your way</h2>
            <p className="mt-3 opacity-75">
              the full app is free — exports carry a small badge. one payment removes it forever.
            </p>
          </Reveal>
          <div className="mt-12 grid gap-6 md:grid-cols-2">
            <Reveal>
              <div className="wincard wincard--light h-full">
                <div className="wincard-bar">
                  <WinDots />
                  <span className="wincard-title">free.plan</span>
                </div>
                <div className="p-7">
                  <h3 className="display text-lg">free</h3>
                  <p className="text-[13px] text-[#6e6e73]">see what the fuss is about</p>
                  <p className="display mt-3 text-5xl font-extrabold">$0</p>
                  <ul className="mt-5 space-y-2.5 text-sm text-[#6e6e73]">
                    <li className="flex gap-2"><Check size={15} className="mt-0.5 text-accent" /> all six tools, no limits</li>
                    <li className="flex gap-2"><Check size={15} className="mt-0.5 text-accent" /> 60 fps MP4 export with audio</li>
                    <li className="flex gap-2"><Check size={15} className="mt-0.5 text-accent" /> on-device dictation &amp; captions</li>
                    <li className="flex gap-2"><Check size={15} className="mt-0.5 text-accent" /> small “made with shipshape” badge on videos</li>
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
                  <p className="display mt-3 text-5xl font-extrabold">
                    {PRICE.display} <span className="text-base font-medium text-[#6e6e73]">once</span>
                  </p>
                  <ul className="mt-5 space-y-2.5 text-sm text-[#6e6e73]">
                    <li className="flex gap-2"><Check size={15} className="mt-0.5 text-accent" /> everything in free</li>
                    <li className="flex gap-2"><Check size={15} className="mt-0.5 text-accent" /> no badge — ever</li>
                    <li className="flex gap-2"><Check size={15} className="mt-0.5 text-accent" /> offline license key, no account</li>
                    <li className="flex gap-2"><Check size={15} className="mt-0.5 text-accent" /> lifetime updates</li>
                  </ul>
                  <CheckoutCta className="btn btn-accent mt-7 w-full">
                    get the pro key
                  </CheckoutCta>
                  </div>
                </div>
              </div>
            </Reveal>
          </div>

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
      <section id="faq" className="mx-auto max-w-6xl px-5 py-16 md:py-24">
        <div className="grid gap-12 lg:grid-cols-[1fr_320px]">
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
                <p className="text-sm leading-6 text-muted">
                  Can’t find the answer you’re looking for? Ask directly — every message gets read.
                </p>
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
      <section id="roadmap" className="mx-auto max-w-6xl px-5 pb-16 pt-4 md:pb-24">
        <Reveal>
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="kicker">roadmap</p>
              <h2 className="display mt-2 text-3xl md:text-4xl">the course</h2>
            </div>
            <p className="pb-1 text-[13px] text-muted">6 ports behind us</p>
          </div>
        </Reveal>

        <Reveal delay={0.06}>
          <div className="mt-9 overflow-x-auto pb-1">
            <ol className="relative flex min-w-[760px] items-start">
              <span className="absolute inset-x-0 top-[6px] border-t border-dashed border-line" aria-hidden />
              <span className="absolute left-0 top-[6px] w-[64%] border-t-2 border-accent" aria-hidden />
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
                next port — <span className="text-indigo">mate</span>
              </p>
              <p className="mt-1 text-[14px] text-muted">
                Say what has to be done. Get it back done — on this machine, every step yours to approve.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 md:ml-auto">
              {["asks first", "stays local", "your tools are its hands"].map((c) => (
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
            <p className="text-xs text-muted">© {new Date().getFullYear()} shipshape · your work stays yours</p>
          </div>
          <div className="mt-10 grid gap-10 text-sm sm:grid-cols-2 lg:grid-cols-5">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted">product</p>
              <div className="mt-3 flex flex-col gap-2 text-muted">
                <DownloadCta className="transition hover:text-ink">download for windows</DownloadCta>
                <a className="transition hover:text-ink" href="#pricing">pricing</a>
                <a className="transition hover:text-ink" href="#tools">tools</a>
                <span className="cursor-default">macos — soon</span>
              </div>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted">the studio</p>
              <div className="mt-3 flex flex-col gap-2 text-muted">
                <a className="transition hover:text-ink" href="#tools">focus — deep work</a>
                <a className="transition hover:text-ink" href="#tools">screeni — recording</a>
                <a className="transition hover:text-ink" href="#tools">launch — announce</a>
                <a className="transition hover:text-ink" href="#tools">dictate — voice</a>
                <a className="transition hover:text-ink" href="#tools">board — whiteboard</a>
                <a className="transition hover:text-ink" href="#social">social — scheduler</a>
              </div>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted">free tools</p>
              <div className="mt-3 flex flex-col gap-2 text-muted">
                <a className="transition hover:text-ink" href="/tools/launch-video-maker">launch video maker</a>
                <a className="transition hover:text-ink" href="#free-tools">speech to text</a>
                <a className="transition hover:text-ink" href="#free-tools">subtitle generator</a>
                <a className="transition hover:text-ink" href="#free-tools">video → audio</a>
              </div>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted">company</p>
              <div className="mt-3 flex flex-col gap-2 text-muted">
                {xUrl ? (
                  <a className="transition hover:text-ink" href={xUrl} rel="noreferrer">building in public on x</a>
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
            shipshape
          </p>
        </div>
      </footer>
    </div>
  );
}
