import type { TimedText } from "@feature-editor/lib/transcriptFormat";
import { netFetch } from "./net";

/**
 * YouTube captions without an API key.
 *
 * The InnerTube `player` endpoint, asked as the Android app, lists a video's
 * caption tracks with fetchable `baseUrl`s and the audio-only streams. The
 * watch page's own `ytInitialPlayerResponse` carries the same list, but its
 * caption URLs have answered with an empty body since 2025 (they want a
 * proof-of-origin token), and YouTube's server-side translation (`tlang=`)
 * answers 429 for everyone — so translating is whisper's job
 * (`youtubeWhisper.ts`). Probed on 2026-09-05 from a residential connection;
 * no API key is needed on the endpoint any more.
 */

const PLAYER_URL = "https://www.youtube.com/youtubei/v1/player?prettyPrint=false";
const CLIENT = { clientName: "ANDROID", clientVersion: "20.10.38", hl: "en" };
const ANDROID_UA = "com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip";
const ID_RE = /^[A-Za-z0-9_-]{11}$/;

export interface CaptionTrack {
  url: string;
  languageCode: string;
  /** Human name as YouTube labels it ("English (auto-generated)"). */
  name: string;
  /** Speech-recognition track, not uploaded by the author. */
  auto: boolean;
}

export interface AudioFormat {
  url: string;
  mimeType: string;
  bitrate: number;
  contentLength: number | null;
  ext: "m4a" | "webm";
}

export interface YouTubeVideo {
  id: string;
  title: string;
  author: string;
  lengthSeconds: number;
  thumbnailUrl: string | null;
  tracks: CaptionTrack[];
  /** Best audio-only stream, for the whisper route. */
  audio: AudioFormat | null;
  /** Why YouTube refuses to play it (age gate, private, removed), or null. */
  unplayable: string | null;
}

/** Accepts watch / short / embed / live / youtu.be links, with or without a scheme, and bare ids. */
export function parseYouTubeId(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  if (ID_RE.test(s)) return s;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^(www|m|music|gaming)\./, "");
  if (host === "youtu.be") {
    const id = url.pathname.split("/")[1] ?? "";
    return ID_RE.test(id) ? id : null;
  }
  if (host !== "youtube.com" && host !== "youtube-nocookie.com") return null;
  const v = url.searchParams.get("v");
  if (v && ID_RE.test(v)) return v;
  const m = url.pathname.match(/^\/(?:embed|shorts|live|v|e)\/([A-Za-z0-9_-]{11})(?:[/?]|$)/);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// Player response
// ---------------------------------------------------------------------------

interface RawRun {
  text?: string;
}
interface RawTrack {
  baseUrl?: string;
  languageCode?: string;
  kind?: string;
  name?: { runs?: RawRun[]; simpleText?: string };
}
export interface RawFormat {
  itag?: number;
  url?: string;
  mimeType?: string;
  bitrate?: number;
  contentLength?: string;
}
interface RawPlayer {
  playabilityStatus?: { status?: string; reason?: string };
  videoDetails?: {
    title?: string;
    author?: string;
    lengthSeconds?: string;
    thumbnail?: { thumbnails?: { url?: string; width?: number }[] };
  };
  captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: RawTrack[] } };
  streamingData?: { adaptiveFormats?: RawFormat[] };
}

/** m4a (itag 140, ~128 kbit AAC) first: smallest download whisper decodes without fuss. */
export function pickAudioFormat(formats: RawFormat[]): AudioFormat | null {
  const score = (f: RawFormat): number => {
    if (f.itag === 140) return 3;
    if (f.mimeType?.startsWith("audio/mp4")) return 2;
    if (f.mimeType?.startsWith("audio/webm")) return 1;
    return 0;
  };
  const audio = formats
    .filter((f) => f.url && f.mimeType?.startsWith("audio/"))
    .sort((a, b) => score(b) - score(a) || (b.bitrate ?? 0) - (a.bitrate ?? 0));
  for (const f of audio) {
    const ext = f.mimeType?.startsWith("audio/mp4") ? "m4a" : f.mimeType?.startsWith("audio/webm") ? "webm" : null;
    if (!ext || !f.url) continue;
    const length = Number(f.contentLength);
    return {
      url: f.url,
      mimeType: f.mimeType ?? "",
      bitrate: f.bitrate ?? 0,
      contentLength: Number.isFinite(length) && length > 0 ? length : null,
      ext,
    };
  }
  return null;
}

