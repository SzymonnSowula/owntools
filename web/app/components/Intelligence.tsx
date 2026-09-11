/**
 * "it thinks on your machine" — the on-device language model and the three
 * settings that travel with it: the privacy receipt, small automations, and
 * sync without an account.
 *
 * Built from the same primitives as every other tinted surface on the page
 * (`.ground` / `.scene` / `.pane` / `.layer` in globals.css): the model sits
 * on a dusk scene, the three settings are SceneCards. No new CSS - a new card
 * is markup.
 *
 * The figures are the repo's, not a brochure's: the recommended model is a
 * 2.5 GB Qwen3 4B build that wants about 4 GB of free RAM while it answers
 * (packages/feature-llm/src/models.ts), and the download on the receipt is
 * the speech model the FAQ already quotes. The caveat under the list is the
 * whole truth of running a language model on a CPU, and it stays.
 */

import { ArrowRight, Cpu, Folder, FolderSync, Laptop, Monitor, ShieldCheck, Workflow } from "lucide-react";
import { Pane, Scene, SceneCard } from "./Scene";
import { Reveal } from "./Reveal";
import { ToolIcons } from "./WinDots";

/** One line per tool: what it hands the model and what it gets back. */
const USES: { tool: string; icon: keyof typeof ToolIcons; tint: string; what: string }[] = [
  {
    tool: "meet",
    icon: "meet",
    tint: "#1490f2",
    what: "The summary, the decisions and the to-dos, written from the transcript when the call ends.",
  },
  {
    tool: "screeni",
    icon: "video",
    tint: "#32ade6",
    what: "Chapters for the description, and the sentences worth cutting into a short clip.",
  },
  {
    tool: "social",
    icon: "social",
    tint: "#4a67ec",
    what: "A variant per network that fits its limit, in the brand voice your agents read.",
  },
  {
    tool: "dictate",
    icon: "dictate",
    tint: "#1e9bf0",
    what: "Punctuation, paragraphs and the tone a per-app profile asks for - fillers gone in Slack, e-mail tone in Outlook.",
  },
];

/** The receipt: every host this month, what it was for, and which way the bytes went. */
const RECEIPT = [
  { host: "huggingface.co", why: "speech model, once · 575 MB in" },
  { host: "github.com", why: "update check · in only" },
];

/** Three rules of the kind the automations page holds. */
const RULES = [
  { when: "every meeting", then: "Markdown in ~/meetings" },
  { when: "every export", then: "a draft post in social" },
  { when: "daily at 18:00", then: "today's dictation as a note" },
];

