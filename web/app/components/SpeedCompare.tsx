/**
 * "Faster than typing" — the one claim the whole dictate tool rests on, shown
 * as a comparison rather than asserted in a sentence.
 *
 * Two stages side by side: the keyboard, kept quiet and grey, and the voice,
 * given the nature ground and every layer. The numbers are the ordinary
 * averages — average typing lands around 38 wpm, unhurried speech around 150,
 * which is where the 4x in the headline comes from — and the latency under it
 * is the measured one from this laptop, so nothing here needs an asterisk.
 */

import { Delete } from "lucide-react";
import { ListeningPill, Pane, Scene } from "./Scene";
import { Reveal } from "./Reveal";

const TYPED = "so I went back through the recording and";
const SPOKEN = "…and pulled the three moments that actually mattered.";

/** wpm → bar width, with the faster side pinned to the full track. */
const barWidth = (wpm: number) => `${Math.round((wpm / 150) * 100)}%`;

function Stat({ label, wpm, quiet = false }: { label: string; wpm: number; quiet?: boolean }) {
  return (
    <div className={quiet ? "text-muted" : "text-ink"}>
      <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted">{label}</p>
      <p className="display mt-0.5 flex items-baseline gap-1.5 text-4xl md:text-5xl">
        {wpm}
        <span className="text-base font-semibold tracking-normal text-muted">wpm</span>
      </p>
      <span className="mt-3 block h-1.5 overflow-hidden rounded-full bg-line">
        <span className={`wpm-fill block h-full rounded-full ${quiet ? "bg-muted/50" : "bg-accent"}`} style={{ width: barWidth(wpm) }} />
      </span>
    </div>
  );
}

export function SpeedCompare() {
  return (
    <section id="speed" className="cv border-b border-line px-5 py-20 md:py-28" style={{ ["--cv" as string]: "1300px", ["--cv-lg" as string]: "900px" }}>
      <div className="mx-auto max-w-6xl">
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="kicker">speed</p>
          <h2 className="display mt-3 text-4xl leading-[1.05] sm:text-5xl md:text-6xl">
            4x faster
            <br />
            <span className="dim">than typing</span>
          </h2>
        </Reveal>

        <div className="mt-12 grid items-stretch gap-5 lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]">
          {/* the keyboard — deliberately the quiet half */}
          <Reveal className="h-full">
            <div className="wincard h-full !rounded-[18px] p-5 md:p-6">
              <Stat label="keyboard" wpm={38} quiet />
              <Scene ground="mist" className="mt-6 h-44 md:h-52">
                <Pane className="absolute inset-x-4 top-1/2 -translate-y-1/2 p-3.5">
                  <p className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-muted">
                    still typing
                  </p>
                  <p className="mt-1 text-[13px] leading-6 text-ink">
                    {TYPED}
                    <span className="caret text-accent">|</span>
                  </p>
                </Pane>
                <span className="layer absolute bottom-4 right-4 flex items-center gap-1 !rounded-full bg-white/90 px-2.5 py-1 font-mono text-[10px] font-semibold text-[#6e6e73]">
                  <Delete size={12} /> <Delete size={12} /> <Delete size={12} />
                </span>
              </Scene>
              <p className="mt-5 text-[13px] leading-6 text-muted">You stop to fix typos mid-thought.</p>
            </div>
          </Reveal>

          {/* the voice — every layer this page has */}
          <Reveal delay={0.08} className="h-full">
            <div className="wincard h-full !rounded-[18px] p-5 md:p-6">
              <Stat label="your voice" wpm={150} />

              <Scene ground="meadow" className="mt-6 h-44 md:h-52">
                {/* the spoken line, curving through the scene the way it arrives:
                    all at once, ahead of your hands */}
                <svg
                  className="absolute inset-0 h-full w-full"
                  viewBox="0 0 560 220"
                  preserveAspectRatio="xMidYMid slice"
                  aria-hidden
                >
                  <defs>
                    <linearGradient id="speech-fade" x1="0" x2="1">
                      <stop offset="0" stopColor="#fff" stopOpacity="0" />
                      <stop offset="0.16" stopColor="#fff" stopOpacity="0.95" />
                      <stop offset="0.84" stopColor="#fff" stopOpacity="0.95" />
                      <stop offset="1" stopColor="#fff" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path id="speech-arc" d="M -20 128 Q 280 74 580 120" fill="none" />
                  <text
                    fill="url(#speech-fade)"
                    className="text-[15px] font-semibold"
                    style={{ letterSpacing: "-0.01em" }}
                  >
                    <textPath href="#speech-arc" startOffset="50%" textAnchor="middle">
                      {SPOKEN}
                    </textPath>
                  </text>
                </svg>

                <ListeningPill className="absolute left-5 top-5" hint="" meter />
                <span className="layer absolute bottom-[52px] right-8 !rounded-full bg-accent px-2.5 py-1 text-[11px] font-semibold text-white">
                  0.7 s to the text
                </span>
                <Pane className="absolute inset-x-5 bottom-4 flex items-center gap-2.5 px-3 py-2">
                  <span className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-muted">
                    cursor
                  </span>
                  <span className="truncate text-[12.5px] text-ink">…that is the cut.</span>
                  <span className="caret ml-auto text-accent">|</span>
                </Pane>
              </Scene>

              <p className="mt-5 text-[13px] leading-6 text-muted">
                Fillers removed, punctuation added. <span className="font-semibold text-ink">Offline.</span>
              </p>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
