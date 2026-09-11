import type { CaptureErrorEvent, CaptureStart, CaptureStop, LevelEvent, MeetBackend, SegmentEvent } from "./backend";
import type { AudioDevices, EngineInfo, Meeting, MeetLang, Speaker } from "../types";

/**
 * The browser stand-in for the Rust capture + the speech engine: a scripted
 * two-sided call replayed in real time (levels at 10 Hz, a segment event at
 * the end of every line, canned text a moment later), and two sample
 * meetings in memory with generated audio. Same contract as `tauri.ts`, so
 * the Live and Meetings pages are exercised end to end under `pnpm dev`.
 */

type Listener<T> = (payload: T) => void;

class Emitter<T> {
  private set = new Set<Listener<T>>();
  on(cb: Listener<T>): () => void {
    this.set.add(cb);
    return () => this.set.delete(cb);
  }
  emit(payload: T): void {
    for (const cb of Array.from(this.set)) cb(payload);
  }
}

interface ScriptLine {
  side: Speaker;
  /** Seconds into the call when the line starts and how long it lasts. */
  at: number;
  dur: number;
  text: string;
}

/** A launch-planning call, ~70 s. Loops with an offset if the demo runs longer. */
const SCRIPT: ScriptLine[] = [
  { side: "system", at: 1.0, dur: 3.2, text: "Hey, can you hear me alright? I have the pricing page open." },
  { side: "mic", at: 4.8, dur: 2.6, text: "Loud and clear. Let's start with the launch date." },
  { side: "system", at: 8.0, dur: 5.4, text: "So the plan was Tuesday, but the Mac build still has no whisper binary. Do we ship Windows first?" },
  { side: "mic", at: 14.0, dur: 4.8, text: "Yes. Windows on Tuesday, Mac when the signing certificate is in. I will write that in the changelog." },
  { side: "system", at: 19.6, dur: 3.9, text: "Okay. And the price - the site still says forty-nine dollars." },
  { side: "mic", at: 24.0, dur: 5.2, text: "Let's decide now. One hundred forty-nine złoty lifetime, one constant in site.ts. You update the plan, I update the site." },
  { side: "system", at: 29.8, dur: 2.8, text: "Agreed. I'll send you the Polar checkout link by Friday." },
  { side: "mic", at: 33.2, dur: 4.4, text: "Perfect. One more thing: the onboarding should say eight tools now, not seven." },
  { side: "system", at: 38.2, dur: 3.6, text: "Right, meet is the eighth. I'll grep for 'seven tools' before the release." },
  { side: "mic", at: 42.4, dur: 3.0, text: "And record a two-minute demo of a call for the landing." },
  { side: "system", at: 46.0, dur: 4.2, text: "Can do. Should the demo show the summary panel or the live transcript?" },
  { side: "mic", at: 50.8, dur: 3.8, text: "Live transcript first, then the to-dos landing in focus. That's the whole story." },
  { side: "system", at: 55.4, dur: 2.4, text: "Got it. Anything else?" },
  { side: "mic", at: 58.4, dur: 3.2, text: "No, that's it. Thanks, talk on Friday." },
  { side: "system", at: 62.0, dur: 1.6, text: "Bye!" },
];

const SCRIPT_LENGTH = 66;

