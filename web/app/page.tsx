import { Faq } from "./components/Faq";

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

function Dots() {
  return (
    <>
      <span className="wincard-dot r" />
      <span className="wincard-dot y" />
      <span className="wincard-dot g" />
    </>
  );
}

/* --- hero mockup cards (pure CSS, no assets) --- */

function FocusCard() {
  return (
    <div className="wincard floaty w-[210px]" style={{ ["--tilt" as string]: "-4deg" }}>
      <div className="wincard-bar">
        <Dots />
        <span className="wincard-title">focus.app</span>
      </div>
      <div className="p-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">deep focus</p>
        <p className="mt-1 text-4xl font-bold tracking-[-0.04em]">25:00</p>
        <div className="mt-3 flex gap-1.5">
          <span className="rounded-full bg-ink px-3 py-1 text-[11px] font-semibold text-white">Start</span>
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
        <Dots />
        <span className="wincard-title">demo-take.mp4</span>
      </div>
      <div className="bg-[#111015] p-3">
        <div
          className="h-[110px] rounded-[8px]"
          style={{
            background:
              "radial-gradient(80px 60px at 25% 25%, #7b6cff, transparent 70%), radial-gradient(90px 70px at 80% 30%, #2ad4c4, transparent 70%), radial-gradient(90px 60px at 55% 85%, #8b5cf6, transparent 70%), #1b1448",
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
        <Dots />
        <span className="wincard-title">yourapp-launch.mp4</span>
      </div>
      <div className="dotted p-5 text-center">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">introducing</p>
        <p className="mt-1 text-2xl font-extrabold tracking-[-0.04em]">yourapp</p>
        <span className="mt-3 inline-block h-1.5 w-10 rounded-full bg-violet" />
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

const TOOLS = [
  {
    window: "focus.app",
    name: "focus",
    color: "#111111",
    desc: "A calm desk for deep work: MIT of the day, pomodoro, tasks, a Notion-style notebook, habits, ambient sounds and a GitHub-style heatmap of your real screen time. It can even guard your scroll on X until the task is done.",
  },
  {
    window: "screeni.app",
    name: "screeni",
    color: "#0e9a8a",
    desc: "Hit record and every click gets a smooth cinematic zoom. Trim, add your camera, auto-captions (on-device Whisper) — and export crisp 60 fps MP4 rendered offline. No ffmpeg, no upload.",
  },
  {
    window: "launch.app",
    name: "launch",
    color: "#6b5bff",
    desc: "Paste your product's URL. shipshape pulls the name, tagline, brand color and hero shot, then renders a keynote-style launch video from templates — on your machine, in seconds.",
  },
  {
    window: "dictate.app",
    name: "dictate",
    color: "#ff715f",
    desc: "Hold a hotkey anywhere, speak, release — clean text lands wherever your cursor is. Powered by whisper.cpp running locally, so your voice never touches a server.",
  },
];

export default function Home() {
  return (
    <div id="top">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <header className="sticky top-0 z-30 border-b border-line/70 bg-paper/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
          <a href="#top" className="text-[17px] font-bold tracking-[-0.03em]">
            shipshape
          </a>
          <nav className="flex items-center gap-6 text-sm text-muted">
            <a href="#tools" className="hidden hover:text-ink md:block">tools</a>
            <a href="#pricing" className="hidden hover:text-ink md:block">pricing</a>
            <a href="#faq" className="hidden hover:text-ink md:block">faq</a>
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

        <div className="relative mx-auto max-w-3xl px-5 pb-28 pt-24 text-center md:pt-36 md:pb-40">
          <h1 className="text-6xl font-extrabold tracking-[-0.055em] md:text-[92px] md:leading-none">
            shipshape
          </h1>
          <p className="mt-5 text-lg text-muted md:text-xl">
            an entire maker studio that lives on your desktop
          </p>
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
            <span className="inline-flex h-12 items-center rounded-full border border-line bg-card px-6 text-sm font-semibold text-muted">
               macos soon
            </span>
          </div>
          <p className="mt-4 text-xs text-muted">free forever with a small badge · one-time pro key removes it</p>
        </div>
      </section>

      {/* Tools */}
      <section id="tools" className="mx-auto max-w-6xl px-5 py-24">
        <h2 className="text-center text-4xl font-bold tracking-[-0.045em]">
          four tools. one desk. zero cloud.
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-center text-muted">
          the boring parts of shipping — staying focused, showing your work, announcing it — handled
          by one coherent app instead of five subscriptions.
        </p>
        <div className="mt-12 grid gap-6 md:grid-cols-2">
          {TOOLS.map((tool, i) => (
            <div key={tool.name} className="wincard" style={{ transform: `rotate(${i % 2 ? 0.5 : -0.5}deg)` }}>
              <div className="wincard-bar">
                <Dots />
                <span className="wincard-title">{tool.window}</span>
              </div>
              <div className="p-6">
                <div
                  className="mb-3 inline-block rounded-[10px] px-3 py-1 text-sm font-bold text-white"
                  style={{ background: tool.color }}
                >
                  {tool.name}
                </div>
                <p className="text-[15px] leading-7 text-muted">{tool.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Privacy strip */}
      <section className="dotted border-y border-line px-5 py-16 text-center">
        <p className="text-2xl font-bold tracking-[-0.03em] md:text-3xl">
          no accounts. no telemetry. no upload button.
        </p>
        <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-muted">
          your recordings, notes, stats and even speech recognition stay on your machine. shipshape
          is a native app (Tauri, ~3&nbsp;MB installer), not a browser wearing a trench coat.
        </p>
      </section>

      {/* Pricing */}
      <section id="pricing" className="mx-auto max-w-4xl px-5 py-24">
        <h2 className="text-center text-4xl font-bold tracking-[-0.045em]">simple, like it should be</h2>
        <p className="mt-3 text-center text-muted">
          the full app is free — exports carry a small badge. one payment removes it forever.
        </p>
        <div className="mt-12 grid gap-6 md:grid-cols-2">
          <div className="wincard">
            <div className="wincard-bar">
              <Dots />
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
              <a
                href={download}
                className="mt-7 flex h-11 items-center justify-center rounded-full border border-line font-semibold hover:bg-white"
              >
                download
              </a>
            </div>
          </div>
          <div className="wincard" style={{ background: "#141414" }}>
            <div className="wincard-bar" style={{ background: "#1d1d1d", borderColor: "#2a2a2a" }}>
              <Dots />
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
              <a
                href={buy}
                className="mt-7 flex h-11 items-center justify-center rounded-full bg-accent font-bold text-white hover:brightness-110"
              >
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

      <footer className="dotted border-t border-line px-5 pb-10 pt-16 text-center">
        <p
          className="select-none text-[16vw] font-extrabold leading-none tracking-[-0.06em] text-transparent md:text-[140px]"
          style={{ WebkitTextStroke: "2px rgba(17,17,17,0.14)" }}
          aria-hidden
        >
          shipshape
        </p>
        <p className="mt-6 text-xs text-muted">
          © {new Date().getFullYear()} shipshape · built in public ·{" "}
          <a className="underline hover:text-ink" href="https://x.com" rel="noreferrer">
            follow the process on x
          </a>
        </p>
      </footer>
    </div>
  );
}
