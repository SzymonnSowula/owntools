/**
 * "What's inside" — eight cards, each a small working scene rather than an icon
 * in a coloured square. Every one is a `SceneCard`: a nature ground for
 * weather, a real fragment of the app floating on it, and two lines of copy
 * whose second half carries the point.
 *
 * The fragments are deliberately cropped by their frames. A list that runs off
 * the bottom edge reads as a list that continues; a complete little rectangle
 * centred in a swatch reads as a drawing of one.
 *
 * Layout: a six-track grid. The first six cards span two tracks each (three a
 * row, the width they were drawn for); the two newest - meet and capture -
 * span three, so the last row fills the width instead of leaving a lopsided
 * pair, and a two-sided transcript and a search over screenshots get the room
 * they actually need. A four-column grid would have squeezed every scene
 * below the width its panes were laid out at.
 */

import { CloudOff, Eraser, Languages, ScanText, Search, Type, Users, Wand2, Wifi } from "lucide-react";
import { Pane, SceneCard } from "./Scene";
import { Reveal } from "./Reveal";

/** The words the vocabulary card is holding — real ones, awkward on purpose. */
const VOCAB = ["EBITDA", "Kraków", "owntools", "Anthropic"];

/** Where a take can land. The highlighted one is where the cursor already is. */
const TARGETS = [
  { name: "gmail", on: false },
  { name: "terminal", on: true },
  { name: "notion", on: false },
  { name: "board", on: false },
];

const HELLOS = [
  ["cześć", "hello", "こんにちは"],
  ["olá", "привет", "hallo"],
  ["bonjour", "안녕하세요", "ciao"],
];

/** A call, four lines in: the mic is you, the speakers are them. */
const CALL: { who: "you" | "them"; text: string }[] = [
  { who: "them", text: "can we lock the pricing this week?" },
  { who: "you", text: "yes - one price, paid once. I'll send the page tonight." },
  { who: "them", text: "and the mac build? half the team is on macs." },
  { who: "you", text: "after windows ships. it is on the roadmap." },
];

/** Two captures found by the words in them, not by their file names. */
const FOUND = [
  { name: "capture-0412.png", before: "…", hit: "Invoice 2026", after: "-041 · due 30 Sep" },
  { name: "capture-0398.png", before: "re: ", hit: "invoice 2026", after: ", still open" },
];

