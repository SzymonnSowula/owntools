/**
 * Getting around the main window from inside a tool.
 *
 * Tools are lazy chunks of one page, not separate apps, so moving between
 * them is a DOM event the shell listens for (`App.tsx`) plus, when a tool
 * should open on a particular page of its own sidebar, a one-shot note the
 * tool reads as it mounts. Neither survives a reload: a jump is something you
 * just asked for, not saved state.
 */

/** The shell opens Settings on the category holding `detail.section` and scrolls to it. */
export const OPEN_SETTINGS_SECTION_EVENT = "owntools:open-settings";

/**
 * Opens Settings, optionally at one setting (`"scroll-guard"`, `"intelligence"`,
 * a category id like `"privacy"`). In a window without the shell (the pill,
 * the capture overlay) nobody hears the event — say "open owntools → Settings"
 * there instead.
 */
export function openSettings(section?: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPEN_SETTINGS_SECTION_EVENT, { detail: { section } }));
}

const pendingPages = new Map<string, string>();

/** Asks `tool` to open on `page` the next time it mounts (its sidebar's page id). */
export function requestToolPage(tool: string, page: string): void {
  pendingPages.set(tool, page);
}

/** What a tool was asked to open on, once; null when nobody asked. */
export function takeToolPage<T extends string>(tool: string): T | null {
  const page = pendingPages.get(tool);
  pendingPages.delete(tool);
  return (page as T | undefined) ?? null;
}
