/**
 * "What's inside" — six cards, each a small working scene rather than an icon
 * in a coloured square. Every one is a `SceneCard`: a nature ground for
 * weather, a real fragment of the app floating on it, and two lines of copy
 * whose second half carries the point.
 *
 * The fragments are deliberately cropped by their frames. A list that runs off
 * the bottom edge reads as a list that continues; a complete little rectangle
 * centred in a swatch reads as a drawing of one.
 */

import { CloudOff, Eraser, Languages, Type, Wand2, Wifi } from "lucide-react";
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

        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {/* offline — the toggle is the whole argument */}
          <Reveal>
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
          <Reveal delay={0.05}>
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
          <Reveal delay={0.1}>
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
          <Reveal delay={0.05}>
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
          <Reveal delay={0.1}>
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
          <Reveal delay={0.15}>
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
        </div>
      </div>
    </section>
  );
}
