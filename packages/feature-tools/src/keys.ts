/**
 * Every quick tool the hub can open, in display order. Each one is a small
 * modal over the hub except `voicenote`, which jumps straight into focus →
 * notes. The catalogue (`catalogue.tsx`) carries the cards' copy and icons;
 * `HubToolModals` maps a key to its modal.
 */
export const QUICK_TOOL_KEYS = [
  "transcribe",
  "translate",
  "youtube",
  "subtitles",
  "voicenote",
  "pdf",
  "makepdf",
  "images",
  "removebg",
  "imagine",
  "extract",
  "audio",
  "video",
  "gif",
] as const;

export type QuickToolKey = (typeof QUICK_TOOL_KEYS)[number];

export function isQuickToolKey(value: unknown): value is QuickToolKey {
  return typeof value === "string" && (QUICK_TOOL_KEYS as readonly string[]).includes(value);
}
