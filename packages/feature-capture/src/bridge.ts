import { logError, logInfo } from "@core/errors";
import { CAPTURE_SAVED_EVENT, emitToolEvent } from "@core/events";
import { handOff } from "@core/handoff";
import { isTauri } from "@core/env";
import { createDraft } from "@feature-social/api";
import { getCaptureBackend } from "./api";
import type { CaptureSavedPayload } from "./api/types";

/**
 * The main window's half of capture.
 *
 * The overlay is its own window, so when it wants a capture on the board or
 * in a social draft it cannot call `handOff` / `createDraft` itself — those
 * live in the main window's memory. It sends a Tauri event with the saved
 * file's path instead, and this bridge, started once from App.tsx, turns the
 * path back into what those two tools take: bytes for the board (the handoff
 * contract carries a file in memory), a media path for social.
 *
 * It also republishes Rust's `capture-saved` as `CAPTURE_SAVED_EVENT` so
 * automations and the library hear about a capture through the same DOM event
 * as everything else.
 */

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || "capture.png";
}

/** Puts a saved capture on the board as an image at the view centre and switches to it. */
export async function sendToBoard(path: string, title?: string | null): Promise<void> {
  const bytes = await getCaptureBackend().readBytes(path);
  handOff({
    tool: "board",
    file: { bytes, name: baseName(path), mime: "image/png" },
    title: title ?? undefined,
    from: "capture",
  });
}

/** Starts a social draft with the capture attached and opens the composer. */
export async function sendToSocial(path: string): Promise<void> {
  await createDraft({ text: "", mediaPaths: [path], source: "capture", open: true });
}

let started = false;

/**
 * Main-window listeners for the overlay's events. Idempotent; returns the
 * unsubscribe. Outside Tauri there is no second window, so it does nothing.
 */
export function startCaptureBridge(): () => void {
  if (started || !isTauri()) return () => {};
  started = true;
  const unsubs: (() => void)[] = [];
  let disposed = false;
  void import("@tauri-apps/api/event").then(async ({ listen }) => {
    const add = (un: () => void) => (disposed ? un() : unsubs.push(un));
    add(
      await listen<CaptureSavedPayload>("capture-saved", (e) => {
        emitToolEvent(CAPTURE_SAVED_EVENT, e.payload);
      }),
    );
    add(
      await listen<{ path: string; title?: string | null }>("capture-to-board", (e) => {
        logInfo("capture", `to board: ${e.payload.path}`);
        sendToBoard(e.payload.path, e.payload.title).catch((err) => logError("capture", "to board", err));
      }),
    );
    add(
      await listen<{ path: string }>("capture-to-social", (e) => {
        logInfo("capture", `to social: ${e.payload.path}`);
        sendToSocial(e.payload.path).catch((err) => logError("capture", "to social", err));
      }),
    );
  });
  return () => {
    disposed = true;
    started = false;
    for (const un of unsubs) un();
    unsubs.length = 0;
  };
}