/** Pure half of `lookupVideo`, so a captured response can be tested. */
export function readPlayerResponse(raw: unknown, id: string): YouTubeVideo {
  const r = (raw && typeof raw === "object" ? raw : {}) as RawPlayer;
  const status = r.playabilityStatus?.status ?? "UNKNOWN";
  const unplayable = status === "OK" ? null : r.playabilityStatus?.reason || `YouTube answered "${status}".`;
  const details = r.videoDetails ?? {};
  const thumbs = (details.thumbnail?.thumbnails ?? []).filter((t) => t.url);
  thumbs.sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  const tracks: CaptionTrack[] = [];
  for (const t of r.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? []) {
    if (!t.baseUrl || !t.languageCode) continue;
    const runs = t.name?.runs?.map((x) => x.text ?? "").join("");
    tracks.push({
      url: t.baseUrl,
      languageCode: t.languageCode,
      name: runs || t.name?.simpleText || t.languageCode,
      auto: t.kind === "asr",
    });
  }
  return {
    id,
    title: details.title ?? "",
    author: details.author ?? "",
    lengthSeconds: Number(details.lengthSeconds) || 0,
    thumbnailUrl: thumbs[0]?.url ?? null,
    tracks,
    audio: pickAudioFormat(r.streamingData?.adaptiveFormats ?? []),
    unplayable,
  };
}

export async function lookupVideo(id: string): Promise<YouTubeVideo> {
  const res = await netFetch(PLAYER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": ANDROID_UA },
    body: JSON.stringify({ context: { client: CLIENT }, videoId: id }),
  });
  if (!res.ok) throw new Error(`YouTube answered ${res.status}.`);
  const json: unknown = await res.json();
  const video = readPlayerResponse(json, id);
  if (video.unplayable) throw new Error(video.unplayable);
  if (!video.title && !video.tracks.length && !video.audio) {
    throw new Error("YouTube sent nothing usable for this id. Is the link right?");
  }
  return video;
}

/**
 * The track to preselect: something a person uploaded in one of the viewer's
 * languages, then uploaded English, then any uploaded track, then the
 * auto-generated one in a viewer language, then whatever comes first.
 */
export function pickCaptionTrack(tracks: CaptionTrack[], preferred: readonly string[]): CaptionTrack | null {
  if (!tracks.length) return null;
  const bases = preferred.map((l) => l.toLowerCase().split("-")[0]);
  const base = (t: CaptionTrack) => t.languageCode.toLowerCase().split("-")[0];
  const manual = tracks.filter((t) => !t.auto);
  for (const lang of bases) {
    const hit = manual.find((t) => base(t) === lang);
    if (hit) return hit;
  }
  return (
    manual.find((t) => base(t) === "en") ??
    manual[0] ??
    tracks.find((t) => bases.includes(base(t))) ??
    tracks[0]
  );
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Caption formats
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** Decodes HTML entities; runs twice because srv1 double-encodes (`&amp;#39;`). */
export function decodeEntities(input: string): string {
  let s = input;
  for (let pass = 0; pass < 2 && s.includes("&"); pass++) {
    s = s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
      if (body[0] === "#") {
        const code = body[1]?.toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
        return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : whole;
      }
      return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
    });
  }
  return s;
}

