import { openSettings } from "@core/navigation";
import { siteLabel } from "../lib/scrollGuard";
import { useAppStore } from "../store/useAppStore";

/** "X, Y and 3 more" from the blocked sites, so the banner names what is actually on the list. */
function sitesPhrase(sites: string[]): string {
  const names = sites.map(siteLabel);
  if (names.length <= 1) return names[0] ?? "";
  if (names.length <= 3) return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}

export function ScrollGuardBanner() {
  const settings = useAppStore((s) => s.settings);
  const tasks = useAppStore((s) => s.tasks);
  const now = useAppStore((s) => s.usageNow);
  const toggleTask = useAppStore((s) => s.toggleTask);
  const task = tasks.find((t) => t.id === settings.scrollGuardTaskId);
  const sites = settings.scrollGuardSites;
  const armed = settings.scrollGuardEnabled && !!task && !task.done && sites.length > 0;
  if (!armed) return null;

  return (
    <div className={`guard-banner${now?.scrollLocked ? " on" : ""}`}>
      {now?.scrollLocked ? (
        <>
          <span>
            Scrolling on <strong>{now.site ?? "this site"}</strong> is paused until this is done: {task?.title}
          </span>
          <button className="btn small" onClick={() => task && toggleTask(task.id)}>
            Done
          </button>
        </>
      ) : (
        <>
          <span>
            {sitesPhrase(sites)} won&apos;t scroll until <strong>{task?.title}</strong> is done.
          </span>
          <button className="btn small ghost" onClick={() => openSettings("scroll-guard")}>
            Settings
          </button>
        </>
      )}
    </div>
  );
}
