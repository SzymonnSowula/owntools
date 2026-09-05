import { AlertTriangle, Check, ExternalLink, Info, X } from "lucide-react";
import { isTauri } from "@core/env";
import { useSocialStore } from "../store";

async function openExternal(url: string): Promise<void> {
  if (isTauri()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
    return;
  }
  window.open(url, "_blank", "noopener");
}

export function Toasts() {
  const toasts = useSocialStore((s) => s.toasts);
  const dismiss = useSocialStore((s) => s.dismissToast);
  if (toasts.length === 0) return null;
  return (
    <div className="sc-toasts sc-portal" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`sc-toast ${t.kind}`}>
          <span className="sc-toast-icon">
            {t.kind === "success" ? <Check /> : t.kind === "error" ? <AlertTriangle /> : <Info />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="sc-toast-title">{t.title}</div>
            {t.body ? <div className="sc-toast-body">{t.body}</div> : null}
            {t.url ? (
              <button className="sc-btn sm mt-2" onClick={() => void openExternal(t.url!)}>
                <ExternalLink /> Open post
              </button>
            ) : null}
          </div>
          <button className="sc-icon-btn -mr-1 -mt-1" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
            <X />
          </button>
        </div>
      ))}
    </div>
  );
}

export { openExternal };