function seededNoise(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

interface LiveDemo {
  opts: CaptureStart;
  startedAt: number;
  pausedTotal: number;
  pauseStarted: number | null;
  timer: ReturnType<typeof setInterval>;
  emitted: Set<string>;
  segments: number;
  rand: () => number;
}

const DEMO_ROOT = "C:\\Users\\demo\\AppData\\Roaming\\app.owntools.desktop\\meet";

function sampleMeetings(): Meeting[] {
  const today = new Date();
  const at = (daysAgo: number, h: number, m: number) => {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysAgo, h, m);
    return d.toISOString();
  };
  const a: Meeting = {
    id: "demo-standup",
    title: "Standup · pricing + Mac",
    startedAt: at(0, 9, 30),
    durationMs: 3 * 60_000 + 12_000,
    sources: ["mic", "system"],
    segments: [
      { source: "system", startMs: 2_000, endMs: 5_400, text: "Morning. Two things: the price and the Mac build." },
      { source: "mic", startMs: 6_000, endMs: 11_200, text: "Price first. The site says 49 dollars, the business plan says 149 złoty. One constant, site.ts." },
      { source: "system", startMs: 12_000, endMs: 16_800, text: "149 złoty lifetime then. I will update the plan and the FAQ." },
      { source: "mic", startMs: 18_000, endMs: 24_600, text: "Mac: whisper.cpp publishes no macOS CLI, so the workflow builds it. Until it runs, Macs get Parakeet only." },
      { source: "system", startMs: 25_400, endMs: 29_000, text: "And the Apple certificate is 99 a year. Do we pay it now?" },
      { source: "mic", startMs: 30_000, endMs: 34_800, text: "Yes, this week. Unsigned builds read as malware, that is not shippable." },
      { source: "system", startMs: 36_000, endMs: 39_200, text: "Okay. I'll buy the membership today and start notarization." },
      { source: "mic", startMs: 40_000, endMs: 43_000, text: "Great. That's all from me." },
    ],
    notes: "- price: 149 zł, one constant\n- Apple membership this week\n- ask about Polar webhook timing",
    summary:
      "The team settled the two decisions blocking the launch: the price becomes 149 zł lifetime, held in one constant on the landing, and the Apple Developer membership is bought this week so the macOS build can be signed and notarized. Until whisper.cpp builds for macOS, Macs ship with Parakeet only.",
    decisions: ["Price is 149 zł lifetime, one constant in site.ts", "Buy the Apple Developer membership this week"],
    actionItems: [
      { text: "Update the business plan and FAQ to 149 zł", owner: "them" },
      { text: "Buy the Apple membership and start notarization", owner: "them" },
      { text: "Change the price constant on the landing", owner: "you" },
    ],
    audio: true,
  };
  const b: Meeting = {
    id: "demo-lecture",
    title: "Lecture · signal processing, week 3",
    startedAt: at(1, 14, 5),
    durationMs: 2 * 60_000 + 40_000,
    sources: ["system"],
    segments: [
      { source: "system", startMs: 1_000, endMs: 9_800, text: "Today we look at why you low-pass before you decimate. If you simply take every third sample of a 48 kilohertz signal, anything above 8 kilohertz folds back into the band." },
      { source: "system", startMs: 11_000, endMs: 19_400, text: "That folding is aliasing. An 11 kilohertz tone comes out at 5 kilohertz and there is no way to tell it apart from a real 5 kilohertz tone afterwards." },
      { source: "system", startMs: 21_000, endMs: 30_200, text: "So the filter comes first. A windowed sinc with the cutoff a little under the new Nyquist frequency, 7.2 kilohertz for a 16 kilohertz target, is the standard answer." },
      { source: "system", startMs: 32_000, endMs: 39_600, text: "For the assignment, implement the filter as a streaming operation: the state between chunks is the last N minus one input samples." },
    ],
    notes: "assignment: streaming FIR, keep N-1 history\nexam question likely: why 0.45 not 0.5",
    audio: true,
  };
  return [a, b];
}

