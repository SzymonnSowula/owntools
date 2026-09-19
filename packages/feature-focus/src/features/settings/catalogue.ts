/**
 * What is in Settings and where it lives — the one list the sidebar, the
 * search box and every "open settings at X" link read.
 *
 * Settings used to be a single scroll of eleven cards inside focus, which
 * answered "where is the tray option?" with "scroll". Now every setting has a
 * category (the sidebar), an id (a `data-settings-section` on its row, which
 * is what links and search results scroll to) and the words people actually
 * type for it. A setting that exists in the UI but not here cannot be found
 * by search, so a new row gets an entry in the same change.
 */

export type SettingsCategoryId =
  | "general"
  | "appearance"
  | "license"
  | "focus"
  | "intelligence"
  | "automations"
  | "data"
  | "storage"
  | "privacy"
  | "about";

/** Tools whose own sidebar holds settings that only make sense inside them. */
export type ToolWithSettings = "dictate" | "meet" | "capture" | "social";

export interface SettingsCategory {
  id: SettingsCategoryId;
  label: string;
  /** One sentence under the page title. */
  blurb: string;
  group: "app" | "work" | "data" | "help";
}

export const SETTINGS_CATEGORIES: readonly SettingsCategory[] = [
  { id: "general", label: "General", blurb: "How owntools starts, closes and which keys open what.", group: "app" },
  { id: "appearance", label: "Appearance", blurb: "One theme for every tool.", group: "app" },
  { id: "license", label: "License", blurb: "One payment, an offline key, no account.", group: "app" },
  { id: "focus", label: "Focus", blurb: "The timer, what a session does, and the scroll guard.", group: "work" },
  {
    id: "intelligence",
    label: "Intelligence",
    blurb: "The language and image models the tools share - on this device unless you add a key of your own.",
    group: "work",
  },
  { id: "automations", label: "Automations", blurb: "Rules that take the next step when something finishes.", group: "work" },
  {
    id: "data",
    label: "Sync & backup",
    blurb: "Keep your devices in step through a folder you already sync, or save a backup.",
    group: "data",
  },
  {
    id: "storage",
    label: "Storage",
    blurb: "How much space owntools uses on this device, and a quick way to free some.",
    group: "data",
  },
  { id: "privacy", label: "Privacy", blurb: "What is read on this device, and everything that leaves it.", group: "data" },
  { id: "about", label: "About & support", blurb: "Version, logs and a way to report a problem.", group: "help" },
];

export const SETTINGS_GROUP_LABEL: Record<SettingsCategory["group"], string | null> = {
  app: null,
  work: "work",
  data: "your data",
  help: "help",
};

export interface ToolSettingsLink {
  tool: ToolWithSettings;
  label: string;
  /** What is in that tool's own settings, in a few words. */
  blurb: string;
}

export const TOOL_SETTINGS: readonly ToolSettingsLink[] = [
  { tool: "dictate", label: "dictate", blurb: "language, clean-up, voice commands" },
  { tool: "meet", label: "meet", blurb: "microphone, speakers, summaries" },
  { tool: "capture", label: "capture", blurb: "where captures go, text recognition" },
  { tool: "social", label: "social", blurb: "approvals, agents, brand voice" },
];

export interface SettingsItem {
  /** Also the `data-settings-section` of the row it points at. */
  id: string;
  label: string;
  where: SettingsCategoryId | ToolWithSettings;
  keywords: readonly string[];
}

