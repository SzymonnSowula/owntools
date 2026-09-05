import { describe, expect, it } from "vitest";
import {
  decodeEntities,
  formatDuration,
  parseTimedText,
  parseYouTubeId,
  pickAudioFormat,
  pickCaptionTrack,
  readPlayerResponse,
  type CaptionTrack,
} from "./youtube";

describe("parseYouTubeId", () => {
  it("reads every link shape people paste", () => {
    const id = "dQw4w9WgXcQ";
    for (const input of [
      `https://www.youtube.com/watch?v=${id}`,
      `https://www.youtube.com/watch?v=${id}&t=42s&list=PL123`,
      `https://www.youtube.com/watch?feature=share&v=${id}`,
      `youtube.com/watch?v=${id}`,
      `https://m.youtube.com/watch?v=${id}`,
      `https://music.youtube.com/watch?v=${id}`,
      `https://youtu.be/${id}`,
      `https://youtu.be/${id}?si=abc`,
      `https://www.youtube.com/shorts/${id}`,
      `https://www.youtube.com/embed/${id}?autoplay=1`,
      `https://www.youtube.com/live/${id}`,
      `https://www.youtube-nocookie.com/embed/${id}`,
      `  ${id}  `,
    ]) {
      expect(parseYouTubeId(input), input).toBe(id);
    }
  });

  it("refuses other sites and junk", () => {
    expect(parseYouTubeId("")).toBeNull();
    expect(parseYouTubeId("https://vimeo.com/123456")).toBeNull();
    expect(parseYouTubeId("https://www.youtube.com/")).toBeNull();
    expect(parseYouTubeId("https://www.youtube.com/watch?v=short")).toBeNull();
    expect(parseYouTubeId("not a link at all")).toBeNull();
  });
});

describe("decodeEntities", () => {
  it("handles named, numeric and double-encoded entities", () => {
    expect(decodeEntities("We&#39;re &amp; &quot;here&quot; &lt;3")).toBe(`We're & "here" <3`);
    expect(decodeEntities("I&amp;#39;m")).toBe("I'm");
    expect(decodeEntities("caf&#xe9;")).toBe("café");
    expect(decodeEntities("&unknown; stays")).toBe("&unknown; stays");
  });
});

describe("parseTimedText", () => {
  it("parses srv3 with word spans and skips append placeholders", () => {
    const xml = `<?xml version="1.0" encoding="utf-8" ?><timedtext format="3">
<head><ws id="0"/><wp id="0"/></head>
<body>
<w t="0" id="1" wp="1" ws="1"/>
<p t="320" d="14260" w="1">[Music]</p>
<p t="18790" w="1" a="1">
</p>
<p t="18800" d="7160" w="1"><s ac="0">We&#39;re</s><s t="239" ac="0"> no</s><s t="559" ac="0"> strangers</s></p>
<p t="21800" d="7319" w="1"><s ac="0">love.</s><s t="1000" ac="0"> You</s></p>
</body></timedtext>`;
    const cues = parseTimedText(xml);
    expect(cues.map((c) => c.text)).toEqual(["[Music]", "We're no strangers", "love. You"]);
    expect(cues[0]).toEqual({ start: 0.32, end: 14.58, text: "[Music]" });
    // The second cue would run to 25.96 s; it is clamped to the next cue's start.
    expect(cues[1].start).toBeCloseTo(18.8, 3);
    expect(cues[1].end).toBeCloseTo(21.8, 3);
    expect(cues[2].end).toBeCloseTo(29.119, 3);
  });

  it("parses srv1 with double-encoded entities", () => {
    const xml = `<?xml version="1.0" encoding="utf-8" ?><transcript><text start="0.32" dur="14.26">[Music]</text><text start="18.8" dur="7.16">We&amp;#39;re no strangers to</text><text start="21.8">love.</text></transcript>`;
    const cues = parseTimedText(xml);
    expect(cues).toHaveLength(3);
    expect(cues[1].text).toBe("We're no strangers to");
    expect(cues[1].end).toBeCloseTo(21.8, 3);
    // No duration on the last cue: it gets the 2 s default.
    expect(cues[2].end).toBeCloseTo(23.8, 3);
  });

  it("parses json3 and ignores aAppend events", () => {
    const json = JSON.stringify({
      wireMagic: "pb3",
      events: [
        { tStartMs: 0, dDurationMs: 211879, id: 1 },
        { tStartMs: 320, dDurationMs: 14260, segs: [{ utf8: "[Music]" }] },
        { tStartMs: 18790, aAppend: 1, segs: [{ utf8: "\n" }] },
        { tStartMs: 18800, dDurationMs: 7160, segs: [{ utf8: "We're" }, { utf8: " no" }, { utf8: " strangers" }] },
      ],
    });
    const cues = parseTimedText(json);
    expect(cues.map((c) => c.text)).toEqual(["[Music]", "We're no strangers"]);
    expect(cues[1].start).toBeCloseTo(18.8, 3);
  });

  it("returns nothing for empty or unknown bodies", () => {
    expect(parseTimedText("")).toEqual([]);
    expect(parseTimedText("<html>Sorry...</html>")).toEqual([]);
  });
});