/** A small mono 8 kHz WAV with a soft beep at every segment, so clicking a line lands on something audible. */
function fakeAudio(meeting: Meeting): string {
  const rate = 8000;
  const seconds = Math.min(Math.ceil(meeting.durationMs / 1000), 15 * 60);
  const n = seconds * rate;
  const pcm = new Int16Array(n);
  for (const seg of meeting.segments) {
    const from = Math.floor((seg.startMs / 1000) * rate);
    const to = Math.min(n, Math.floor((seg.endMs / 1000) * rate));
    const hz = seg.source === "mic" ? 330 : 440;
    for (let i = from; i < to; i += 1) {
      const t = (i - from) / rate;
      const env = Math.min(1, t * 8) * Math.min(1, (to - i) / rate * 8);
      pcm[i] = Math.round(0.18 * env * 32767 * Math.sin(2 * Math.PI * hz * t));
    }
  }
  const bytes = new Uint8Array(44 + n * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (at: number, s: string) => {
    for (let i = 0; i < s.length; i += 1) bytes[at + i] = s.charCodeAt(i);
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + n * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, n * 2, true);
  bytes.set(new Uint8Array(pcm.buffer), 44);
  return URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
}

export function createDemoBackend(): MeetBackend {
  const segmentEv = new Emitter<SegmentEvent>();
  const levelEv = new Emitter<LevelEvent>();
  const errorEv = new Emitter<CaptureErrorEvent>();
  const meetings = new Map<string, Meeting>(sampleMeetings().map((m) => [m.id, m]));
  const audioUrls = new Map<string, string>();
  const canned = new Map<string, string>();
  const live = new Map<string, LiveDemo>();

  const recordingMs = (d: LiveDemo) => {
    let ms = Date.now() - d.startedAt - d.pausedTotal;
    if (d.pauseStarted !== null) ms -= Date.now() - d.pauseStarted;
    return Math.max(0, ms);
  };

  const tick = (session: string) => {
    const d = live.get(session);
    if (!d) return;
    if (d.pauseStarted !== null) {
      levelEv.emit({ session, mic: 0, system: 0 });
      return;
    }
    const ms = recordingMs(d);
    const loop = Math.floor(ms / 1000 / SCRIPT_LENGTH);
    const t = ms / 1000 - loop * SCRIPT_LENGTH;
    let mic = 0.02 + d.rand() * 0.03;
    let system = 0.02 + d.rand() * 0.03;
    for (const line of SCRIPT) {
      const active = t >= line.at && t < line.at + line.dur;
      if (active) {
        // A voice: mostly mid-level with syllable-shaped bumps.
        const v = 0.28 + d.rand() * 0.45 * (0.5 + 0.5 * Math.sin(t * 9 + line.at));
        if (line.side === "mic") mic = Math.max(mic, v);
        else system = Math.max(system, v);
      }
      // The segment closes when the hangover would: 0.6 s after the line ends.
      const closeAt = line.at + line.dur + 0.6;
      const key = `${loop}:${line.at}`;
      if (t >= closeAt && !d.emitted.has(key)) {
        d.emitted.add(key);
        const base = loop * SCRIPT_LENGTH * 1000;
        const startMs = Math.round(base + (line.at - 0.2) * 1000);
        const endMs = Math.round(base + (line.at + line.dur + 0.2) * 1000);
        const path = `demo://${session}/${line.side}-${startMs}.wav`;
        canned.set(path, line.text);
        d.segments += 1;
        segmentEv.emit({ session, source: line.side, startMs, endMs, path });
      }
    }
    if (!d.opts.sources.includes("mic")) mic = 0;
    if (!d.opts.sources.includes("system")) system = 0;
    levelEv.emit({ session, mic, system });
  };

  return {
    async devices(): Promise<AudioDevices> {
      return {
        inputs: [
          { id: "demo-mic-1", name: "Microphone (Yeti Stereo Microphone)", default: true },
          { id: "demo-mic-2", name: "Headset Microphone (Jabra Evolve2)", default: false },
          { id: "demo-mic-3", name: "Microphone Array (Realtek Audio)", default: false },
        ],
        outputs: [{ id: "demo-out-1", name: "Speakers (Realtek Audio)", default: true }],
      };
    },

    async start(opts: CaptureStart) {
      if (live.has(opts.session)) throw new Error(`session '${opts.session}' is already recording`);
      if (!opts.sources.length) throw new Error("pick at least one source: mic or system");
      await new Promise((r) => setTimeout(r, 350));
      const d: LiveDemo = {
        opts,
        startedAt: Date.now(),
        pausedTotal: 0,
        pauseStarted: null,
        timer: setInterval(() => tick(opts.session), 100),
        emitted: new Set(),
        segments: 0,
        rand: seededNoise(Date.now()),
      };
      live.set(opts.session, d);
    },

    async pause(session) {
      const d = live.get(session);
      if (!d) throw new Error(`no recording session '${session}'`);
      if (d.pauseStarted === null) d.pauseStarted = Date.now();
    },

    async resume(session) {
      const d = live.get(session);
      if (!d) throw new Error(`no recording session '${session}'`);
      if (d.pauseStarted !== null) {
        d.pausedTotal += Date.now() - d.pauseStarted;
        d.pauseStarted = null;
      }
    },

    async stop(session): Promise<CaptureStop> {
      const d = live.get(session);
      if (!d) throw new Error(`no recording session '${session}'`);
      clearInterval(d.timer);
      if (d.pauseStarted !== null) {
        d.pausedTotal += Date.now() - d.pauseStarted;
        d.pauseStarted = null;
      }
      const durationMs = recordingMs(d);
      // The Rust side flushes an open stretch of speech on stop; so does this.
      const t = (durationMs / 1000) % SCRIPT_LENGTH;
      const loop = Math.floor(durationMs / 1000 / SCRIPT_LENGTH);
      const open = SCRIPT.find((l) => t >= l.at + 0.4 && t < l.at + l.dur + 0.6 && !d.emitted.has(`${loop}:${l.at}`));
      if (open) {
        const base = loop * SCRIPT_LENGTH * 1000;
        const startMs = Math.round(base + (open.at - 0.2) * 1000);
        const path = `demo://${session}/${open.side}-${startMs}.wav`;
        canned.set(path, open.text);
        d.segments += 1;
        setTimeout(() => segmentEv.emit({ session, source: open.side, startMs, endMs: durationMs, path }), 60);
      }
      live.delete(session);
      return { wavPath: `${DEMO_ROOT}\\${opts_id(d.opts)}\\audio.wav`, durationMs, segments: d.segments };
    },

    onSegment: (cb) => segmentEv.on(cb),
    onLevel: (cb) => levelEv.on(cb),
    onError: (cb) => errorEv.on(cb),

    async transcribe(path: string, _lang: MeetLang) {
      // Parakeet on this laptop: ~0.7 s for a few seconds of speech.
      await new Promise((r) => setTimeout(r, 600 + Math.random() * 500));
      return canned.get(path) ?? "";
    },

    async engine(): Promise<EngineInfo> {
      return { ready: true, parakeet: true, whisper: true };
    },

    meetingDir: (id) => `meet/${id}`,
    async absoluteDir(id) {
      return `${DEMO_ROOT}\\${id}`;
    },

    async listMeetings() {
      return Array.from(meetings.values()).sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
    },

    async readMeeting(id) {
      return meetings.get(id) ?? null;
    },

    async writeMeeting(meeting) {
      meetings.set(meeting.id, { ...meeting });
    },

    async deleteMeeting(id) {
      meetings.delete(id);
      const url = audioUrls.get(id);
      if (url) URL.revokeObjectURL(url);
      audioUrls.delete(id);
    },

    async removeAudio(id) {
      const m = meetings.get(id);
      if (m) meetings.set(id, { ...m, audio: false });
    },

    async audioUrl(id) {
      const m = meetings.get(id);
      if (!m || m.audio === false) return null;
      let url = audioUrls.get(id);
      if (!url) {
        url = fakeAudio(m);
        audioUrls.set(id, url);
      }
      return url;
    },

    async reveal() {
      /* nothing to reveal in a browser */
    },
  };
}

function opts_id(opts: CaptureStart): string {
  return opts.dir.replace(/^meet\//, "");
}