export const SETTINGS_ITEMS: readonly SettingsItem[] = [
  {
    id: "bar",
    label: "The bar",
    where: "general",
    keywords: ["bar", "toolbar", "dock", "floating", "overlay", "widget", "capsule", "pasek", "hide bar", "show bar", "position"],
  },
  { id: "autostart", label: "Start with the system", where: "general", keywords: ["autostart", "login", "boot", "startup", "launch"] },
  { id: "close-window", label: "When I close the window", where: "general", keywords: ["tray", "close", "background", "minimize", "quit"] },
  { id: "quit", label: "Quit owntools", where: "general", keywords: ["exit", "close app", "stop"] },
  { id: "shortcuts", label: "Keyboard shortcuts", where: "general", keywords: ["hotkey", "keys", "ctrl", "dictation hotkey", "capture shortcut"] },
  { id: "theme", label: "Theme", where: "appearance", keywords: ["dark", "night", "light", "day", "colours", "colors", "nature", "ocean", "sunset"] },
  { id: "license", label: "License key", where: "license", keywords: ["pro", "activate", "deactivate", "badge", "watermark", "buy", "purchase"] },
  { id: "timer", label: "Focus and break length", where: "focus", keywords: ["pomodoro", "timer", "minutes", "break"] },
  { id: "session", label: "What a session does", where: "focus", keywords: ["notifications", "notify", "full screen", "fullscreen"] },
  { id: "heatmap", label: "Heatmap goal", where: "focus", keywords: ["stats", "active time", "daily goal", "tasks"] },
  { id: "scroll-guard", label: "Scroll guard", where: "focus", keywords: ["block", "sites", "distraction", "x.com", "tiktok", "instagram", "scroll lock"] },
  {
    id: "intelligence",
    label: "Language model",
    where: "intelligence",
    keywords: ["ai", "llm", "model", "qwen", "cloud", "api key", "openai", "anthropic", "summary"],
  },
  {
    id: "images",
    label: "Image generation",
    where: "intelligence",
    keywords: [
      "image", "picture", "generate", "text to image", "flux", "stable diffusion", "z-image", "api key", "byok", "own key",
      "openai", "gpt image", "gemini", "nano banana", "openrouter", "replicate", "fal", "together", "hugging face", "stability",
      "ideogram", "recraft", "grok", "comfyui", "automatic1111", "obraz", "generowanie",
    ],
  },
  {
    id: "background-removal",
    label: "Background removal",
    where: "intelligence",
    keywords: ["remove background", "cutout", "cut out", "transparent", "matting", "isnet", "modnet", "usuwanie tla", "tlo"],
  },
  { id: "automations", label: "Automation rules", where: "automations", keywords: ["rules", "triggers", "workflow", "when", "watch folder"] },
  { id: "sync", label: "Sync between devices", where: "data", keywords: ["dropbox", "onedrive", "icloud", "syncthing", "folder", "devices"] },
  { id: "backup", label: "Export and backup", where: "data", keywords: ["markdown", "json", "restore", "export", "backup"] },
  {
    id: "cache",
    label: "Clear cache",
    where: "storage",
    keywords: ["cache", "temporary", "temp files", "clean up", "free space", "disk space", "junk", "leftovers"],
  },
  { id: "downloads", label: "Unfinished downloads", where: "storage", keywords: ["partial", "paused download", "part files", "installer"] },
  {
    id: "files",
    label: "Delete screenshots, recordings and meeting audio",
    where: "storage",
    keywords: ["screenshots", "captures", "recordings", "videos", "meetings", "audio", "old files", "free space", "disk space"],
  },
  { id: "models", label: "Space used by models", where: "storage", keywords: ["whisper", "parakeet", "qwen", "model size", "gigabytes"] },
  { id: "activity", label: "Time tracking in apps and websites", where: "privacy", keywords: ["usage", "activity", "tracking", "window titles"] },
  { id: "privacy", label: "Network log and offline mode", where: "privacy", keywords: ["requests", "offline", "network", "receipt", "internet"] },
  { id: "diagnostics", label: "Diagnostics and logs", where: "about", keywords: ["support", "report", "bug", "version", "log"] },
  { id: "updates", label: "Check for updates", where: "about", keywords: ["update", "version", "new", "upgrade", "install", "release", "latest"] },
  { id: "tool-dictate", label: "Dictation", where: "dictate", keywords: ["language", "whisper", "parakeet", "fillers", "voice commands", "vocabulary"] },
  { id: "tool-meet", label: "Meeting recording", where: "meet", keywords: ["meet", "microphone", "system audio", "calls", "summary"] },
  { id: "tool-capture", label: "Screenshots", where: "capture", keywords: ["capture", "screenshot", "ocr", "save folder", "pictures"] },
  { id: "tool-social", label: "Post scheduling", where: "social", keywords: ["social", "approval", "agents", "brand voice", "posts"] },
];

const CATEGORY_IDS = new Set<string>(SETTINGS_CATEGORIES.map((c) => c.id));

export function isCategory(id: string): id is SettingsCategoryId {
  return CATEGORY_IDS.has(id);
}

/** The category a link or a search result opens, or null for a tool's own settings. */
export function categoryFor(section: string | null | undefined): SettingsCategoryId | null {
  if (!section) return null;
  if (isCategory(section)) return section;
  const item = SETTINGS_ITEMS.find((i) => i.id === section);
  return item && isCategory(item.where) ? item.where : null;
}

function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

/**
 * Settings matching what was typed: every word has to appear in the label,
 * the category name or a keyword. Label hits first, then catalogue order.
 */
export function searchSettings(query: string): SettingsItem[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const scored: { item: SettingsItem; score: number; index: number }[] = [];
  SETTINGS_ITEMS.forEach((item, index) => {
    const category = SETTINGS_CATEGORIES.find((c) => c.id === item.where)?.label ?? item.where;
    const label = fold(item.label);
    const haystack = [label, fold(category), ...item.keywords.map(fold)].join(" | ");
    if (!words.every((w) => haystack.includes(w))) return;
    const score = words.every((w) => label.includes(w)) ? 0 : 1;
    scored.push({ item, score, index });
  });
  return scored.sort((a, b) => a.score - b.score || a.index - b.index).map((s) => s.item);
}
