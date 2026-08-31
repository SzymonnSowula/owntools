import { useAppStore } from "../store/useAppStore";

export function ScrollGuardBanner() {
  const settings = useAppStore((s) => s.settings);
  const tasks = useAppStore((s) => s.tasks);
  const now = useAppStore((s) => s.usageNow);
  const setView = useAppStore((s) => s.setView);
  const toggleTask = useAppStore((s) => s.toggleTask);
  const task = tasks.find((t) => t.id === settings.scrollGuardTaskId);
  const armed = settings.scrollGuardEnabled && !!task && !task.done;
  if (!armed) return null;

  return (
    <div className={`guard-banner${now?.scrollLocked ? " on" : ""}`}>
      {now?.scrollLocked ? (
        <>
          <span>
            Scroll na <strong>{now.site ?? "tej stronie"}</strong> wstrzymany — najpierw: {task?.title}
          </span>
          <button className="btn small" onClick={() => task && toggleTask(task.id)}>
            Zrobione
          </button>
        </>
      ) : (
        <>
          <span>
            Blokada scrolla czeka na {task?.title}. x.com / TikTok / Instagram bez kółka, dopóki to nie spadnie z listy.
          </span>
          <button className="btn small ghost" onClick={() => setView("settings")}>
            Ustawienia
          </button>
        </>
      )}
    </div>
  );
}
