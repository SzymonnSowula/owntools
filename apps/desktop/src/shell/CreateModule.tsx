import { useEffect } from "react";
import { Home } from "@feature-editor/components/Home";
import { Editor } from "@feature-editor/components/Editor";
import { useAppStore } from "@feature-editor/store/appStore";

export default function CreateModule() {
  const view = useAppStore((s) => s.view);
  const toast = useAppStore((s) => s.toast);
  const clearToast = useAppStore((s) => s.clearToast);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(clearToast, 3200);
    return () => window.clearTimeout(id);
  }, [toast, clearToast]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-paper">
      {view === "editor" ? <Editor /> : <Home />}
      {toast ? (
        <div
          className={`pointer-events-none absolute bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-[12px] px-4 py-2 text-sm font-medium shadow-lg ${
            toast.type === "error" ? "bg-coral text-white" : "bg-ink text-white"
          }`}
        >
          {toast.message}
        </div>
      ) : null}
    </div>
  );
}