describe("readPlayerResponse", () => {
  const sample = {
    playabilityStatus: { status: "OK" },
    videoDetails: {
      title: "Me at the zoo",
      author: "jawed",
      lengthSeconds: "19",
      thumbnail: {
        thumbnails: [
          { url: "https://i.ytimg.com/vi/x/default.jpg", width: 120 },
          { url: "https://i.ytimg.com/vi/x/hqdefault.jpg", width: 480 },
        ],
      },
    },
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks: [
          { baseUrl: "https://www.youtube.com/api/timedtext?v=x&lang=en", languageCode: "en", name: { runs: [{ text: "English" }] } },
          { baseUrl: "https://www.youtube.com/api/timedtext?v=x&lang=en&kind=asr", languageCode: "en", kind: "asr", name: { simpleText: "English (auto-generated)" } },
          { languageCode: "de" },
        ],
      },
    },
    streamingData: {
      adaptiveFormats: [
        { itag: 251, url: "https://r1.googlevideo.com/opus", mimeType: 'audio/webm; codecs="opus"', bitrate: 137000, contentLength: "300000" },
        { itag: 137, url: "https://r1.googlevideo.com/video", mimeType: 'video/mp4; codecs="avc1"', bitrate: 4000000 },
        { itag: 140, url: "https://r1.googlevideo.com/aac", mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 131000, contentLength: "309288" },
      ],
    },
  };

  it("extracts details, tracks and the m4a stream", () => {
    const video = readPlayerResponse(sample, "jNQXAC9IVRw");
    expect(video.title).toBe("Me at the zoo");
    expect(video.lengthSeconds).toBe(19);
    expect(video.thumbnailUrl).toBe("https://i.ytimg.com/vi/x/hqdefault.jpg");
    expect(video.tracks).toEqual([
      { url: "https://www.youtube.com/api/timedtext?v=x&lang=en", languageCode: "en", name: "English", auto: false },
      { url: "https://www.youtube.com/api/timedtext?v=x&lang=en&kind=asr", languageCode: "en", name: "English (auto-generated)", auto: true },
    ]);
    expect(video.audio).toEqual({
      url: "https://r1.googlevideo.com/aac",
      mimeType: 'audio/mp4; codecs="mp4a.40.2"',
      bitrate: 131000,
      contentLength: 309288,
      ext: "m4a",
    });
    expect(video.unplayable).toBeNull();
  });

  it("reports why a video cannot be played", () => {
    const video = readPlayerResponse(
      { playabilityStatus: { status: "LOGIN_REQUIRED", reason: "Sign in to confirm your age" } },
      "abc",
    );
    expect(video.unplayable).toBe("Sign in to confirm your age");
    expect(readPlayerResponse(null, "abc").unplayable).toContain("UNKNOWN");
  });

  it("falls back to webm audio when there is no m4a", () => {
    const audio = pickAudioFormat([
      { itag: 251, url: "u", mimeType: 'audio/webm; codecs="opus"', bitrate: 137000 },
      { itag: 249, url: "v", mimeType: 'audio/webm; codecs="opus"', bitrate: 49000 },
    ]);
    expect(audio?.ext).toBe("webm");
    expect(audio?.url).toBe("u");
    expect(audio?.contentLength).toBeNull();
    expect(pickAudioFormat([{ itag: 140, mimeType: "audio/mp4" }])).toBeNull();
  });
});

describe("pickCaptionTrack", () => {
  const track = (languageCode: string, auto = false): CaptionTrack => ({
    url: languageCode,
    languageCode,
    name: languageCode,
    auto,
  });

  it("prefers uploaded tracks in the viewer's language, then English, then auto", () => {
    const tracks = [track("en", true), track("de-DE"), track("en"), track("pl", true)];
    expect(pickCaptionTrack(tracks, ["pl-PL", "en-US"])?.url).toBe("en");
    expect(pickCaptionTrack(tracks, ["de"])?.url).toBe("de-DE");
    expect(pickCaptionTrack([track("en", true), track("pl", true)], ["pl"])?.url).toBe("pl");
    expect(pickCaptionTrack([track("ja", true)], ["pl"])?.url).toBe("ja");
    expect(pickCaptionTrack([], ["pl"])).toBeNull();
  });
});

describe("formatDuration", () => {
  it("prints m:ss and h:mm:ss", () => {
    expect(formatDuration(19)).toBe("0:19");
    expect(formatDuration(213)).toBe("3:33");
    expect(formatDuration(3725)).toBe("1:02:05");
  });
});
