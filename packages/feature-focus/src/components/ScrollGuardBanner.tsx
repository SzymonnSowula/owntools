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
            Scrolling on <strong>{now.site ?? "this site"}</strong> is paused — first: {task?.title}
          </span>
          <button className="btn small" onClick={() => task && toggleTask(task.id)}>
            Done
          </button>
        </>
      ) : (
        <>
          <span>
            Scroll-lock is waiting on {task?.title}. x.com / TikTok / Instagram won't scroll until it's off the list.
          </span>
          <button className="btn small ghost" onClick={() => setView("settings")}>
            Settings
          </button>
        </>
      )}
    </div>
  );
}
