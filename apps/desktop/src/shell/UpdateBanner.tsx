import { useEffect, useState } from "react";
import { logError } from "@core/errors";
import { checkForUpdate, type AvailableUpdate } from "./updater";

/**
 * A small pill in the corner when a newer signed build is available. The
 * updater itself is the Tauri plugin; this is only the "yes, now" button.
 */
export function UpdateBanner() {
  const [update, setUpdate] = useState<AvailableUpdate | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    // A little after startup so it never competes with the first paint.
    const timer = window.setTimeout(() => {
      void checkForUpdate().then((found) => {
        if (alive && found) setUpdate(found);
      });
    }, 4000);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, []);

  if (!update || dismissed) return null;

  const install = async () => {
    setFailed(false);
    setProgress(0);
    try {
      await update.install(setProgress);
    } catch (err) {
      logError("main", "update install failed", err);
      setFailed(true);
      setProgress(null);
    }
  };

  return (
    <div className="update-banner" role="status">
      <span className="update-dot" aria-hidden />
      {progress === null ? (
        <>
          <span>
            owntools {update.version} is ready
            {failed ? " — the update failed, try again" : ""}
          </span>
          <button className="update-btn primary" onClick={() => void install()}>
            Install &amp; restart
          </button>
          <button className="update-btn" onClick={() => setDismissed(true)}>
            Later
          </button>
        </>
      ) : (
        <span>
          {progress < 1
            ? `Downloading… ${Math.round(progress * 100)}%`
            : "Installing… the app will restart"}
        </span>
      )}
    </div>
  );
}
