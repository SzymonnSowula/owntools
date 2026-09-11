/**
 * Per-app profiles: how a take is finished depends on where it is going.
 *
 * A chat message wants the fillers gone and Enter pressed; an e-mail wants
 * full sentences and a greeting; a terminal wants exactly what was said. The
 * pill asks Rust which application is in front when a take *starts*
 * (`dictation_target` → process image name + window title) and the first
 * profile that matches decides:
 *
 *   removeFillers — overrides the global switch for this app;
 *   mode          — a tone the language model rewrites into, when one is set
 *                   up (Settings → Intelligence). Without a model the text is
 *                   inserted as dictated and the History entry says so; a
 *                   missing model is never an error and never a wait;
 *   autoSend      — press Enter after typing, the way "send it" does.
 *
 * `appPattern` is matched case-insensitively against the process name
 * ("slack.exe", "Code.exe", "Slack" on macOS) and the window title: a plain
 * word is a substring, `*` and `?` make it a glob over the whole name. The
 * most specific match wins — an exact process name over a glob over a
 * substring over a title hit — and ties go to the earlier profile.
 *
 * Pure, tested; the store is the dictation settings JSON.
 */

export type ProfileMode = "plain" | "email" | "list" | "casual" | "formal";

export interface AppProfile {
  id: string;
  /** Substring or glob over the foreground process name / window title. */
  appPattern: string;
  removeFillers?: boolean;
  mode?: ProfileMode;
  autoSend?: boolean;
}

/** What Rust reports about the window in front when a take starts. */
export interface ForegroundApp {
  /** Process image name ("slack.exe"), or the app name on macOS; null when unknown. */
  app: string | null;
  title: string | null;
}

export const PROFILE_MODES: { id: ProfileMode; label: string; hint: string }[] = [
  { id: "plain", label: "As dictated", hint: "No rewriting — the words as you said them." },
  { id: "email", label: "E-mail", hint: "Full sentences, paragraphs, a greeting and a sign-off kept if you said them." },
  { id: "list", label: "List", hint: "One item per line, as a bulleted list." },
  { id: "casual", label: "Casual", hint: "Short and relaxed — a chat message." },
  { id: "formal", label: "Formal", hint: "Polished and complete; contractions expanded, slang out." },
];

/**
 * The instructions the language model gets for each mode. They all end with
 * the same fence: the model edits, it does not answer, and it keeps the
 * language of the take.
 */
const FENCE =
  " Keep the original language. Do not add information, do not answer or comment, do not wrap the result in quotes. Return only the rewritten text.";

export const MODE_INSTRUCTIONS: Record<Exclude<ProfileMode, "plain">, string> = {
  email:
    "Rewrite the dictated text as the body of an e-mail: complete sentences, paragraphs where the topic changes, correct punctuation. Keep any greeting or sign-off the speaker said; do not invent one." +
    FENCE,
  list: "Turn the dictated text into a bulleted list, one item per line starting with '- '. Keep every item, keep the order, drop filler words." + FENCE,
  casual: "Rewrite the dictated text as a short, relaxed chat message. Fix punctuation, drop filler words, keep the speaker's words and tone." + FENCE,
  formal: "Rewrite the dictated text in a polished, formal register: complete sentences, no contractions, no slang, correct punctuation. Keep the meaning exactly." + FENCE,
};

let counter = 0;

function newId(): string {
  counter += 1;
  return `p${Date.now().toString(36)}${counter.toString(36)}`;
}

export function normalizePattern(pattern: string): string {
  return pattern.replace(/\s+/g, " ").trim();
}

const MODES = new Set<ProfileMode>(PROFILE_MODES.map((m) => m.id));

export function isProfileMode(value: unknown): value is ProfileMode {
  return typeof value === "string" && MODES.has(value as ProfileMode);
}

/** Folds whatever is in the settings JSON onto valid profiles; bad rows are dropped. */
export function sanitizeProfiles(raw: unknown): AppProfile[] {
  if (!Array.isArray(raw)) return [];
  const out: AppProfile[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const appPattern = typeof r.appPattern === "string" ? normalizePattern(r.appPattern) : "";
    if (!appPattern) continue;
    const id = typeof r.id === "string" && r.id && !seen.has(r.id) ? r.id : newId();
    seen.add(id);
    const profile: AppProfile = { id, appPattern };
    if (typeof r.removeFillers === "boolean") profile.removeFillers = r.removeFillers;
    if (isProfileMode(r.mode) && r.mode !== "plain") profile.mode = r.mode;
    if (r.autoSend === true) profile.autoSend = true;
    out.push(profile);
  }
  return out;
}

