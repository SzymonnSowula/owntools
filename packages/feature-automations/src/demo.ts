/**
 * The browser stand-in for the desktop backend: rules and runs in memory, a
 * seeded set from the four templates, "written" files kept in a Map, and a
 * `simulateFileAdded` for the dev page. Same contract as `tauri.ts`, so the
 * card is exercised end to end under `pnpm dev` and in the browser preview.
 */

import type { AutomationsBackend, FileAdded, FolderEntry, RecordingInfo, WatchFolder } from "./backend";
import {
  dayKey,
  extOf,
  fileStem,
  isUnder,
  newRule,
  TEMPLATES,
  uid,
  type Rule,
  type RunRecord,
} from "./rules";
import { SkipRun, type ActionImpls } from "./run";

export const DEMO_NOTES = "C:\\Users\\demo\\Documents\\Notes";
export const DEMO_DOWNLOADS = "C:\\Users\\demo\\Downloads";
export const DEMO_APPDATA = "C:\\Users\\demo\\AppData\\Roaming\\app.owntools.desktop";

export const DEMO_TRANSCRIPT = [
  "Ana: Let's start with the launch date. We said the 24th, and I think we can hold it if the installer is signed by Friday.",
  "Marek: The certificate arrived this morning, so signing is on me. I'll have a signed build by Thursday.",
  "Ana: Good. Second thing - the pricing page still says forty-nine dollars. We agreed on one price everywhere.",
  "Marek: I'll change the constant and re-deploy the landing tonight.",
  "Ana: And the release notes. Can you draft them from the changelog and send them to me for a read?",
  "Marek: Yes. Action items then: sign the build by Thursday, fix the price tonight, draft the release notes by Wednesday.",
].join("\n\n");

export const DEMO_CUES = [
  { start: 0, end: 6.4, text: "Let's start with the launch date. We said the 24th." },
  { start: 6.4, end: 11.8, text: "I think we can hold it if the installer is signed by Friday." },
  { start: 11.8, end: 17.2, text: "The certificate arrived this morning, so signing is on me." },
];

export interface DemoBackend extends AutomationsBackend {
  /** Files "written" by save-text, path → text. */
  written: Map<string, string>;
  /** Pretends a file landed in a watched folder; returns how many rules it reached. */
  simulateFileAdded(name: string, size?: number): number;
  /** Actions that need the desktop, replaced with canned results so a demo run is green. */
  actionOverrides(): Partial<ActionImpls>;
}

type Listener<T> = (payload: T) => void;

class Emitter<T> {
  private set = new Set<Listener<T>>();
  on(cb: Listener<T>): () => void {
    this.set.add(cb);
    return () => this.set.delete(cb);
  }
  emit(payload: T): number {
    for (const cb of this.set) cb(payload);
    return this.set.size;
  }
}

function seedRules(): Rule[] {
  const [meeting, exportDraft, downloads, daily] = TEMPLATES.map((t) => t.make());
  const withFolder = (rule: typeof meeting, folder: string) => ({
    ...rule,
    actions: rule.actions.map((a) => (a.kind === "save-text" && !a.folder ? { ...a, folder } : a)),
  });
  const dayAgo = Date.now() - 86_400_000;
  return [
    newRule({ id: "demo-meeting", ...withFolder(meeting, DEMO_NOTES), createdAt: dayAgo * 0.98, runCount: 3, lastRunAt: Date.now() - 3_600_000 }),
    newRule({ id: "demo-export", ...exportDraft, createdAt: dayAgo * 0.99, runCount: 1, lastRunAt: dayAgo }),
    newRule({
      id: "demo-downloads",
      ...downloads,
      trigger: { kind: "file-added", folder: DEMO_DOWNLOADS, extensions: ["mp3", "m4a", "wav", "ogg", "flac", "mp4", "webm"] },
      enabled: false,
      createdAt: dayAgo,
    }),
    newRule({
      id: "demo-daily",
      ...withFolder(daily, DEMO_NOTES),
      createdAt: dayAgo,
      runCount: 4,
      lastRunAt: dayAgo,
      lastFiredDay: dayKey(new Date()),
    }),
  ];
}

function seedRuns(): RunRecord[] {
  const now = Date.now();
  return [
    {
      id: "demo-run-1",
      ruleId: "demo-meeting",
      ruleName: "Meeting → note",
      startedAt: now - 3_600_000,
      ms: 1840,
      status: "ok",
      notes: ["summary skipped: No language model is set up yet. (Settings → Intelligence)", "no summary; saved the text instead", "saved 2026-09-11 Standup.md"],
      outputPath: `${DEMO_NOTES}\\2026-09-11 Standup.md`,
    },
    {
      id: "demo-run-2",
      ruleId: "demo-export",
      ruleName: "Export → draft post",
      startedAt: now - 86_400_000,
      ms: 320,
      status: "error",
      notes: [],
      error: "draft a post: social is not wired up yet.",
      outputPath: "C:\\Users\\demo\\Videos\\launch demo.mp4",
    },
    {
      id: "demo-run-3",
      ruleId: "demo-daily",
      ruleName: "Daily dictation note",
      startedAt: now - 90_000_000,
      ms: 12,
      status: "skipped",
      notes: ["save .md in Notes: no text to save"],
    },
  ];
}

