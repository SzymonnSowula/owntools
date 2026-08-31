import { isTauri } from "../../lib/env";
import { parseSiteList, siteListText } from "../../lib/scrollGuard";
import { useAppStore } from "../../store/useAppStore";

export function SettingsView() {
  const settings = useAppStore((s) => s.settings);
  const update = useAppStore((s) => s.updateSettings);
  const timer = useAppStore((s) => s.timer);
  const setCustomMinutes = useAppStore((s) => s.setCustomMinutes);

  const toggleAutostart = async (on: boolean) => {
    update({ autostart: on });
    if (!isTauri()) return;
    try {
      const a = await import("@tauri-apps/plugin-autostart");
      if (on) await a.enable();
      else await a.disable();
    } catch {
      /* plugin unavailable in the browser */
    }
  };

  const quit = async () => {
    if (!isTauri()) return;
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("quit_app");
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="kicker">Preferences</p>
          <h1 className="page-title">Settings</h1>
        </div>
      </header>

      <div className="stack">
        <section className="card stack">
          <div className="spread">
            <div>
              <strong>Theme</strong>
              <div className="muted" style={{ fontSize: 12 }}>
                Light steel or deep charcoal
              </div>
            </div>
            <div className="row">
              <button className={`pill${settings.theme === "light" ? " active" : ""}`} onClick={() => update({ theme: "light" })}>
                Light
              </button>
              <button className={`pill${settings.theme === "dark" ? " active" : ""}`} onClick={() => update({ theme: "dark" })}>
                Dark
              </button>
            </div>
          </div>
        </section>

        <section className="card" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <label className="field">
            <span>Focus (min)</span>
            <input
              className="input"
              type="number"
              min={1}
              max={180}
              value={settings.pomodoroFocus}
              onChange={(e) => {
                const n = Number(e.target.value);
                update({ pomodoroFocus: n });
                if (timer.preset === "custom") setCustomMinutes(n);
              }}
            />
          </label>
          <label className="field">
            <span>Break (min)</span>
            <input
              className="input"
              type="number"
              min={1}
              max={60}
              value={settings.pomodoroBreak}
              onChange={(e) => update({ pomodoroBreak: Number(e.target.value) })}
            />
          </label>
          <label className="field">
            <span>Heatmap goal (min of active time / day)</span>
            <input
              className="input"
              type="number"
              min={10}
              max={480}
              value={settings.heatmapGoalMinutes}
              onChange={(e) => update({ heatmapGoalMinutes: Number(e.target.value) })}
            />
          </label>
        </section>

        <section className="card stack">
          <label className="row">
            <input
              type="checkbox"
              checked={settings.notifications}
              onChange={(e) => update({ notifications: e.target.checked })}
            />
            Notifications after a session
          </label>
          <label className="row">
            <input
              type="checkbox"
              checked={settings.timerFullscreen}
              onChange={(e) => update({ timerFullscreen: e.target.checked })}
            />
            Timer takes over the whole screen (Esc leaves anytime)
          </label>
          <label className="row">
            <input
              type="checkbox"
              checked={settings.usageTracking}
              onChange={(e) => useAppStore.getState().setUsageTracking(e.target.checked)}
            />
            Track time in apps and on websites
          </label>
          <label className="row">
            <input
              type="checkbox"
              checked={settings.contributeOnTaskComplete}
              onChange={(e) => update({ contributeOnTaskComplete: e.target.checked })}
            />
            Small manual heatmap entry when a task is completed
          </label>
          <label className="row">
            <input
              type="checkbox"
              checked={settings.autostart}
              onChange={(e) => void toggleAutostart(e.target.checked)}
            />
            Start with the system (Windows)
          </label>
          <div className="spread">
            <div>
              <strong>Dictation language</strong>
              <div className="muted" style={{ fontSize: 12 }}>
                Web Speech API, no cloud on our side. Requires a Windows language pack.
              </div>
            </div>
            <div className="row">
              <button
                className={`pill${settings.speechLang === "pl-PL" ? " active" : ""}`}
                onClick={() => update({ speechLang: "pl-PL" })}
              >
                pl-PL
              </button>
              <button
                className={`pill${settings.speechLang === "en-US" ? " active" : ""}`}
                onClick={() => update({ speechLang: "en-US" })}
              >
                en-US
              </button>
            </div>
          </div>
          <p className="faint" style={{ fontSize: 12, margin: 0 }}>
            Autostart requires the Tauri plugin. In the browser preview the option is only remembered locally.
          </p>
        </section>

        <ScrollGuardSettings />

        <section className="card">
          <p className="muted" style={{ marginTop: 0 }}>
            Closing the window hides the app in the tray. To quit completely, use the tray icon menu or the button below.
          </p>
          <button className="btn" onClick={() => void quit()}>
            Quit
          </button>
        </section>
      </div>
    </div>
  );
}

function ScrollGuardSettings() {
  const settings = useAppStore((s) => s.settings);
  const tasks = useAppStore((s) => s.tasks);
  const setGuard = useAppStore((s) => s.setScrollGuard);
  const open = tasks.filter(
    (t) => !t.done || t.id === settings.scrollGuardTaskId,
  );

  return (
    <section className="card stack">
      <div>
        <strong>Scroll guard</strong>
        <p className="muted" style={{ margin: "6px 0 0", fontSize: 12 }}>
          On the selected sites the mouse wheel, touchpad, and Page Down stop working until you check off
          a specific task. You can still read and click.
        </p>
      </div>
      <label className="row">
        <input
          type="checkbox"
          checked={settings.scrollGuardEnabled}
          onChange={(e) => setGuard({ enabled: e.target.checked })}
        />
        Enable the guard until the task is done
      </label>
      <label className="field">
        <span>Key task</span>
        <select
          className="select"
          value={settings.scrollGuardTaskId ?? ""}
          onChange={(e) => setGuard({ taskId: e.target.value || null })}
        >
          <option value="">— choose a task —</option>
          {open.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Sites (one per line)</span>
        <textarea
          className="textarea"
          defaultValue={siteListText(settings.scrollGuardSites)}
          onBlur={(e) => {
            const sites = parseSiteList(e.target.value);
            setGuard({ sites: sites.length ? sites : settings.scrollGuardSites });
          }}
        />
      </label>
      <p className="faint" style={{ fontSize: 12, margin: 0 }}>
        Defaults: x.com, twitter.com, tiktok.com, instagram.com. Works in the desktop app, not in the
        browser preview. Once the task is checked off, the guard lifts on its own.
      </p>
    </section>
  );
}
