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
      /* plugin niedostępny w przeglądarce */
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
          <p className="kicker">Preferencje</p>
          <h1 className="page-title">Ustawienia</h1>
        </div>
      </header>

      <div className="stack">
        <section className="card stack">
          <div className="spread">
            <div>
              <strong>Motyw</strong>
              <div className="muted" style={{ fontSize: 12 }}>
                Jasny stalowy albo głębki charcoal
              </div>
            </div>
            <div className="row">
              <button className={`pill${settings.theme === "light" ? " active" : ""}`} onClick={() => update({ theme: "light" })}>
                Jasny
              </button>
              <button className={`pill${settings.theme === "dark" ? " active" : ""}`} onClick={() => update({ theme: "dark" })}>
                Ciemny
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
            <span>Przerwa (min)</span>
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
            <span>Cel heatmapy (min aktywnego czasu / dzień)</span>
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
            Powiadomienia po sesji
          </label>
          <label className="row">
            <input
              type="checkbox"
              checked={settings.usageTracking}
              onChange={(e) => useAppStore.getState().setUsageTracking(e.target.checked)}
            />
            Śledź czas w aplikacjach i na stronach
          </label>
          <label className="row">
            <input
              type="checkbox"
              checked={settings.contributeOnTaskComplete}
              onChange={(e) => update({ contributeOnTaskComplete: e.target.checked })}
            />
            Drobny ręczny wpis na heatmapie po ukończeniu zadania
          </label>
          <label className="row">
            <input
              type="checkbox"
              checked={settings.autostart}
              onChange={(e) => void toggleAutostart(e.target.checked)}
            />
            Uruchamiaj z systemem (Windows)
          </label>
          <div className="spread">
            <div>
              <strong>Język dyktowania</strong>
              <div className="muted" style={{ fontSize: 12 }}>
                Web Speech API, bez chmury po naszej stronie. Wymaga pakietu językowego Windows.
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
            Autostart wymaga wtyczki Tauri. W podglądzie przeglądarki opcja jest tylko zapamiętywana lokalnie.
            Język interfejsu: polski.
          </p>
        </section>

        <ScrollGuardSettings />

        <section className="card">
          <p className="muted" style={{ marginTop: 0 }}>
            Zamknięcie okna ukrywa aplikację w zasobniku. Aby wyjść całkowicie, użyj menu ikony albo przycisku poniżej.
          </p>
          <button className="btn" onClick={() => void quit()}>
            Wyjdź
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
        <strong>Blokada scrolla</strong>
        <p className="muted" style={{ margin: "6px 0 0", fontSize: 12 }}>
          Na wybranych stronach kółko myszy, touchpad i Page Down nie działają, dopóki nie odhaczysz
          konkretnego zadania. Czytać i klikać nadal można.
        </p>
      </div>
      <label className="row">
        <input
          type="checkbox"
          checked={settings.scrollGuardEnabled}
          onChange={(e) => setGuard({ enabled: e.target.checked })}
        />
        Włącz blokadę, aż zadanie będzie zrobione
      </label>
      <label className="field">
        <span>Zadanie-klucz</span>
        <select
          className="select"
          value={settings.scrollGuardTaskId ?? ""}
          onChange={(e) => setGuard({ taskId: e.target.value || null })}
        >
          <option value="">— wybierz zadanie —</option>
          {open.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Strony (jedna na linię)</span>
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
        Domyślnie: x.com, twitter.com, tiktok.com, instagram.com. Działa w aplikacji desktopowej, nie w
        podglądzie przeglądarki. Po odhaczeniu zadania blokada sama spada.
      </p>
    </section>
  );
}
