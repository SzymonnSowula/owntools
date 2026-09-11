/**
 * The real action implementations. Each one reads the context, talks to the
 * tool that owns the capability (dictation for transcription, `@core/llm` for
 * summaries, social's `createDraft`, the focus store for tasks, the Rust
 * launcher for `open`) and returns what it adds to the context. Heavy
 * modules are imported when first needed so the engine's start-up stays
 * light. Anything that cannot work *right now* but is not a fault — no
 * model, no text, a file that is not audio — ends as a note or a `SkipRun`,
 * never an error the person has to read as "broken".
 */

import { isTauri } from "@core/env";
import type { AutomationsBackend } from "./backend";
import {
  extOf,
  fillTemplate,
  isUnder,
  openKindFor,
  pickSource,
  safeFileName,
  taskTitles,
  type Ctx,
  type SummaryStyle,
} from "./rules";
import { SkipRun, type ActionImpls } from "./run";

/** What the decoder in `@core/audio` can be expected to open. */
const MEDIA_EXT = new Set(["mp3", "m4a", "aac", "wav", "ogg", "oga", "opus", "flac", "webm", "mp4", "m4v", "mov", "mkv", "weba"]);
/** Files social accepts as an attachment. */
const POST_MEDIA_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "mp4", "mov", "webm"]);

const MIME: Record<string, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  wav: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  flac: "audio/flac",
  weba: "audio/webm",
  webm: "video/webm",
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
};

const SUMMARY_SYSTEM: Record<SummaryStyle, string> = {
  brief:
    "You summarize transcripts and notes. Answer with one short paragraph (three to five sentences) in the language of the text. No preamble, no headings.",
  bullets:
    "You summarize transcripts and notes. Answer with five to eight bullet points, each one line, in the language of the text, using '-' as the bullet. Decisions and numbers first. No preamble.",
  actions:
    "You extract action items from transcripts and notes. Answer with a checklist: one line per item, starting with '- [ ] ', naming who does what and by when if the text says so, in the language of the text. If there are none, answer exactly: (no action items)",
};

const MERGE_PROMPT =
  "These are summaries of consecutive parts of one longer text. Merge them into a single one in the same form, without repeating yourself:";

/** A tidy Markdown document around a text: a heading and one line of provenance. */
export function markdownDocument(ctx: Ctx, text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("#")) return `${trimmed}\n`;
  const heading = (ctx.title?.trim() || ctx.date).replace(/\s+/g, " ");
  const meta = [ctx.date, ctx.time, ctx.app, fillTemplate("{duration}", ctx)].filter(Boolean).join(" · ");
  return `# ${heading}\n\n_${meta}_\n\n${trimmed}\n`;
}

function truncate(text: string, max: number): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length <= max ? one : `${one.slice(0, max - 1).trimEnd()}…`;
}