export function Intelligence() {
  return (
    <section id="intelligence" className="border-t border-line px-5 py-20 md:py-28">
      <div className="mx-auto max-w-6xl">
        <Reveal className="max-w-2xl">
          <p className="kicker !text-indigo">intelligence</p>
          <h2 className="display mt-3 text-4xl leading-[1.06] sm:text-5xl">it thinks on your machine.</h2>
          <p className="mt-4 max-w-xl text-[15px] leading-7 text-muted">
            One language model, installed with a click the way the speech models are, and every
            tool uses it. It reads your transcripts, your takes and your drafts - and none of that
            leaves the room.
          </p>
        </Reveal>

        <div className="mt-12 grid items-stretch gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
          {/* the model, mid-answer */}
          <Reveal className="min-w-0">
            <Scene ground="dusk" className="h-full min-h-[400px] p-4 pb-16 sm:p-6 sm:pb-16">
              <Pane className="relative mx-auto w-full max-w-[420px] p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[13px] font-semibold text-ink">Settings → Intelligence</p>
                  <span className="rounded-full bg-[#30d158]/15 px-2 py-0.5 text-[10px] font-bold text-[#30d158]">
                    installed
                  </span>
                </div>
                <div className="mt-2.5 flex items-center gap-2.5 rounded-md border border-line p-2">
                  <span className="glow-icon !h-8 !w-8 shrink-0 !rounded-lg" style={{ ["--tint" as string]: "#5e5ce6" }}>
                    <Cpu size={14} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[12px] font-semibold text-ink">Qwen3 4B · llama.cpp</span>
                    <span className="block text-[10.5px] leading-4 text-muted">
                      2.5 GB on disk · runs on your CPU · about 4 GB of RAM while it answers
                    </span>
                  </span>
                </div>
                <div className="mt-2.5 rounded-md border border-line p-2">
                  <p className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-muted">
                    purpose · meeting summary
                  </p>
                  <p className="mt-1 text-[11.5px] leading-5 text-ink">
                    <span className="font-semibold">Decided:</span> one price, paid once.{" "}
                    <span className="font-semibold">To-do:</span> send the pricing page tonight; ask about
                    the invoice.
                    <span className="caret text-accent">|</span>
                  </p>
                </div>
                <div className="mt-2.5 flex items-center justify-between rounded-md border border-line px-2 py-1.5 text-[11px]">
                  <span className="text-ink">
                    Cloud key <span className="text-muted">· optional</span>
                  </span>
                  <span className="flex items-center gap-1.5 text-muted">
                    off
                    <span className="flex h-4 w-7 items-center rounded-full bg-ink/15 p-0.5">
                      <span className="block h-3 w-3 rounded-full bg-white shadow" />
                    </span>
                  </span>
                </div>
              </Pane>
              <span className="layer absolute bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap !rounded-full bg-[#0b0b0d]/90 px-3 py-1.5 text-[11px] font-semibold text-white">
                on your cpu · the first answer takes a moment
              </span>
            </Scene>
          </Reveal>

          {/* what each tool does with it, and the caveat */}
          <Reveal delay={0.08} className="min-w-0">
            <div className="flex h-full flex-col gap-3">
              <ul className="grid gap-3">
                {USES.map((u) => (
                  <li key={u.tool} className="flex gap-3.5 rounded-[14px] border border-line bg-card p-4">
                    <span
                      className="glow-icon !h-8 !w-8 shrink-0 !rounded-lg [&>svg]:h-4 [&>svg]:w-4"
                      style={{ ["--tint" as string]: u.tint }}
                    >
                      {ToolIcons[u.icon]}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: u.tint }}>
                        {u.tool}
                      </span>
                      <span className="mt-0.5 block text-[14px] leading-6 text-ink">{u.what}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <div className="rounded-[14px] border border-line bg-card p-4 text-[13px] leading-6 text-muted">
                <span className="font-semibold text-ink">Honest caveat.</span> It needs a few GB of RAM, and
                the first answer takes a moment on a CPU. A cloud key of your own is optional and off by
                default; if you add one, Settings → Privacy shows every request it makes, with its
                purpose.
              </div>
            </div>
          </Reveal>
        </div>

        {/* the three settings that go with it */}
        <div className="mt-8 grid gap-5 md:grid-cols-3">
          <Reveal>
            <SceneCard
              ground="tide"
              tint="cyan"
              icon={<ShieldCheck size={15} />}
              title="A privacy receipt"
              lead="Settings → Privacy lists this month's network requests - every host, what it was for, bytes out and in - and what never leaves this device."
              point="Offline mode refuses all of it."
            >
              <Pane className="absolute inset-x-6 top-6 -bottom-6 overflow-hidden p-3">
                <p className="flex items-center justify-between font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-muted">
                  this month <span>offline mode: off</span>
                </p>
                {/* not `.display`: that rule lowercases, and a byte is a capital B */}
                <p className="mt-1.5 font-display text-[24px] font-bold leading-none tracking-[-0.045em] text-ink">0 B</p>
                <p className="mt-0.5 text-[11px] text-muted">left this machine</p>
                <ul className="mt-2.5 space-y-1.5 text-[10.5px]">
                  {RECEIPT.map((r) => (
                    <li key={r.host} className="flex items-center justify-between gap-2">
                      <span className="truncate font-mono text-ink">{r.host}</span>
                      <span className="shrink-0 text-muted">{r.why}</span>
                    </li>
                  ))}
                  <li className="flex items-center justify-between gap-2 border-t border-line pt-1.5">
                    <span className="font-semibold text-ink">never leaves</span>
                    <span className="text-muted">voice · screen · files · keys</span>
                  </li>
                </ul>
              </Pane>
            </SceneCard>
          </Reveal>

          <Reveal delay={0.05}>
            <SceneCard
              ground="dawn"
              tint="blue"
              icon={<Workflow size={15} />}
              title="Small automations"
              lead="Rules, not a workflow engine: every meeting to a Markdown file in a folder you pick, every export to a draft post, a watched folder that gets a transcript beside each recording."
              point="Set once, then forget they exist."
            >
              <div className="absolute inset-x-5 top-1/2 flex -translate-y-1/2 flex-col gap-2">
                {RULES.map((r) => (
                  <div
                    key={r.when}
                    className="layer flex items-center gap-2 !rounded-xl bg-white/95 px-2.5 py-2 text-[11px]"
                  >
                    <span className="shrink-0 font-semibold text-[#1d1d1f]">{r.when}</span>
                    <ArrowRight size={11} className="shrink-0 text-accent" />
                    <span className="truncate text-[#6e6e73]">{r.then}</span>
                  </div>
                ))}
              </div>
            </SceneCard>
          </Reveal>

          <Reveal delay={0.1}>
            <SceneCard
              ground="meadow"
              tint="indigo"
              icon={<FolderSync size={15} />}
              title="Sync without an account"
              lead="Point owntools at a folder another app already syncs - Dropbox, OneDrive, iCloud Drive, Syncthing - and your dictionary, history, boards, meetings, automations and looks follow you."
              point="Audio, recordings and credentials never sync."
            >
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 pb-6">
                <span className="layer flex items-center gap-2 !rounded-xl bg-white px-3 py-2 text-[11px] font-semibold text-[#1d1d1f]">
                  <Folder size={14} className="text-accent" /> ~/Dropbox/owntools
                </span>
                <svg width="150" height="22" viewBox="0 0 150 22" fill="none" aria-hidden>
                  <path
                    d="M75 2v6L22 14v6M75 8l53 6v6"
                    stroke="rgba(255,255,255,0.85)"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <div className="flex gap-3">
                  <span className="layer flex items-center gap-1.5 !rounded-xl bg-white/95 px-2.5 py-1.5 text-[10.5px] font-semibold text-[#1d1d1f]">
                    <Laptop size={13} /> this laptop
                  </span>
                  <span className="layer flex items-center gap-1.5 !rounded-xl bg-white/95 px-2.5 py-1.5 text-[10.5px] font-semibold text-[#1d1d1f]">
                    <Monitor size={13} /> the desk pc
                  </span>
                </div>
              </div>
              <span className="layer absolute bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap !rounded-full bg-[#0b0b0d]/90 px-2.5 py-1 text-[10px] font-semibold text-white">
                dictionary · history · boards · meetings · looks
              </span>
            </SceneCard>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
