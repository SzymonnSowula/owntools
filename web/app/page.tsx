import { Faq } from "./components/Faq";
import { WinDots, ToolIcons } from "./components/WinDots";

const download = process.env.NEXT_PUBLIC_DOWNLOAD_URL_WINDOWS ?? "#pricing";
const buy = process.env.NEXT_PUBLIC_CHECKOUT_URL ?? "#pricing";

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "shipshape",
  operatingSystem: "Windows, macOS",
  applicationCategory: "MultimediaApplication",
  description:
    "Local-first desktop studio: focus timer & tasks, cursor-following screen recordings, product launch videos from a URL, and on-device Whisper dictation.",
  offers: [
    { "@type": "Offer", price: "0", priceCurrency: "USD", name: "Free (badge on exports)" },
    { "@type": "Offer", price: "49", priceCurrency: "USD", name: "Pro (lifetime)" },
  ],
};

/* ------------------------------ hero mockups ------------------------------ */

function FocusCard() {
  return (
    <div className="wincard floaty w-[210px]" style={{ ["--tilt" as string]: "-4deg" }}>
      <div className="wincard-bar">
        <WinDots icon={ToolIcons.focus} />
        <span className="wincard-title">focus.app</span>
      </div>
      <div className="p-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">deep focus</p>
        <p className="mt-1 text-4xl font-bold tracking-[-0.04em]">25:00</p>
        <div className="mt-3 flex gap-1.5">
          <span className="rounded-full bg-accent px-3 py-1 text-[11px] font-semibold text-white">Start</span>
          <span className="rounded-full border border-line px-3 py-1 text-[11px] font-semibold text-muted">Reset</span>
        </div>
      </div>
    </div>
  );
}