export function createProfile(appPattern: string, patch: Omit<Partial<AppProfile>, "id" | "appPattern"> = {}): AppProfile | null {
  const pattern = normalizePattern(appPattern);
  if (!pattern) return null;
  return sanitizeProfiles([{ id: newId(), appPattern: pattern, ...patch }])[0] ?? null;
}

/** Replaces the profile with the same id, or appends. Order is precedence on ties. */
export function upsertProfile(profiles: AppProfile[], profile: AppProfile): AppProfile[] {
  const idx = profiles.findIndex((p) => p.id === profile.id);
  if (idx < 0) return [...profiles, profile];
  const next = profiles.slice();
  next[idx] = profile;
  return next;
}

export function removeProfile(profiles: AppProfile[], id: string): AppProfile[] {
  return profiles.filter((p) => p.id !== id);
}

function globToRegExp(glob: string): RegExp {
  const body = glob
    .split("")
    .map((ch) => (ch === "*" ? ".*" : ch === "?" ? "." : ch.replace(/[.+^${}()|[\]\\]/g, "\\$&")))
    .join("");
  return new RegExp(`^${body}$`, "iu");
}

/** "C:\\Program Files\\Slack\\slack.exe" → "slack.exe"; already-bare names pass through. */
export function appBasename(app: string): string {
  const parts = app.split(/[\\/]/);
  return (parts[parts.length - 1] || app).trim();
}

function withoutExe(name: string): string {
  return name.replace(/\.exe$/i, "");
}

/**
 * How well a pattern fits the app in front, or null. Higher is more specific:
 * exact process name 100, glob on the process 80, substring of the process 70,
 * glob on the title 40, substring of the title 30 — each plus the pattern
 * length so "slack" loses to "slack.exe" and "code" to "code - insiders".
 */
export function patternScore(pattern: string, target: ForegroundApp): number | null {
  const p = normalizePattern(pattern).toLocaleLowerCase();
  if (!p) return null;
  const app = target.app ? appBasename(target.app).toLocaleLowerCase() : "";
  const title = (target.title ?? "").toLocaleLowerCase();
  const bonus = p.length / 100;
  if (/[*?]/.test(p)) {
    const re = globToRegExp(p);
    if (app && (re.test(app) || re.test(withoutExe(app)))) return 80 + bonus;
    if (title && re.test(title)) return 40 + bonus;
    return null;
  }
  if (app && (app === p || withoutExe(app) === withoutExe(p))) return 100 + bonus;
  if (app && app.includes(p)) return 70 + bonus;
  if (title && title.includes(p)) return 30 + bonus;
  return null;
}

/** The profile for the app in front, or null when none matches (or nothing is known). */
export function matchProfile(profiles: AppProfile[], target: ForegroundApp): AppProfile | null {
  if (!target.app && !target.title) return null;
  let best: { profile: AppProfile; score: number } | null = null;
  for (const profile of profiles) {
    const score = patternScore(profile.appPattern, target);
    if (score === null) continue;
    if (!best || score > best.score) best = { profile, score };
  }
  return best?.profile ?? null;
}

/** "remove fillers · e-mail tone · presses Enter" — for a row's hint. */
export function describeProfile(profile: AppProfile): string {
  const parts: string[] = [];
  if (profile.removeFillers === true) parts.push("remove fillers");
  if (profile.removeFillers === false) parts.push("keep fillers");
  if (profile.mode && profile.mode !== "plain") {
    parts.push(`${PROFILE_MODES.find((m) => m.id === profile.mode)?.label.toLocaleLowerCase() ?? profile.mode} tone`);
  }
  if (profile.autoSend) parts.push("presses Enter");
  return parts.length ? parts.join(" · ") : "as dictated";
}

/** Offered on an empty list: the two things people set up first. */
export const STARTER_PROFILES: { label: string; profile: Omit<AppProfile, "id"> }[] = [
  { label: "Slack: remove fillers", profile: { appPattern: "slack", removeFillers: true } },
  { label: "Outlook: e-mail tone", profile: { appPattern: "outlook", mode: "email" } },
  { label: "Teams: casual, then Enter", profile: { appPattern: "teams", mode: "casual", autoSend: true } },
];
