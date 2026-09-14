/**
 * The twelve quick tools — the small jobs you would otherwise hand to a random
 * website that wants your file and your email address.
 *
 * The list mirrors `packages/feature-tools/src/catalogue.tsx`; if a tool is
 * added there, add it here, because this is the only place on the site that
 * claims a count. The scene shows one of them mid-job (YouTube → transcript),
 * drawn the same way every other stage on this page is, so a missing
 * screenshot never leaves a hole.
 */

import {
  AudioLines,
  FileText,
  Film,
  Globe,
  Image as ImageIcon,
  Images,
  Mic,
  Repeat,
  Subtitles,
  Type,
  MonitorPlay,
} from "lucide-react";
import type { ReactNode } from "react";
import { Pane, Scene } from "./Scene";
import { Reveal } from "./Reveal";

type Quick = { name: string; desc: string; icon: ReactNode };

const QUICK: Quick[] = [
  { name: "Transcribe a file", desc: "Audio or video → text & .srt", icon: <FileText size={14} /> },
  { name: "Translate to English", desc: "Any speech → English text", icon: <Globe size={14} /> },
  { name: "YouTube → transcript", desc: "Paste a link, get the captions", icon: <MonitorPlay size={14} /> },
  { name: "Convert subtitles", desc: ".srt ↔ .vtt ↔ text, shift timing", icon: <Subtitles size={14} /> },
  { name: "Voice note", desc: "Speak, get a note in focus", icon: <Mic size={14} /> },
  { name: "PDF → text / Word", desc: "Out as .txt, .md, .docx or images", icon: <Type size={14} /> },
  { name: "Images → PDF", desc: "Photos and scans into one file", icon: <Images size={14} /> },
  { name: "Convert images", desc: "PNG / JPG / WebP, resize & shrink", icon: <ImageIcon size={14} /> },
  { name: "Video → audio", desc: "Keep the track, leave the video", icon: <AudioLines size={14} /> },
  { name: "Convert audio", desc: "MP3, M4A, WAV, OGG or FLAC", icon: <AudioLines size={14} /> },
  { name: "Convert video", desc: "MP4 / WebM / MOV, resize, trim", icon: <Film size={14} /> },
  { name: "Video → GIF", desc: "A looping clip for a README", icon: <Repeat size={14} /> },
];

/** The transcript the drawn modal is holding — real cue shape, real timings. */
const CUES = [
  { at: "00:00:01", line: "So the whole idea was to keep every file on the machine it" },
  { at: "00:00:07", line: "was made on. No upload step, no account, nothing to cancel." },
  { at: "00:00:14", line: "That is the part people keep writing in about." },
];

export function QuickTools() {
  return (
    <section id="quick-tools" className="cv dotted border-y border-line px-5 py-20 md:py-28" style={{ ["--cv" as string]: "2000px", ["--cv-lg" as string]: "1100px" }}>
      <div className="mx-auto max-w-6xl">
        <Reveal className="max-w-3xl">
          <p className="kicker">quick tools</p>
          <h2 className="display mt-3 text-4xl leading-[1.06] sm:text-5xl">
            twelve small jobs,
            <br className="hidden sm:block" /> none of them a website.
          </h2>
          <p className="mt-4 max-w-xl text-[15px] leading-7 text-muted">
            Convert and transcribe files on your device, with nothing uploaded.
          </p>
        </Reveal>

        <div className="mt-12 grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-10">
          {/* one of them, mid-job */}
          <Reveal className="min-w-0">
            <Scene ground="tide" className="h-full min-h-[420px] p-3 pb-16 sm:p-5 md:p-7 md:pb-16">
              <Pane className="relative mx-auto w-full max-w-[430px] min-w-0 overflow-hidden p-3 sm:p-4">
                <p className="text-[15px] font-semibold text-ink">YouTube → transcript</p>
                <p className="mt-1 text-[11.5px] leading-5 text-muted">
                  Captions from YouTube, or whisper on this device.
                </p>

                <div className="mt-3 flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate rounded-md border border-line px-2 py-1.5 font-mono text-[10.5px] text-muted">
                    youtube.com/watch?v=…
                  </span>
                  <span className="rounded-md border border-line px-2.5 py-1.5 text-[11px] font-semibold text-ink">
                    Look up
                  </span>
                </div>

                <div className="mt-2.5 flex items-center gap-2.5 rounded-md border border-line p-2">
                  <span className="h-9 w-14 shrink-0 rounded bg-gradient-to-br from-[#0a84ff] to-[#5e5ce6]" />
                  <span className="min-w-0">
                    <span className="block truncate text-[11.5px] font-semibold text-ink">
                      how owntools keeps your files yours
                    </span>
                    <span className="block truncate text-[10px] text-muted">
                      owntools · 3:33 · 6 caption tracks
                    </span>
                  </span>
                </div>

                <div className="mt-2.5 flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-muted">Captions</span>
                  <span className="rounded-md border border-line px-2 py-1 text-[11px] text-ink">
                    English ▾
                  </span>
                </div>

                <div className="mt-2.5 rounded-md border border-line p-2">
                  <p className="text-[11px] font-semibold text-ink">Or run whisper on the audio</p>
                  <p className="mt-0.5 text-[10px] leading-4 text-muted">
                    Transcribes the audio track (3.3 MB) on this device.
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="rounded border border-line px-1.5 py-1 text-[10px] text-muted">
                      Auto-detect ▾
                    </span>
                    <span className="flex items-center gap-1 text-[10px] text-muted">
                      <span className="h-2.5 w-2.5 rounded-[3px] border border-line" /> Translate
                    </span>
                    <span className="ml-auto rounded bg-accent px-2 py-1 text-[10px] font-semibold text-white">
                      Transcribe
                    </span>
                  </div>
                </div>

                <div className="mt-2.5 space-y-1 rounded-md border border-line p-2 font-mono text-[10px] leading-[15px] text-ink">
                  {CUES.map((c) => (
                    <p key={c.at} className="truncate">
                      <span className="text-muted">[{c.at}]</span> {c.line}
                    </p>
                  ))}
                </div>

                <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold">
                  <span className="rounded-md border border-line px-2.5 py-1 text-muted">Close</span>
                  <span className="ml-auto rounded-md border border-line px-2.5 py-1 text-ink">Copy</span>
                  <span className="rounded-md border border-line px-2.5 py-1 text-ink">Save .txt</span>
                  <span className="rounded-md border border-line px-2.5 py-1 text-ink">Save .srt</span>
                </div>
              </Pane>

              <span className="layer absolute bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap !rounded-full bg-[#0b0b0d]/90 px-3 py-1.5 text-[11px] font-semibold text-white">
                no account · no upload
              </span>
            </Scene>
          </Reveal>

          {/* and the other eleven */}
          <Reveal delay={0.08} className="min-w-0">
            <ul className="grid gap-2.5 sm:grid-cols-2">
              {QUICK.map((t) => (
                <li
                  key={t.name}
                  className="flex items-start gap-2.5 rounded-[12px] border border-line bg-card p-3"
                >
                  <span className="glow-icon !h-7 !w-7 shrink-0 !rounded-lg">{t.icon}</span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-semibold text-ink">{t.name}</span>
                    <span className="block text-[12px] leading-5 text-muted">{t.desc}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