function cleanText(markup: string): string {
  return decodeEntities(markup.replace(/<[^>]*>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

function attr(attrs: string, name: string): string | null {
  const m = attrs.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`));
  return m ? m[1] : null;
}

/** `<timedtext format="3">` — `<p t d>` in ms, words in `<s>`, `a="1"` placeholders. */
function parseSrv3(xml: string): TimedText[] {
  const out: TimedText[] = [];
  const re = /<p\b([^>]*)>([\s\S]*?)<\/p>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const attrs = m[1];
    if (attr(attrs, "a") === "1") continue;
    const text = cleanText(m[2]);
    if (!text) continue;
    const t = Number(attr(attrs, "t"));
    const d = Number(attr(attrs, "d"));
    if (!Number.isFinite(t)) continue;
    out.push({ start: t / 1000, end: Number.isFinite(d) && d > 0 ? (t + d) / 1000 : Number.NaN, text });
  }
  return out;
}

/** `<transcript><text start dur>` in seconds — the format with no `fmt=`. */
function parseSrv1(xml: string): TimedText[] {
  const out: TimedText[] = [];
  const re = /<text\b([^>]*)>([\s\S]*?)<\/text>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const text = cleanText(m[2]);
    if (!text) continue;
    const start = Number(attr(m[1], "start"));
    const dur = Number(attr(m[1], "dur"));
    if (!Number.isFinite(start)) continue;
    out.push({ start, end: Number.isFinite(dur) && dur > 0 ? start + dur : Number.NaN, text });
  }
  return out;
}

interface Json3Event {
  tStartMs?: number;
  dDurationMs?: number;
  aAppend?: number;
  segs?: { utf8?: string }[];
}

/** `fmt=json3` — `events[].segs[].utf8`, `aAppend` placeholders. */
function parseJson3(raw: string): TimedText[] {
  let events: Json3Event[];
  try {
    events = (JSON.parse(raw) as { events?: Json3Event[] }).events ?? [];
  } catch {
    return [];
  }
  const out: TimedText[] = [];
  for (const ev of events) {
    if (ev.aAppend || !ev.segs || typeof ev.tStartMs !== "number") continue;
    const text = ev.segs
      .map((s) => s.utf8 ?? "")
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;
    const start = ev.tStartMs / 1000;
    out.push({
      start,
      end: typeof ev.dDurationMs === "number" && ev.dDurationMs > 0 ? start + ev.dDurationMs / 1000 : Number.NaN,
      text,
    });
  }
  return out;
}

/**
 * Cues in time order with sane ends: a missing duration runs to the next cue
 * (or 2 s), and auto captions often stay on screen past the next line's
 * start, which is fine for YouTube's rolling display but overlaps in an .srt.
 */
function normalizeCues(items: TimedText[]): TimedText[] {
  const sorted = [...items].sort((a, b) => a.start - b.start);
  return sorted.map((item, i) => {
    const next = sorted[i + 1];
    let end = Number.isFinite(item.end) ? item.end : next ? next.start : item.start + 2;
    if (next && end > next.start) end = next.start;
    if (end <= item.start) end = item.start + 0.5;
    return { start: item.start, end, text: item.text };
  });
}

/** Parses whichever caption format YouTube sent (srv3 XML, srv1 XML or json3). */
export function parseTimedText(raw: string): TimedText[] {
  const s = raw.trim();
  if (!s) return [];
  let items: TimedText[];
  if (s.startsWith("{")) items = parseJson3(s);
  else if (/<timedtext\b/i.test(s)) items = parseSrv3(s);
  else if (/<transcript\b|<text\b/i.test(s)) items = parseSrv1(s);
  else return [];
  return normalizeCues(items);
}

export async function fetchCaptions(track: CaptionTrack): Promise<TimedText[]> {
  const res = await netFetch(track.url);
  if (!res.ok) throw new Error(`YouTube answered ${res.status} for the captions.`);
  const items = parseTimedText(await res.text());
  if (!items.length) {
    throw new Error("YouTube sent an empty caption track. Try another language, or whisper.");
  }
  return items;
}
