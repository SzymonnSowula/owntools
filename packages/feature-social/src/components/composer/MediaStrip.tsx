import { FolderOpen, Image as ImageIcon, Loader2, Plus, X } from "lucide-react";
import { useRef, useState } from "react";
import { isTauri } from "@core/env";
import { logError } from "@core/errors";
import { useSocialStore } from "../../store";
import type { MediaItem, MediaRef } from "../../types";
import { useMediaUrl } from "../../ui";
import { Popover } from "../primitives";

/**
 * Media attached to a post (or a thread part) and the picker that adds
 * more: from the library, from a file dialog, or — handled by the modal —
 * by dropping and pasting files onto the composer.
 */

/** "1:04 · 12 MB" — what decides whether a network will take the clip. */
export function describeVideo(item: MediaItem): string {
  const size = item.bytes >= 1024 * 1024 ? `${(item.bytes / 1024 / 1024).toFixed(item.bytes > 10 * 1024 * 1024 ? 0 : 1)} MB` : `${Math.round(item.bytes / 1024)} KB`;
  if (!item.duration) return size;
  const total = Math.round(item.duration);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")} · ${size}`;
}

/**
 * `badge` overlays how long the clip runs and what it weighs — the two facts
 * that decide whether a network will take it. It needs a positioned parent,
 * so the network previews (which are mock-ups of a real post) leave it off.
 */
export function Thumb({ item, className, badge }: { item: MediaItem; className?: string; badge?: boolean }) {
  const url = useMediaUrl(item.id);
  if (!url) return <div className={`grid place-items-center text-muted ${className ?? ""}`}><ImageIcon className="h-5 w-5" /></div>;
  if (item.mime.startsWith("video/")) {
    return (
      <>
        <video src={url} muted className={className} />
        {badge ? <span className="sc-media-badge">{describeVideo(item)}</span> : null}
      </>
    );
  }
  return <img src={url} alt={item.alt ?? item.name} draggable={false} className={className} />;
}

async function pickFiles(): Promise<{ bytes: Uint8Array; name: string; mime: string }[]> {
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({
      multiple: true,
      title: "Add media",
      filters: [{ name: "Images & video", extensions: ["png", "jpg", "jpeg", "gif", "webp", "mp4", "webm", "mov"] }],
    });
    const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
    const { readFile } = await import("@tauri-apps/plugin-fs");
    const out = [];
    for (const path of paths) {
      const bytes = await readFile(path);
      const name = path.split(/[\\/]/).pop() ?? "file";
      out.push({ bytes, name, mime: mimeFromName(name) });
    }
    return out;
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = "image/*,video/*";
    input.onchange = async () => {
      const files = Array.from(input.files ?? []);
      resolve(await Promise.all(files.map(async (f) => ({ bytes: new Uint8Array(await f.arrayBuffer()), name: f.name, mime: f.type || mimeFromName(f.name) }))));
    };
    input.click();
  });
}

export function mimeFromName(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime" };
  return map[ext] ?? "application/octet-stream";
}

export function MediaStrip({
  refs,
  onChange,
  pickerOpen,
  onPickerOpenChange,
  max = 10,
}: {
  refs: MediaRef[];
  onChange: (refs: MediaRef[]) => void;
  pickerOpen?: boolean;
  onPickerOpenChange?: (open: boolean) => void;
  max?: number;
}) {
  const media = useSocialStore((s) => s.media);
  const addMedia = useSocialStore((s) => s.addMedia);
  const toast = useSocialStore((s) => s.toast);
  const [busy, setBusy] = useState(false);
  const [altFor, setAltFor] = useState<string | null>(null);
  const altInput = useRef<HTMLInputElement>(null);

  const attach = (ids: string[]) => {
    const existing = new Set(refs.map((r) => r.id));
    const next = [...refs, ...ids.filter((id) => !existing.has(id)).map((id) => ({ id }))].slice(0, max);
    onChange(next);
  };

  const addFiles = async () => {
    try {
      setBusy(true);
      const files = await pickFiles();
      const ids: string[] = [];
      for (const f of files) ids.push((await addMedia(f)).id);
      attach(ids);
      onPickerOpenChange?.(false);
    } catch (err) {
      logError("social", "add media", err);
      toast({ kind: "error", title: "Could not add that file", body: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const items = refs.map((r) => ({ ref: r, item: media.find((m) => m.id === r.id) })).filter((x) => x.item);
  const library = [...media].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="sc-media-strip">
      {items.map(({ ref, item }) => (
        <Popover
          key={ref.id}
          open={altFor === ref.id}
          onOpenChange={(o) => setAltFor(o ? ref.id : null)}
          className="w-[260px] p-3"
          trigger={
            <div className="sc-media-thumb" role="button" tabIndex={0} title="Alt text">
              <Thumb item={item!} badge />
              <button
                className="x"
                aria-label="Remove"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(refs.filter((r) => r.id !== ref.id));
                }}
              >
                <X />
              </button>
            </div>
          }
        >
          <div className="sc-label">Alt text</div>
          <input
            ref={altInput}
            className="sc-field"
            defaultValue={ref.alt ?? item!.alt ?? ""}
            placeholder="Describe the image for people who can't see it"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                onChange(refs.map((r) => (r.id === ref.id ? { ...r, alt: (e.target as HTMLInputElement).value } : r)));
                setAltFor(null);
              }
            }}
          />
          <div className="mt-2 flex justify-end gap-2">
            <button
              className="sc-btn sm primary"
              onClick={() => {
                onChange(refs.map((r) => (r.id === ref.id ? { ...r, alt: altInput.current?.value ?? "" } : r)));
                setAltFor(null);
              }}
            >
              Save
            </button>
          </div>
        </Popover>
      ))}
      {refs.length < max ? (
        <Popover
          open={pickerOpen}
          onOpenChange={onPickerOpenChange}
          className="w-[360px]"
          trigger={
            <button className="sc-media-thumb add" aria-label="Add media">
              {busy ? <Loader2 className="animate-spin" /> : <Plus />}
            </button>
          }
        >
          <div className="flex items-center gap-2 border-b border-line px-3 py-2">
            <span className="text-[12px] font-semibold">Library</span>
            <button className="sc-btn sm ml-auto" onClick={() => void addFiles()} disabled={busy}>
              <FolderOpen /> Choose file…
            </button>
          </div>
          {library.length === 0 ? (
            <div className="px-4 py-6 text-center text-[12px] text-muted">
              Nothing in the library yet. Choose a file, or drop / paste an image into the composer.
            </div>
          ) : (
            <div className="grid max-h-[280px] grid-cols-4 gap-1.5 overflow-auto p-2 sc-scroll">
              {library.map((m) => {
                const attached = refs.some((r) => r.id === m.id);
                return (
                  <button
                    key={m.id}
                    className={`sc-media-thumb !h-[76px] !w-full ${attached ? "opacity-40" : ""}`}
                    title={m.name}
                    disabled={attached}
                    onClick={() => {
                      attach([m.id]);
                      onPickerOpenChange?.(false);
                    }}
                  >
                    <Thumb item={m} badge />
                  </button>
                );
              })}
            </div>
          )}
          <div className="border-t border-line px-3 py-2 text-[11px] text-muted">Tip: paste a screenshot or drop files anywhere in this window.</div>
        </Popover>
      ) : null}
    </div>
  );
}