export function createDemoBackend(): DemoBackend {
  let rules = seedRules();
  let runs = seedRuns();
  let watching: WatchFolder[] = [];
  const fileAdded = new Emitter<FileAdded>();
  const written = new Map<string, string>();
  let picks = 0;

  const backend: DemoBackend = {
    written,
    loadRules: async () => rules.map((r) => ({ ...r })),
    saveRules: async (next) => {
      rules = next.map((r) => ({ ...r }));
    },
    loadRuns: async () => runs.slice(),
    saveRuns: async (next) => {
      runs = next.slice();
    },
    watchSet: async (folders) => {
      watching = folders;
    },
    onFileAdded: (cb) => fileAdded.on(cb),
    onRecordingFinished: () => () => {},
    recordingInfo: async (projectId): Promise<RecordingInfo | null> => ({
      title: `Recording ${projectId}`,
      durationMs: 42_000,
      path: `${DEMO_APPDATA}\\recordings\\projects\\${projectId}\\screen.webm`,
    }),
    pickFolder: async () => {
      picks += 1;
      return picks % 2 === 1 ? DEMO_NOTES : DEMO_DOWNLOADS;
    },
    allowFolder: async () => {},
    writeText: async (folder, name, text) => {
      let candidate = `${folder}\\${name}`;
      let n = 2;
      while (written.has(candidate)) {
        const stem = fileStem(name);
        const ext = extOf(name);
        candidate = `${folder}\\${stem} (${n})${ext ? `.${ext}` : ""}`;
        n += 1;
      }
      written.set(candidate, text);
      return { path: candidate, name: candidate.slice(folder.length + 1) };
    },
    importFile: async (path) => ({ path: `${DEMO_APPDATA}\\automations\\tmp\\${Date.now()}-${fileStem(path)}.${extOf(path)}`, size: 3_145_728 }),
    removeTemp: async () => {},
    listFolder: async (folder): Promise<FolderEntry[]> => {
      if (!isUnder(folder, DEMO_DOWNLOADS) && !isUnder(folder, DEMO_NOTES)) return [];
      const now = Date.now();
      return [
        { name: "team call.mp3", path: `${folder}\\team call.mp3`, size: 18_400_000, mtime: now - 600_000 },
        { name: "voice memo 12.m4a", path: `${folder}\\voice memo 12.m4a`, size: 2_100_000, mtime: now - 7_200_000 },
        { name: "invoice.pdf", path: `${folder}\\invoice.pdf`, size: 88_000, mtime: now - 86_400_000 },
      ];
    },
    readText: async (path) => {
      if (/transcript\.md$/i.test(path)) return DEMO_TRANSCRIPT;
      return written.get(path) ?? "";
    },
    readBytes: async () => {
      throw new Error("the browser preview has no files to read");
    },
    appDataDir: async () => DEMO_APPDATA,
    revealPath: async (path) => {
      // eslint-disable-next-line no-alert
      window.alert(`Would reveal ${path}`);
    },
    simulateFileAdded: (name, size = 5_000_000) => {
      const path = `${DEMO_DOWNLOADS}\\${name}`;
      const ext = extOf(path);
      let reached = 0;
      for (const w of watching) {
        if (!isUnder(DEMO_DOWNLOADS, w.folder)) continue;
        if (w.extensions.length && !w.extensions.includes(ext)) continue;
        fileAdded.emit({ ruleId: w.ruleId, path, size });
        reached += 1;
      }
      return reached;
    },
    actionOverrides: () => ({
      transcribe: async (_a, ctx, tools) => {
        if (!ctx.path) throw new SkipRun("no file to transcribe");
        tools.note("(demo) transcribed in 0.7 s");
        return { text: DEMO_TRANSCRIPT, cues: DEMO_CUES, durationMs: ctx.durationMs ?? 17_200 };
      },
      "social-draft": async (_a, ctx, tools) => {
        const text = ctx.summary ?? ctx.text ?? ctx.title ?? "";
        if (!text.trim()) throw new SkipRun("nothing to post");
        tools.note(`(demo) draft ${uid("post")} created (needs_review)`);
      },
      notify: async (a, _ctx, tools) => {
        tools.note(`(demo) notification: ${a.title}`);
      },
      open: async (a, _ctx, tools) => {
        tools.note(`(demo) would open ${a.target}`);
      },
      "copy-clipboard": async (_a, ctx, tools) => {
        const text = ctx.summary ?? ctx.text ?? "";
        if (!text.trim()) throw new SkipRun("nothing to copy");
        try {
          await navigator.clipboard.writeText(text);
          tools.note("copied");
        } catch {
          tools.note("(demo) clipboard not available here");
        }
      },
    }),
  };
  return backend;
}
