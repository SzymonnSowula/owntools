import { useEffect, useRef, useState } from "react";
import {
  BUILT_IN_PRESETS,
  deleteCustomPreset,
  extractLook,
  loadCustomPresets,
  saveCustomPreset,
  type LookPreset,
} from "../lib/presets";
import { useAppStore } from "../store/appStore";

/**
 * "Presets" in the toolbar: built-in looks, the user's saved looks, and a
 * one-field form to save the current one. Applying a preset is one undo step.
 */
export function PresetsMenu() {
  const project = useAppStore((s) => s.project);
  const applyLookPreset = useAppStore((s) => s.applyLookPreset);
  const showToast = useAppStore((s) => s.showToast);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [custom, setCustom] = useState<LookPreset[]>(() => loadCustomPresets());
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!project) return null;

  function apply(preset: LookPreset) {
    applyLookPreset(preset.look);
    setOpen(false);
    showToast(`Look: ${preset.name}`, "info");
  }

  function save() {
    if (!project) return;
    const preset = saveCustomPreset(name, extractLook(project));
    setCustom(loadCustomPresets());
    setName("");
    setSaving(false);
    showToast(`Saved "${preset.name}".`, "info");
  }

  return (
    <div ref={root} className="relative">
      <button className="btn btn-secondary h-8 px-2.5 text-xs" onClick={() => setOpen(!open)} title="Apply or save a look">
        <span aria-hidden>✦</span> Presets <span className="text-muted">▾</span>
      </button>
      {open ? (
        <div className="absolute left-0 top-9 z-40 w-64 rounded-[14px] border border-line bg-card p-2 shadow-[0_18px_50px_rgba(23,21,31,0.18)]">
          <p className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">Built in</p>
          <div className="grid grid-cols-2 gap-1">
            {BUILT_IN_PRESETS.map((p) => (
              <button key={p.id} className="rounded-[9px] border border-line px-2 py-1.5 text-left text-xs font-medium hover:border-teal hover:text-teal-2" onClick={() => apply(p)}>
                {p.name}
              </button>
            ))}
          </div>
          {custom.length ? (
            <>
              <p className="px-2 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">Yours</p>
              <div className="space-y-1">
                {custom.map((p) => (
                  <div key={p.id} className="flex items-center gap-1">
                    <button className="flex-1 truncate rounded-[9px] border border-line px-2 py-1.5 text-left text-xs font-medium hover:border-teal hover:text-teal-2" onClick={() => apply(p)}>
                      {p.name}
                    </button>
                    <button
                      className="btn btn-ghost !h-7 !w-7 !p-0 text-xs text-muted"
                      title="Delete preset"
                      onClick={() => {
                        deleteCustomPreset(p.id);
                        setCustom(loadCustomPresets());
                      }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </>
          ) : null}
          <div className="mt-2 border-t border-line pt-2">
            {saving ? (
              <div className="flex gap-1">
                <input
                  autoFocus
                  className="field !h-8 flex-1 !py-0 text-xs"
                  placeholder="Name this look"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") save();
                  }}
                />
                <button className="btn btn-primary !h-8 !px-3 !py-0 text-xs" onClick={save}>
                  Save
                </button>
              </div>
            ) : (
              <button className="btn btn-secondary w-full !py-1.5 text-xs" onClick={() => setSaving(true)}>
                Save current look…
              </button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
