import { confirmDialog } from "@ui/Dialog";
import { Image as ImageIcon, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { logError } from "@core/errors";
import { useSocialStore } from "../store";
import { Thumb, mimeFromName } from "./composer/MediaStrip";
import { EmptyState } from "./primitives";
import { DesignMediaDialog } from "./DesignMedia";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function MediaPage() {
  const media = useSocialStore((s) => s.media);
  const posts = useSocialStore((s) => s.posts);
  const addMedia = useSocialStore((s) => s.addMedia);
  const removeMedia = useSocialStore((s) => s.removeMedia);
  const toast = useSocialStore((s) => s.toast);
  const [dropping, setDropping] = useState(false);
  const [design, setDesign] = useState(false);

  const usedBy = (id: string) => posts.filter((p) => p.content.media.some((m) => m.id === id) || Object.values(p.overrides).some((o) => o.media?.some((m) => m.id === id))).length;

  const importFiles = async (files: File[]) => {
    try {
      for (const f of files) {
        if (!(f.type.startsWith("image/") || f.type.startsWith("video/"))) continue;
        await addMedia({ bytes: new Uint8Array(await f.arrayBuffer()), name: f.name, mime: f.type || mimeFromName(f.name) });
      }
    } catch (err) {
      logError("social", "import media", err);
      toast({ kind: "error", title: "Import failed", body: err instanceof Error ? err.message : String(err) });
    }
  };

  const pick = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = "image/*,video/*";
    input.onchange = () => void importFiles(Array.from(input.files ?? []));
    input.click();
  };

  const items = [...media].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div
      className={`sc-main${dropping ? " sc-dropzone" : ""}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDropping(true);
        }
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDropping(false);
        void importFiles(Array.from(e.dataTransfer.files));
      }}
    >
      <div className="sc-toolbar">
        <div className="sc-toolbar-title">media</div>
        <span className="text-[12px] text-muted">{media.length} item{media.length === 1 ? "" : "s"} · drop files anywhere here</span>
        <div className="ml-auto flex gap-2">
          <button className="sc-btn" onClick={() => setDesign(true)}>
            Design media
          </button>
          <button className="sc-btn primary" onClick={pick}>
            <Plus /> Import
          </button>
        </div>
      </div>
      <div className="sc-content sc-desk sc-scroll">
        {items.length === 0 ? (
          <div className="grid h-full place-items-center p-6">
            <div className="sc-card max-w-[440px]">
              <EmptyState
                icon={<ImageIcon />}
                title="the library is empty"
                action={
                  <>
                    <button className="sc-btn primary" onClick={pick}>
                      <Plus /> Import files
                    </button>
                    <button className="sc-btn" onClick={() => setDesign(true)}>
                      Design an image
                    </button>
                  </>
                }
              >
                Images and videos you attach to posts land here, so the same file can be reused. Paste a screenshot into the composer and it shows up too.
              </EmptyState>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3 p-6">
            {items.map((m) => {
              const uses = usedBy(m.id);
              return (
                <div key={m.id} className="sc-card overflow-hidden">
                  <div className="aspect-square bg-paper">
                    <Thumb item={m} className="h-full w-full object-cover" />
                  </div>
                  <div className="flex items-center gap-2 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] font-semibold" title={m.name}>
                        {m.name}
                      </div>
                      <div className="text-[11px] text-muted">
                        {formatBytes(m.bytes)}
                        {m.width && m.height ? ` · ${m.width}×${m.height}` : ""}
                        {uses ? ` · ${uses} post${uses === 1 ? "" : "s"}` : ""}
                      </div>
                    </div>
                    <button
                      className="sc-icon-btn"
                      aria-label="Delete"
                      onClick={async () => {
                        if (
                          uses &&
                          !(await confirmDialog({ title: "Delete file", message: `This file is attached to ${uses} post${uses === 1 ? "" : "s"}. Delete it anyway?`, kind: "danger", okLabel: "Delete", cancelLabel: "Keep" }))
                        )
                          return;
                        void removeMedia(m.id);
                      }}
                    >
                      <Trash2 />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {design ? <DesignMediaDialog onClose={() => setDesign(false)} /> : null}
    </div>
  );
}