function ScreeniCard() {
  return (
    <div className="wincard floaty w-[250px]" style={{ ["--tilt" as string]: "3deg", animationDelay: "-2s" }}>
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
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[#ff5f57]" /> REC 00:12 · auto-zoom on
        </p>
      </div>
    </div>
  );
}

function LaunchCard() {
  return (
    <div className="wincard floaty w-[230px]" style={{ ["--tilt" as string]: "-2.5deg", animationDelay: "-4s" }}>
      <div className="wincard-bar">
        <WinDots icon={ToolIcons.launch} />
        <span className="wincard-title">yourapp-launch.mp4</span>
      </div>
      <div className="dotted p-5 text-center">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">introducing</p>
        <p className="mt-1 text-2xl font-extrabold tracking-[-0.04em]">yourapp</p>
        <span className="mt-3 inline-block h-1.5 w-10 rounded-full bg-accent" />
      </div>
    </div>
  );
}

function DictateCard() {
  return (
    <div className="floaty" style={{ ["--tilt" as string]: "2deg", animationDelay: "-5.5s" }}>
      <div className="flex items-center gap-2 rounded-full bg-[#111]/95 px-5 py-3 text-[13px] font-semibold text-white shadow-2xl">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-[#ff5f57]" />
        listening… <span className="font-normal text-white/50">ctrl+shift+space</span>
      </div>
    </div>
  );
}

function NoteSticker({ text, tilt, className }: { text: string; tilt: string; className?: string }) {
  return (
    <div
      className={`floaty rounded-[10px] border border-line bg-[#fff8c4] px-3 py-2 text-[11px] font-medium text-ink/80 shadow-md ${className ?? ""}`}
      style={{ ["--tilt" as string]: tilt }}
    >
      {text}
    </div>
  );
}

/* ------------------------------ data ------------------------------ */

const LOOP = [
  {
    n: "01",
    name: "focus",
    line: "do the work",
    desc: "A full-screen timer that owns your screen, tasks with a daily plan, notes with backlinks, a heatmap of real screen time — and a scroll-guard that locks X until the task is done.",
  },
  {
    n: "02",
    name: "screeni",
    line: "record it beautifully",
    desc: "Hit record; every click gets a smooth cinematic zoom. Auto-cut the pauses, add captions from speech, wrap it in a clean frame — export crisp MP4, rendered on your machine.",
  },
  {
    n: "03",
    name: "launch",
    line: "announce it loudly",
    desc: "Paste your URL. shipshape grabs the name, tagline, brand color and hero shot, then renders a keynote-style launch video from templates. Seconds, not evenings.",
  },
  {
    n: "04",
    name: "dictate",
    line: "say it everywhere",
    desc: "Hold a hotkey in any app — a doc, a prompt box, a commit message — speak, release. On-device Whisper types clean text right where your cursor is.",
  },
];

const TOOL_ROWS = [
  {
    window: "screeni.app",
    name: "screeni",
    kicker: "the wow-machine",
    headline: "recordings that look edited — without editing",
    desc: "Auto-zoom follows your cursor so viewers always look at the right pixel. Trim, split, camera bubble, TikTok-style captions. Offline render straight to MP4 60 fps.",
    chips: ["auto-zoom", "auto-cut silence", "auto-captions (Whisper)", ".srt export", "9:16 · 1:1 · 16:9", "no ffmpeg, no upload"],
    mock: <ScreeniCard />,
  },
  {
    window: "dictate.app",
    name: "dictate",
    kicker: "your fastest keyboard",
    headline: "write, prompt and reply — with your voice",
    desc: "Ctrl+Shift+Space anywhere: draft an email, feed a prompt to Claude or Cursor, answer a ticket. ~4× faster than typing, on-device, in English and Polish.",
    chips: ["works in every app", "voice notes → your vault", "transcribe meetings & files", "translate to English", "100% offline"],
    mock: <DictateCard />,
  },
  {
    window: "focus.app",
    name: "focus",
    kicker: "the calm desk",
    headline: "a desk that keeps you honest",
    desc: "One MIT for the day, a timer that can take over the whole screen, habits, notes and an automatic heatmap of where your hours actually went.",
    chips: ["fullscreen timer + stopwatch", "tasks & day plan", "notes with backlinks", "scroll-guard for x.com", "screen-time heatmap"],
    mock: <FocusCard />,
  },
  {
    window: "launch.app",
    name: "launch",
    kicker: "the announcement engine",
    headline: "a launch video from a URL",
    desc: "Three templates in the shipshape aesthetic — keynote type, product showcase, floating windows. Your colors, your screenshot, your ship day.",
    chips: ["URL → video", "3 templates", "brand color auto-detect", "MP4 in seconds", "try it free in the browser →"],
    mock: <LaunchCard />,
    href: "/tools/launch-video-maker",
  },
];

const PERSONAS = [
  {
    window: "indie-hacker.you",
    title: "indie hackers",
    desc: "Run the whole loop solo: deep-work mornings, a demo that sells the product better than the landing page, a launch video for PH day — and build-in-public clips in between.",
    tools: ["focus", "screeni", "launch"],
  },
  {
    window: "developer.you",
    title: "developers",
    desc: "Bug repro as a 40-second clip instead of a ticket essay. PR walkthroughs your team actually watches. And prompts dictated into Claude or Cursor faster than you can type them.",
    tools: ["screeni", "dictate"],
  },
  {
    window: "copywriter.you",
    title: "copywriters & marketers",
    desc: "First drafts spoken, not typed — 150 words a minute. Client interviews transcribed locally. Vertical 9:16 screen clips for ads without opening a video editor.",
    tools: ["dictate", "screeni"],
  },
  {
    window: "creator.you",
    title: "creators & educators",
    desc: "Tutorials where the zoom guides the eye, captions write themselves, and the export looks professionally edited. Record once, publish in three formats.",
    tools: ["screeni", "focus"],
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

const MARQUEE_WORDS = ["focus", "record", "zoom", "cut", "caption", "launch", "dictate", "ship"];

/* ------------------------------ page ------------------------------ */

function MarqueeStrip() {
  const row = (
    <div className="marquee-track" aria-hidden>
      {MARQUEE_WORDS.map((w, i) => (
        <span key={i} className="flex items-center gap-11">
          <span className="text-2xl font-extrabold tracking-[-0.04em] text-ink/80">{w}</span>
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
        </span>
      ))}
    </div>
  );
  return (
    <div className="marquee border-y border-line bg-card py-4">
      {row}
      {row}
      {row}
    </div>
  );
}

export default function Home() {
  return (
    <div id="top">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <header className="sticky top-0 z-30 border-b border-line/70 bg-paper/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
          <a href="#top" className="text-[17px] font-bold tracking-[-0.03em]">shipshape</a>
          <nav className="flex items-center gap-6 text-sm text-muted">
            <a href="#tools" className="hidden hover:text-ink md:block">tools</a>
            <a href="#who" className="hidden hover:text-ink md:block">who it's for</a>
            <a href="/tools/launch-video-maker" className="hidden hover:text-ink md:block">free tools</a>
            <a href="#pricing" className="hidden hover:text-ink md:block">pricing</a>
            <a href={download} className="rounded-full bg-ink px-4 py-2 font-semibold text-white hover:bg-black">
              get shipshape
            </a>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="dotted relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 hidden lg:block" aria-hidden>
          <div className="absolute left-[4%] top-[16%]"><FocusCard /></div>
          <div className="absolute right-[3%] top-[12%]"><ScreeniCard /></div>
          <div className="absolute left-[7%] bottom-[10%]"><LaunchCard /></div>
          <div className="absolute right-[9%] bottom-[16%]"><DictateCard /></div>
          <NoteSticker text="ship it friday" tilt="-6deg" className="absolute left-[26%] top-[10%]" />
          <NoteSticker text="no cloud. promise." tilt="5deg" className="absolute right-[24%] bottom-[9%]" />
        </div>

        <div className="relative mx-auto max-w-3xl px-5 pb-28 pt-24 text-center md:pt-36 md:pb-36">
          <h1 className="text-6xl font-extrabold tracking-[-0.055em] md:text-[92px] md:leading-none">shipshape</h1>
          <p className="mt-5 text-lg text-muted md:text-xl">an entire maker studio that lives on your desktop</p>
          <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted">
            focus on the work, record it beautifully, launch it loudly, dictate it everywhere —
            one app, everything on your device.
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <a
              href={download}
              className="inline-flex h-12 items-center gap-2 rounded-full bg-ink px-6 text-sm font-semibold text-white shadow-[0_14px_30px_rgba(17,17,17,0.25)] hover:bg-black"
            >
              download for windows
            </a>
            <a
              href="/tools/launch-video-maker"
              className="inline-flex h-12 items-center rounded-full border border-line bg-card px-6 text-sm font-semibold hover:bg-white"
            >
              try a free tool in the browser
            </a>
          </div>
          <p className="mt-4 text-xs text-muted">free forever with a small badge · one-time pro key removes it · macos soon</p>
        </div>
      </section>

      <MarqueeStrip />

      {/* The loop — a real sequence, hence the numbering */}
      <section className="mx-auto max-w-6xl px-5 py-24">
        <h2 className="text-center text-4xl font-bold tracking-[-0.045em] md:text-5xl">
          the loop every maker runs.
          <br className="hidden md:block" /> now it's one app.
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-center text-muted">
          Other tools stop at one step. shipshape closes the whole loop — and everything stays on
          your machine.
        </p>
        <div className="mt-14 grid gap-5 md:grid-cols-4">
          {LOOP.map((step, i) => (
            <div key={step.n} className="relative">
              <div className="wincard h-full" style={{ transform: `rotate(${i % 2 ? 0.5 : -0.5}deg)` }}>
                <div className="wincard-bar">
                  <WinDots icon={ToolIcons[step.name as keyof typeof ToolIcons]} />
                  <span className="wincard-title">{step.name}.app</span>
                </div>
                <div className="p-5">
                  <p className="text-xs font-bold tracking-[0.08em] text-accent">{step.n}</p>
                  <h3 className="mt-1 text-lg font-bold tracking-[-0.03em]">{step.line}</h3>
                  <p className="mt-2 text-[13.5px] leading-6 text-muted">{step.desc}</p>
                </div>
              </div>
              {i < LOOP.length - 1 ? (
                <span className="absolute -right-4 top-1/2 hidden -translate-y-1/2 text-xl text-muted md:block" aria-hidden>
                  →
                </span>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      {/* Tool deep-dives */}
      <section id="tools" className="dotted border-y border-line py-24">
        <div className="mx-auto max-w-6xl px-5">
          <h2 className="text-center text-4xl font-bold tracking-[-0.045em]">four tools, one desk, zero cloud</h2>
          <div className="mt-16 flex flex-col gap-20">
            {TOOL_ROWS.map((tool, i) => (
              <div
                key={tool.name}
                className={`flex flex-col items-center gap-10 lg:gap-16 ${i % 2 ? "lg:flex-row-reverse" : "lg:flex-row"}`}
              >
                <div className="flex shrink-0 justify-center lg:w-[300px]">{tool.mock}</div>
                <div className="max-w-xl">
                  <p className="text-xs font-bold uppercase tracking-[0.14em] text-accent">{tool.kicker}</p>
                  <h3 className="mt-2 text-3xl font-bold tracking-[-0.04em]">{tool.headline}</h3>
                  <p className="mt-3 text-[15px] leading-7 text-muted">{tool.desc}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {tool.chips.map((chip) =>
                      tool.href && chip.endsWith("→") ? (
                        <a
                          key={chip}
                          href={tool.href}
                          className="rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs font-semibold text-accent hover:bg-accent/20"
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
            ))}
          </div>
        </div>
      </section>

      {/* Personas */}
      <section id="who" className="mx-auto max-w-6xl px-5 py-24">
        <h2 className="text-center text-4xl font-bold tracking-[-0.045em]">who ships with shipshape</h2>
        <p className="mx-auto mt-3 max-w-lg text-center text-muted">
          Not just creators. Anyone whose work lives on a screen — and has to be shown, shipped or
          written down.
        </p>
        <div className="mt-12 grid gap-5 sm:grid-cols-2">
          {PERSONAS.map((p, i) => (
            <div key={p.title} className="wincard" style={{ transform: `rotate(${i % 2 ? 0.4 : -0.4}deg)` }}>
              <div className="wincard-bar">
                <WinDots />
                <span className="wincard-title">{p.window}</span>
              </div>
              <div className="p-6">
                <h3 className="text-xl font-bold tracking-[-0.03em]">{p.title}</h3>
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
          ))}
        </div>
      </section>

      {/* Free tools */}
      <section id="free-tools" className="dotted border-y border-line px-5 py-20">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-center text-4xl font-bold tracking-[-0.045em]">free tools</h2>
          <p className="mx-auto mt-3 max-w-md text-center text-muted">
            Useful on their own. A taste of the studio.
          </p>
          <div className="mx-auto mt-10 grid max-w-4xl gap-4 sm:grid-cols-2">
            {FREE_TOOLS.map((tool) => (
              <a key={tool.title} href={tool.href} className="wincard block transition hover:-translate-y-0.5">
                <div className="wincard-bar">
                  <WinDots />
                  <span className="wincard-title">{tool.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.tool</span>
                  {tool.live ? (
                    <span className="ml-auto rounded-full bg-[#28c840]/15 px-2 py-0.5 text-[10px] font-bold text-[#1d9436]">
                      LIVE IN BROWSER
                    </span>
                  ) : null}
                </div>
                <div className="p-5">
                  <h3 className="font-bold tracking-[-0.02em]">{tool.title}</h3>
                  <p className="mt-1 text-[13px] text-muted">{tool.desc}</p>
                </div>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* Privacy */}
      <section className="px-5 py-20 text-center">
        <p className="text-3xl font-bold tracking-[-0.035em] md:text-4xl">
          no accounts. no telemetry. no upload button.
        </p>
        <p className="mx-auto mt-4 max-w-lg text-sm leading-6 text-muted">
          Your recordings, your notes, your voice, your screen-time stats — none of it touches a
          server. Even speech recognition runs on your CPU. shipshape is a light native app
          (~3&nbsp;MB installer), not a browser wearing a trench coat.
        </p>
      </section>

      {/* Pricing */}
      <section id="pricing" className="mx-auto max-w-4xl px-5 pb-24">
        <h2 className="text-center text-4xl font-bold tracking-[-0.045em]">simple, like it should be</h2>
        <p className="mt-3 text-center text-muted">
          the full app is free — exports carry a small badge. one payment removes it forever.
        </p>
        <div className="mt-12 grid gap-6 md:grid-cols-2">
          <div className="wincard">
            <div className="wincard-bar">
              <WinDots />
              <span className="wincard-title">free.plan</span>
            </div>
            <div className="p-7">
              <p className="text-4xl font-extrabold tracking-[-0.04em]">$0</p>
              <ul className="mt-5 space-y-2.5 text-sm text-muted">
                <li>✓ all four tools, no limits</li>
                <li>✓ 60 fps MP4 export with audio</li>
                <li>✓ on-device dictation &amp; captions</li>
                <li>✓ small "made with shipshape" badge on videos</li>
              </ul>
              <a href={download} className="mt-7 flex h-11 items-center justify-center rounded-full border border-line font-semibold hover:bg-white">
                download
              </a>
            </div>
          </div>
          <div className="wincard" style={{ background: "#141414" }}>
            <div className="wincard-bar" style={{ background: "#1d1d1d", borderColor: "#2a2a2a" }}>
              <WinDots />
              <span className="wincard-title">pro.plan</span>
            </div>
            <div className="p-7 text-white">
              <p className="text-4xl font-extrabold tracking-[-0.04em]">
                $49 <span className="text-base font-medium text-white/50">once</span>
              </p>
              <ul className="mt-5 space-y-2.5 text-sm text-white/80">
                <li>✓ everything in free</li>
                <li>✓ no badge — ever</li>
                <li>✓ offline license key, 2 machines</li>
                <li>✓ lifetime updates</li>
              </ul>
              <a href={buy} className="mt-7 flex h-11 items-center justify-center rounded-full bg-accent font-bold text-white hover:brightness-110">
                get the pro key
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="px-5 pb-24">
        <h2 className="mb-8 text-center text-4xl font-bold tracking-[-0.045em]">questions</h2>
        <Faq />
      </section>

      {/* Footer */}
      <footer className="dotted border-t border-line px-5 pb-10 pt-16">
        <div className="mx-auto grid max-w-5xl gap-10 text-sm sm:grid-cols-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted">product</p>
            <div className="mt-3 flex flex-col gap-2 text-muted">
              <a className="hover:text-ink" href={download}>download for windows</a>
              <a className="hover:text-ink" href="#pricing">pricing</a>
              <a className="hover:text-ink" href="#tools">tools</a>
            </div>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted">free tools</p>
            <div className="mt-3 flex flex-col gap-2 text-muted">
              <a className="hover:text-ink" href="/tools/launch-video-maker">launch video maker</a>
              <a className="hover:text-ink" href="#free-tools">speech to text</a>
              <a className="hover:text-ink" href="#free-tools">subtitle generator</a>
            </div>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted">company</p>
            <div className="mt-3 flex flex-col gap-2 text-muted">
              <a className="hover:text-ink" href="https://x.com" rel="noreferrer">building in public on x</a>
              <a className="hover:text-ink" href="#faq">faq</a>
            </div>
          </div>
        </div>
        <p
          className="mt-14 select-none text-center text-[16vw] font-extrabold leading-none tracking-[-0.06em] text-transparent md:text-[140px]"
          style={{ WebkitTextStroke: "2px rgba(17,17,17,0.14)" }}
          aria-hidden
        >
          shipshape
        </p>
        <p className="mt-6 text-center text-xs text-muted">© {new Date().getFullYear()} shipshape · your work stays yours</p>
      </footer>
    </div>
  );
}