export function WhatsInside() {
  return (
    <section id="inside" className="border-t border-line px-5 py-20 md:py-28">
      <div className="mx-auto max-w-6xl">
        <Reveal className="max-w-2xl">
          <p className="kicker">what’s inside</p>
          <h2 className="display mt-3 text-4xl leading-[1.06] sm:text-5xl">
            small things, done properly.
          </h2>
          <p className="mt-4 max-w-xl text-[15px] leading-7 text-muted">
            The parts you only notice when they are missing - and every one of them runs on your
            own machine.
          </p>
        </Reveal>

        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-6">
          {/* offline — the toggle is the whole argument */}
          <Reveal className="lg:col-span-2">
            <SceneCard
              ground="tide"
              tint="cyan"
              icon={<Wifi size={15} />}
              title="Works offline"
              lead="The engine runs on your own CPU, so a plane, a basement or a dead hotspot changes nothing."
              point="No wi-fi, no problem."
            >
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="layer flex h-[52px] items-center gap-3 !rounded-full bg-white/25 px-1.5 pr-4 backdrop-blur-md">
                  <span className="h-10 w-10 rounded-full bg-white shadow-md" />
                  <span className="text-[13px] font-semibold text-white">wi-fi off</span>
                </span>
              </div>
              <span className="layer absolute bottom-4 left-1/2 -translate-x-1/2 !rounded-full bg-white/92 px-3 py-1 text-[11px] font-semibold text-[#1d1d1f]">
                still transcribing
              </span>
            </SceneCard>
          </Reveal>

          {/* vocabulary — a list that carries on past the frame */}
          <Reveal delay={0.05} className="lg:col-span-2">
            <SceneCard
              ground="dawn"
              tint="blue"
              icon={<Type size={15} />}
              title="Use your own words"
              lead="Names, acronyms and the terms only your field uses, typed in once."
              point="It spells them your way from then on."
            >
              <Pane className="absolute inset-x-8 top-7 -bottom-8 overflow-hidden p-2.5">
                <div className="flex items-center gap-2">
                  <span className="flex-1 rounded-md border border-line px-2 py-1 text-[11px] text-muted">
                    add a word
                  </span>
                  <span className="rounded-md bg-accent px-2 py-1 text-[10px] font-semibold text-white">
                    ctrl + enter
                  </span>
                </div>
                <ul className="mt-2 space-y-1.5">
                  {VOCAB.map((w) => (
                    <li
                      key={w}
                      className="flex items-center justify-between rounded-md bg-ink/[0.06] px-2 py-1.5 text-[11.5px] font-medium text-ink"
                    >
                      {w}
                      <Eraser size={11} className="text-muted" />
                    </li>
                  ))}
                </ul>
              </Pane>
            </SceneCard>
          </Reveal>

          {/* delivery — where the text actually goes */}
          <Reveal delay={0.1} className="lg:col-span-2">
            <SceneCard
              ground="meadow"
              tint="blue"
              icon={<Wand2 size={15} />}
              title="Lands where you type"
              lead="It types into the window you were already in - a text field, a terminal, a box on the whiteboard."
              point="No copy, no paste."
            >
              <div className="absolute inset-x-4 top-1/2 flex -translate-y-1/2 items-end justify-center gap-2">
                {TARGETS.map((t) => (
                  <span
                    key={t.name}
                    className={`layer flex flex-col items-center gap-1.5 !rounded-xl px-2.5 py-2 text-[10px] font-semibold ${
                      t.on ? "bg-white text-[#1d1d1f]" : "bg-white/55 text-[#1d1d1f]/60"
                    }`}
                    style={t.on ? { transform: "translateY(-10px) scale(1.08)" } : undefined}
                  >
                    <span
                      className={`h-7 w-7 rounded-lg ${t.on ? "bg-accent/15 ring-2 ring-accent" : "bg-[#1d1d1f]/8"}`}
                    />
                    {t.name}
                  </span>
                ))}
              </div>
            </SceneCard>
          </Reveal>

          {/* languages — a wall that runs off both edges */}
          <Reveal delay={0.05} className="lg:col-span-2">
            <SceneCard
              ground="dusk"
              tint="indigo"
              icon={<Languages size={15} />}
              title="99 languages"
              lead="Whisper understands them all and can turn any of them into English on the way out."
              point="Say it in whichever one is faster."
            >
              <div className="absolute inset-0 flex flex-col justify-center gap-1.5 overflow-hidden">
                {HELLOS.map((row, i) => (
                  <div
                    key={i}
                    className="flex shrink-0 justify-center gap-3 whitespace-nowrap text-[18px] font-semibold text-white/90"
                    style={{ transform: `translateX(${i % 2 ? 10 : -10}px)` }}
                  >
                    {row.map((w) => (
                      <span key={w} style={{ opacity: 0.55 + 0.15 * ((i + w.length) % 3) }}>
                        {w}
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            </SceneCard>
          </Reveal>

          {/* cleanup */}
          <Reveal delay={0.1} className="lg:col-span-2">
            <SceneCard
              ground="mist"
              tint="blue"
              icon={<Eraser size={15} />}
              title="Cleans up after you"
              lead="The ums, the false starts, the sentence you began twice, the subtitle line no one said."
              point="What lands is the sentence you meant."
            >
              <Pane className="absolute inset-x-5 top-1/2 -translate-y-1/2 p-3.5 text-[13px] leading-6 text-ink">
                <span className="text-muted line-through decoration-[#ff453a]/70">um, so</span>{" "}
                the point is -{" "}
                <span className="text-muted line-through decoration-[#ff453a]/70">the point is</span>{" "}
                we ship on friday.
              </Pane>
              <span className="layer absolute bottom-4 right-5 !rounded-full bg-white/92 px-2.5 py-1 text-[10.5px] font-semibold text-[#1d1d1f]">
                −7 words
              </span>
            </SceneCard>
          </Reveal>

          {/* privacy */}
          <Reveal delay={0.15} className="lg:col-span-2">
            <SceneCard
              ground="tide"
              tint="cyan"
              icon={<CloudOff size={15} />}
              title="Nothing leaves"
              lead="No account, no upload, no telemetry - there is no server to send it to."
              point="Every take is a file on your disk."
            >
              <div className="absolute inset-0 flex items-center justify-center">
                <Pane className="relative w-[172px] px-3.5 py-3">
                  <p className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-muted">
                    on this machine
                  </p>
                  <p className="mt-1 truncate font-mono text-[11px] text-ink">
                    ~/recordings/take-04.wav
                  </p>
                  <p className="mt-0.5 truncate font-mono text-[11px] text-muted">
                    ~/notes/friday.md
                  </p>
                </Pane>
              </div>
              <span className="layer absolute right-5 top-5 flex items-center gap-1.5 !rounded-full bg-white/92 px-2.5 py-1 text-[10.5px] font-semibold text-[#1d1d1f]">
                <CloudOff size={11} /> 0 requests
              </span>
            </SceneCard>
          </Reveal>

          {/* meet — the two sides of a call, told apart by where they came from */}
          <Reveal delay={0.05} className="lg:col-span-3">
            <SceneCard
              ground="dawn"
              tint="blue"
              icon={<Users size={15} />}
              title="Knows who was talking"
              lead="Your mic is one channel and what your machine plays is the other, so a call's transcript says which lines were you and which were them."
              point="No bot joins the call."
            >
              <Pane className="absolute inset-x-8 top-6 -bottom-8 overflow-hidden p-3">
                <p className="flex items-center justify-between font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-muted">
                  <span className="flex items-center gap-1.5">
                    <span className="rec-dot h-1.5 w-1.5 rounded-full bg-[#ff453a]" /> 32:08 · meet
                  </span>
                  <span className="hidden sm:inline">you = mic · them = speakers</span>
                </p>
                <ul className="mt-2 space-y-1.5">
                  {CALL.map((l, i) => (
                    <li key={i} className={`flex items-start gap-2 ${l.who === "you" ? "flex-row-reverse" : ""}`}>
                      <span
                        className={`mt-0.5 shrink-0 rounded-full px-1.5 py-px text-[8px] font-bold uppercase tracking-wide text-white ${
                          l.who === "you" ? "bg-accent" : "bg-cyan"
                        }`}
                      >
                        {l.who}
                      </span>
                      <span
                        className={`max-w-[78%] rounded-[8px] px-2 py-1 text-[11px] leading-[15px] text-ink ${
                          l.who === "you" ? "bg-accent/10" : "bg-ink/[0.06]"
                        }`}
                      >
                        {l.text}
                      </span>
                    </li>
                  ))}
                </ul>
              </Pane>
            </SceneCard>
          </Reveal>

          {/* capture — the library, searched by the words in the shots */}
          <Reveal delay={0.1} className="lg:col-span-3">
            <SceneCard
              ground="mist"
              tint="cyan"
              icon={<ScanText size={15} />}
              title="Reads your screenshots"
              lead="The text in a capture is read out of the pixels on-device, so you can copy it - and the library is searched by it: the error message, the invoice number, the name of the file."
              point="Type what it said, find the shot."
            >
              <Pane className="absolute inset-x-8 top-6 -bottom-8 overflow-hidden p-3">
                <div className="flex items-center gap-2 rounded-md border border-line px-2 py-1.5 text-[11px]">
                  <Search size={11} className="shrink-0 text-muted" />
                  <span className="text-ink">
                    invoice 2026<span className="caret text-accent">|</span>
                  </span>
                  <span className="ml-auto shrink-0 text-[10px] text-muted">2 captures</span>
                </div>
                <ul className="mt-2 grid grid-cols-2 gap-2">
                  {FOUND.map((s) => (
                    <li key={s.name} className="rounded-md border border-line p-1.5">
                      <span className="block h-10 rounded bg-gradient-to-br from-[#0a84ff]/70 to-[#5e5ce6]/70" />
                      <span className="mt-1 block truncate text-[10px] font-semibold text-ink">{s.name}</span>
                      <span className="block truncate text-[9.5px] text-muted">
                        {s.before}
                        <span className="rounded-[3px] bg-accent/20 px-0.5 text-ink">{s.hit}</span>
                        {s.after}
                      </span>
                    </li>
                  ))}
                </ul>
              </Pane>
            </SceneCard>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