export function realActions(backend: AutomationsBackend): ActionImpls {
  /** Bytes of a file: straight from AppData, or via a temporary copy when it lives elsewhere. */
  async function readMedia(path: string): Promise<{ bytes: Uint8Array; cleanup: () => Promise<void> }> {
    const appData = await backend.appDataDir();
    if (isUnder(path, appData)) {
      return { bytes: await backend.readBytes(path), cleanup: async () => {} };
    }
    const imported = await backend.importFile(path);
    return {
      bytes: await backend.readBytes(imported.path),
      cleanup: () => backend.removeTemp(imported.path),
    };
  }

  return {
    transcribe: async (_action, ctx, tools) => {
      if (ctx.text?.trim() && !ctx.path) throw new SkipRun("already have text, nothing to transcribe");
      if (!ctx.path) throw new SkipRun("no file to transcribe");
      const ext = ctx.ext ?? extOf(ctx.path);
      if (!MEDIA_EXT.has(ext)) {
        if (ctx.text?.trim()) {
          tools.note("already have text; transcription skipped");
          return;
        }
        throw new SkipRun(`.${ext || "?"} is not audio or video`);
      }
      const engine = await import("@feature-dictation/engine");
      const { dictationReady } = await import("@feature-dictation/models");
      const status = await engine.dictationStatus();
      if (!dictationReady(status)) throw new Error("no speech engine installed yet (dictate → Models)");
      const wantCues = tools.rule.actions.some((a) => a.kind === "save-text" && a.format === "srt");
      const whisper = Boolean(status?.engine && status?.model);
      const json = wantCues && whisper;
      if (wantCues && !whisper) tools.note("SRT timings need whisper; Parakeet gives plain text");

      const { bytes, cleanup } = await readMedia(ctx.path);
      try {
        const blob = new Blob([bytes as BlobPart], { type: MIME[ext] ?? "application/octet-stream" });
        const lang = engine.getDictationSettings().lang;
        const started = Date.now();
        const raw = await engine.transcribeBlob(blob, lang, json, false, { ignoreSessionContext: true });
        const seconds = ((Date.now() - started) / 1000).toFixed(1);
        if (json) {
          const cues = engine.parseWhisperJson(raw);
          const text = cues.map((c) => c.text.trim()).join(" ").trim();
          if (!text) throw new SkipRun("no speech found in the file");
          tools.note(`transcribed ${cues.length} cues in ${seconds} s`);
          const last = cues[cues.length - 1];
          return { text, cues, durationMs: ctx.durationMs ?? (last ? Math.round(last.end * 1000) : undefined) };
        }
        const text = raw.trim();
        if (!text) throw new SkipRun("no speech found in the file");
        tools.note(`transcribed ${text.split(/\s+/).length} words in ${seconds} s`);
        return { text };
      } finally {
        await cleanup().catch(() => undefined);
      }
    },

    summarize: async (action, ctx, tools) => {
      const text = ctx.text?.trim();
      if (!text) throw new SkipRun("no text to summarize");
      const llm = await import("@core/llm");
      const status = await llm.llmStatus();
      if (!status.available) {
        tools.note(`summary skipped: ${status.reason ?? "no language model"} (Settings → Intelligence)`);
        return;
      }
      try {
        const system = SUMMARY_SYSTEM[action.style];
        const chunks = llm.chunkForModel(text, 3000);
        const parts: string[] = [];
        for (const chunk of chunks) {
          parts.push(
            (await llm.llmComplete({ system, prompt: chunk, purpose: "automation summary", maxTokens: 700 })).trim(),
          );
        }
        const summary =
          parts.length === 1
            ? parts[0]
            : (
                await llm.llmComplete({
                  system,
                  prompt: `${MERGE_PROMPT}\n\n${parts.join("\n\n")}`,
                  purpose: "automation summary",
                  maxTokens: 900,
                })
              ).trim();
        if (!summary) {
          tools.note("the model answered with nothing; summary skipped");
          return;
        }
        tools.note(`summarized (${status.provider ?? "model"}${chunks.length > 1 ? `, ${chunks.length} parts` : ""})`);
        return { summary };
      } catch (err) {
        if (err instanceof llm.LlmUnavailable) {
          tools.note(`summary skipped: ${err.message}`);
          return;
        }
        throw err;
      }
    },

    "save-text": async (action, ctx, tools) => {
      const { text, fellBack } = pickSource(ctx, action.source);
      let body: string;
      if (action.format === "srt") {
        const { segmentsToSrt } = await import("@feature-editor/lib/srt");
        if (ctx.cues?.length) {
          body = segmentsToSrt(ctx.cues);
        } else if (text.trim()) {
          tools.note("no timings for SRT; saved the text as one cue");
          body = segmentsToSrt([{ start: 0, end: Math.max(1, (ctx.durationMs ?? 1000) / 1000), text: text.trim() }]);
        } else {
          throw new SkipRun("nothing to save");
        }
      } else {
        if (!text.trim()) throw new SkipRun(action.source === "summary" ? "no summary or text to save" : "no text to save");
        if (fellBack) tools.note("no summary; saved the text instead");
        body = action.format === "md" ? markdownDocument(ctx, text) : `${text.trim()}\n`;
      }
      const folder = action.folder.includes("{") ? fillTemplate(action.folder, ctx) : action.folder.trim();
      if (!folder) throw new Error("no folder to save into");
      const name = `${safeFileName(fillTemplate(action.name, ctx), ctx.date)}.${action.format}`;
      const written = await backend.writeText(folder, name, body);
      tools.note(`saved ${written.name}`);
      return { savedPath: written.path };
    },

    "social-draft": async (action, ctx, tools) => {
      const { text: source, fellBack } = pickSource(ctx, action.source);
      const text = (action.template ? fillTemplate(action.template, ctx) : source).trim();
      if (!text) throw new SkipRun("nothing to post");
      if (fellBack && !action.template) tools.note("no summary; used the text");
      const { createDraft } = await import("@feature-social/api");
      const ext = ctx.ext ?? (ctx.path ? extOf(ctx.path) : "");
      const mediaPaths = ctx.path && POST_MEDIA_EXT.has(ext) ? [ctx.path] : undefined;
      const result = await createDraft({
        text,
        channelIds: action.channelIds,
        mediaPaths,
        queue: action.queue,
        source: "automation",
        open: false,
      });
      tools.note(`draft ${result.id} (${result.status})${mediaPaths ? ", with the file attached" : ""}`);
    },

    "add-task": async (action, ctx, tools) => {
      const { text, fellBack } = pickSource(ctx, action.source);
      const titles = taskTitles(text);
      if (!titles.length) throw new SkipRun("no tasks in the text");
      if (fellBack) tools.note("no summary; tasks come from the text");
      const { useAppStore } = await import("@feature-focus/store/useAppStore");
      const add = useAppStore.getState().addTask;
      for (const title of titles) add(title);
      tools.note(`added ${titles.length} task${titles.length === 1 ? "" : "s"}`);
    },

    "copy-clipboard": async (action, ctx, tools) => {
      const { text, fellBack } = pickSource(ctx, action.source);
      if (!text.trim()) throw new SkipRun("nothing to copy");
      if (fellBack) tools.note("no summary; copied the text");
      await navigator.clipboard.writeText(text);
      tools.note("copied to the clipboard");
    },

    notify: async (action, ctx, tools) => {
      const { notify } = await import("@feature-focus/lib/notify");
      const title = fillTemplate(action.title, ctx) || "owntools";
      const body = truncate(fillTemplate(action.body, ctx), 200);
      await notify(title, body);
      tools.note(`notified: ${title}`);
    },

    open: async (action, ctx, tools) => {
      const target = fillTemplate(action.target, ctx).trim();
      if (!target) throw new SkipRun("nothing to open");
      if (!isTauri()) {
        if (/^https?:/i.test(target)) window.open(target, "_blank", "noopener");
        tools.note(`opened ${target}`);
        return;
      }
      const { invoke } = await import("@tauri-apps/api/core");
      const outcomes = await invoke<{ id: string; ok: boolean; error: string | null }[]>("launch_session", {
        steps: [{ id: "automation", kind: openKindFor(target), target, args: null, cwd: null }],
      });
      const failed = outcomes.find((o) => !o.ok);
      if (failed) throw new Error(failed.error ?? `could not open ${target}`);
      tools.note(`opened ${target}`);
    },

    "remove-fillers": async (_action, ctx, tools) => {
      const text = ctx.text?.trim();
      if (!text) throw new SkipRun("no text to clean");
      const { removeFillers } = await import("@feature-dictation/cleanup");
      const cleaned = removeFillers(text);
      const removed = text.split(/\s+/).length - cleaned.split(/\s+/).length;
      tools.note(removed > 0 ? `removed ${removed} filler word${removed === 1 ? "" : "s"}` : "no fillers found");
      return { text: cleaned };
    },
  };
}
