import { useRef, useState, type DragEvent } from "react";
import { formatBytes } from "../lib/save";

export interface FilePickerProps {
  files: File[];
  onChange: (files: File[]) => void;
  /** `<input accept>` string. */
  accept: string;
  multiple?: boolean;
  disabled?: boolean;
  /** Shown while nothing is picked: "…or drop a PDF here". */
  hint: string;
  /** Files that fail this are ignored on drop or pick. */
  filter?: (file: File) => boolean;
  /** Show ▲ ▼ on the rows (multiple only). */
  reorder?: boolean;
}

/**
 * The drop zone every file tool uses. One file: a single row with the name
 * and size. Many files: an "Add files" row plus a list with remove and
 * optional reorder. Drops work natively because the main window runs with
 * Tauri's own drag-drop handler off (see App.tsx).
 */
export function FilePicker({ files, onChange, accept, multiple, disabled, hint, filter, reorder }: FilePickerProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);

  function take(list: FileList | null | undefined) {
    if (!list) return;
    const picked = Array.from(list).filter((f) => (filter ? filter(f) : true));
    if (!picked.length) return;
    onChange(multiple ? [...files, ...picked] : [picked[0]]);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    take(e.dataTransfer.files);
  }

  function move(index: number, delta: number) {
    const next = [...files];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  const single = !multiple ? files[0] : undefined;

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={inputRef}
        className="sr-only"
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        onChange={(e) => {
          take(e.target.files);
          e.target.value = "";
        }}
      />
      <div
        className={`flex items-center gap-3 rounded-[14px] border border-dashed px-3 py-3 transition ${
          dragging ? "border-accent bg-accent/10" : "border-line bg-paper"
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <button
          type="button"
          className="btn btn-secondary shrink-0 px-3 py-1.5 text-xs"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          {multiple ? (files.length ? "Add more" : "Choose files") : single ? "Change file" : "Choose file"}
        </button>
        <div className="min-w-0 flex-1 text-xs">
          {single ? (
            <>
              <p className="truncate font-medium text-ink">{single.name}</p>
              <p className="text-muted">{formatBytes(single.size)}</p>
            </>
          ) : multiple && files.length ? (
            <p className="text-muted">
              {files.length} file{files.length === 1 ? "" : "s"} · {formatBytes(files.reduce((n, f) => n + f.size, 0))}
            </p>
          ) : (
            <p className="text-muted">{hint}</p>
          )}
        </div>
        {files.length && !disabled ? (
          <button type="button" className="btn btn-ghost shrink-0 px-2 py-1 text-xs" onClick={() => onChange([])}>
            Clear
          </button>
        ) : null}
      </div>

      {multiple && files.length ? (
        <ul className="max-h-40 overflow-y-auto rounded-[12px] border border-line bg-paper text-xs">
          {files.map((file, i) => (
            <li
              key={`${file.name}-${file.size}-${i}`}
              className="flex items-center gap-2 border-b border-line px-3 py-1.5 last:border-b-0"
            >
              <span className="w-5 shrink-0 text-muted">{i + 1}.</span>
              <span className="min-w-0 flex-1 truncate text-ink" title={file.name}>
                {file.name}
              </span>
              <span className="shrink-0 text-muted">{formatBytes(file.size)}</span>
              {reorder ? (
                <>
                  <button
                    type="button"
                    className="btn btn-ghost shrink-0 px-1.5 py-0.5"
                    disabled={disabled || i === 0}
                    aria-label="Move up"
                    onClick={() => move(i, -1)}
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost shrink-0 px-1.5 py-0.5"
                    disabled={disabled || i === files.length - 1}
                    aria-label="Move down"
                    onClick={() => move(i, 1)}
                  >
                    ▼
                  </button>
                </>
              ) : null}
              <button
                type="button"
                className="btn btn-ghost shrink-0 px-1.5 py-0.5"
                disabled={disabled}
                aria-label="Remove"
                onClick={() => onChange(files.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
