import { confirmDialog } from "@ui/Dialog";
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { PRICING_URL, SUITE_NAME, SUPPORT_URL } from "@core/branding";

// App-wide cards from the other packages. Lazy: Settings is one focus view
// and these pull in the model catalogue, the sync engine and the network log.
const IntelligenceCard = lazy(() => import("@feature-llm/IntelligenceCard"));
const AutomationsCard = lazy(() => import("@feature-automations/AutomationsCard"));
const SyncCard = lazy(() => import("@feature-sync/SyncCard"));
const PrivacyCard = lazy(() => import("@feature-privacy/PrivacyCard"));
import { getDictationSettings } from "@feature-dictation/engine";
import {
  activateLicense,
  deactivateLicense,
  getLicense,
  maskLicenseKey,
  onLicenseChange,
} from "@licensing/license";
import { isTauri } from "../../lib/env";
import { exportFileName, saveTextAs, workspaceToMarkdown } from "../../lib/exportData";
import { openExternal } from "../../lib/links";
import {
  DEFAULT_SCROLL_SITES,
  normalizeSite,
  searchSites,
  siteLabel,
} from "../../lib/scrollGuard";
import { THEMES } from "../../lib/themes";
import { validateBackup } from "../../store/persist";
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
          <div>
            <strong>Theme</strong>
            <div className="muted" style={{ fontSize: 12 }}>
              Applies everywhere — hub, focus, screeni, launch.
            </div>
          </div>
          <div className="theme-grid">
            {THEMES.map((t) => (
              <button
                key={t.id}
                className={`theme-card${settings.theme === t.id ? " active" : ""}`}
                aria-pressed={settings.theme === t.id}
                onClick={() => update({ theme: t.id })}
              >
                <span className="theme-swatch" aria-hidden>
                  {t.swatch.map((c, i) => (
                    <span key={i} style={{ background: c }} />
                  ))}
                </span>
                <span className="theme-card-name">{t.label}</span>
                <span className="theme-card-hint">{t.hint}</span>
              </button>
            ))}
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
          <div>
            <label className="row">
              <input
                type="checkbox"
                checked={settings.usageTracking}
                onChange={(e) => useAppStore.getState().setUsageTracking(e.target.checked)}
              />
              Track time in apps and on websites
            </label>
            <div className="muted" style={{ fontSize: 12, marginTop: 4, marginLeft: 24 }}>
              Reads the title of the active window (and the site for browsers) every 2 seconds.
              Stays on this device. Off means nothing is read.
            </div>
          </div>
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
          <p className="faint" style={{ fontSize: 12, margin: 0 }}>
            Autostart requires the Tauri plugin. In the browser preview the option is only remembered locally.
          </p>
        </section>

        <Suspense fallback={null}>
          <IntelligenceCard />
        </Suspense>
        <ScrollGuardSettings />
        <Suspense fallback={null}>
          <AutomationsCard />
          <SyncCard />
          <PrivacyCard />
        </Suspense>

        <ExportSettings />

        <LicenseSettings />

        <SupportSettings />

        <WindowSettings />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Data & export (+ restore)                                            */
/* ------------------------------------------------------------------ */

const RESTORE_QUESTION =
  "This replaces everything in the current workspace with the backup. Continue?";

function ExportSettings() {
  const workspaces = useAppStore((s) => s.workspaces);
  const workspaceId = useAppStore((s) => s.workspaceId);
  const [msg, setMsg] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const doExport = async (kind: "md" | "json") => {
    const s = useAppStore.getState();
    const data = s.exportWorkspaceData();
    const name = workspaces.find((w) => w.id === workspaceId)?.name ?? "workspace";
    const content =
      kind === "md" ? workspaceToMarkdown(data, name) : JSON.stringify(data, null, 2);
    const ok = await saveTextAs(
      exportFileName(name, kind),
      content,
      kind === "md" ? "text/markdown" : "application/json",
    );
    setMsg(ok ? `Exported ${kind === "md" ? "Markdown" : "JSON backup"}.` : "Export cancelled.");
  };

  const confirmReplace = (): Promise<boolean> =>
    confirmDialog({ title: "Restore backup", message: RESTORE_QUESTION, kind: "warning", okLabel: "Restore" });

  // Shared tail of both pickers: parse → validate → confirm → replace → save.
  const restoreFromText = async (text: string) => {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      setMsg("That file isn't valid JSON.");
      return;
    }
    if (!validateBackup(raw)) {
      setMsg(`That file doesn't look like a ${SUITE_NAME} backup.`);
      return;
    }
    if (!(await confirmReplace())) {
      setMsg("Restore cancelled.");
      return;
    }
    setRestoring(true);
    try {
      await useAppStore.getState().importWorkspaceData(raw);
      setMsg("Backup restored — this workspace now matches the file.");
    } catch {
      setMsg("Couldn't restore that backup.");
    } finally {
      setRestoring(false);
    }
  };

  const restore = async () => {
    setMsg(null);
    if (!isTauri()) {
      fileRef.current?.click();
      return;
    }
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({
        filters: [{ name: "JSON", extensions: ["json"] }],
        multiple: false,
      });
      if (typeof picked !== "string") {
        setMsg("Restore cancelled.");
        return;
      }
      const { readTextFile } = await import("@tauri-apps/plugin-fs");
      await restoreFromText(await readTextFile(picked));
    } catch {
      setMsg("Couldn't read that file.");
    }
  };

  const onBrowserFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      await restoreFromText(await file.text());
    } catch {
      setMsg("Couldn't read that file.");
    }
  };

  return (
    <section className="card stack">
      <div>
        <strong>Data & export</strong>
        <p className="muted" style={{ margin: "6px 0 0", fontSize: 12 }}>
          This workspace as plain files: Markdown reads well for you (and any AI agent), JSON is a
          full backup you can restore later. Nothing leaves your device.
        </p>
      </div>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <button className="btn" onClick={() => void doExport("md")}>
          Export Markdown
        </button>
        <button className="btn" onClick={() => void doExport("json")}>
          Backup JSON
        </button>
        <button className="btn ghost" disabled={restoring} onClick={() => void restore()}>
          {restoring ? "Restoring…" : "Restore JSON backup"}
        </button>
        {msg ? (
          <span className="faint" style={{ fontSize: 12 }}>
            {msg}
          </span>
        ) : null}
      </div>
      <p className="faint" style={{ fontSize: 12, margin: 0 }}>
        Restoring replaces this workspace with the file — take a fresh backup first if in doubt.
      </p>
      {!isTauri() ? (
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          style={{ display: "none" }}
          onChange={(e) => void onBrowserFile(e)}
        />
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* License                                                              */
/* ------------------------------------------------------------------ */

function useLicenseKey(): string | null {
  const [key, setKey] = useState<string | null>(() => getLicense());
  useEffect(() => {
    // The store load may have finished between the first render and this
    // subscription — re-read once so nothing is missed.
    setKey(getLicense());
    return onLicenseChange(() => setKey(getLicense()));
  }, []);
  return key;
}

function LicenseSettings() {
  const key = useLicenseKey();
  const [input, setInput] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const activate = async () => {
    if (!input.trim() || busy) return;
    setBusy(true);
    try {
      const ok = await activateLicense(input);
      if (ok) {
        setInput("");
        setMsg("License active. Thanks for the support!");
      } else {
        setMsg("That key doesn't check out — it looks like SCRN-XXXXX-XXXXX-XXXXX.");
      }
    } finally {
      setBusy(false);
    }
  };

  const deactivate = async () => {
    setBusy(true);
    try {
      await deactivateLicense();
      setShow(false);
      setMsg("License removed from this device. The key still works elsewhere.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card stack">
      <div className="spread">
        <div>
          <strong>License</strong>
          <p className="muted" style={{ margin: "6px 0 0", fontSize: 12 }}>
            one payment · offline key · no account · removes the badge from exported videos
          </p>
        </div>
        <span className={`pill${key ? " active" : ""}`}>{key ? "Pro" : "Free"}</span>
      </div>

      {key ? (
        <>
          <div className="row">
            <code style={{ fontSize: 13, letterSpacing: "0.04em" }}>
              {show ? key : maskLicenseKey(key)}
            </code>
            <button className="btn small ghost" onClick={() => setShow((v) => !v)}>
              {show ? "hide" : "show"}
            </button>
          </div>
          <div className="row" style={{ flexWrap: "wrap" }}>
            <button className="btn small" disabled={busy} onClick={() => void deactivate()}>
              Deactivate
            </button>
            {msg ? (
              <span className="faint" style={{ fontSize: 12 }}>
                {msg}
              </span>
            ) : null}
          </div>
        </>
      ) : (
        <>
          <div className="row" style={{ flexWrap: "wrap" }}>
            <input
              className="input"
              style={{ maxWidth: 260, fontFamily: "ui-monospace, monospace" }}
              placeholder="SCRN-XXXXX-XXXXX-XXXXX"
              value={input}
              spellCheck={false}
              autoCapitalize="characters"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void activate();
              }}
            />
            <button className="btn" disabled={busy || !input.trim()} onClick={() => void activate()}>
              {busy ? "Checking…" : "Activate"}
            </button>
            <button className="btn ghost" onClick={() => void openExternal(PRICING_URL)}>
              Get Pro
            </button>
          </div>
          {msg ? (
            <span className="faint" style={{ fontSize: 12 }}>
              {msg}
            </span>
          ) : null}
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Support                                                              */
/* ------------------------------------------------------------------ */

/** Mirror of the Rust `Diagnostics` struct (serde camelCase). */
interface Diagnostics {
  version: string;
  os: string;
  arch: string;
  webview: string;
  logPath: string;
  appDataDir: string;
  hotkey: string;
  hotkeyRegistered: boolean;
  whisper: { engine: boolean; model: boolean; dir: string; models?: string[] };
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* clipboard blocked — try the legacy path */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** Facts about the install + a settings summary. Never any notes/tasks text. */
function diagnosticsReport(d: Diagnostics, log: string): string {
  const s = useAppStore.getState();
  const st = s.settings;
  const dictation = getDictationSettings();
  const models = d.whisper.models ?? [];
  return [
    `${SUITE_NAME} ${d.version} — diagnostics ${new Date().toISOString()}`,
    `os: ${d.os}/${d.arch} · webview: ${d.webview}`,
    `hotkey: ${d.hotkey} (${d.hotkeyRegistered ? "registered" : "NOT registered"})`,
    `whisper: engine ${d.whisper.engine ? "ok" : "missing"} · model ${d.whisper.model ? "ok" : "missing"} · installed: ${models.join(", ") || "none"}`,
    `dictation: lang ${dictation.lang} · model ${dictation.model || "(best installed)"} · quality ${dictation.quality}`,
    `log: ${d.logPath}`,
    `app data: ${d.appDataDir}`,
    "",
    "focus settings (no notes or tasks content):",
    `  theme ${st.theme} · timer ${st.pomodoroFocus}/${st.pomodoroBreak} min · fullscreen ${st.timerFullscreen}`,
    `  notifications ${st.notifications} · autostart ${st.autostart} · close to tray ${st.closeToTray}`,
    `  usage tracking ${st.usageTracking} · scroll guard ${st.scrollGuardEnabled} (${st.scrollGuardSites.length} sites, task ${st.scrollGuardTaskId ? "set" : "none"})`,
    `  workspaces ${s.workspaces.length} · tasks ${s.tasks.length} · notes ${s.notes.length} · pages ${s.notebook.pages.length} · habits ${s.habits.length} · heatmap days ${Object.keys(s.heatmap).length}`,
    `  timer: ${s.timer.preset} · ${s.timer.mode} · running ${s.timer.running}`,
    "",
    "log tail (last 200 lines):",
    log || "(empty)",
  ].join("\n");
}

function SupportSettings() {
  const native = isTauri();
  const [info, setInfo] = useState<Diagnostics | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!native) return;
    let cancelled = false;
    void (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const d = await invoke<Diagnostics>("diagnostics_info");
        if (!cancelled) setInfo(d);
      } catch {
        /* older backend without the command */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [native]);

  const copyDiagnostics = async () => {
    setMsg(null);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const d = info ?? (await invoke<Diagnostics>("diagnostics_info"));
      let log = "";
      try {
        log = await invoke<string>("read_log_tail", { lines: 200 });
      } catch {
        log = "(log unavailable)";
      }
      const ok = await copyText(diagnosticsReport(d, log));
      setMsg(
        ok
          ? "Diagnostics copied — paste them into your report."
          : "Couldn't copy. Open the log folder instead.",
      );
    } catch {
      setMsg("Diagnostics unavailable.");
    }
  };

  const openLogFolder = async () => {
    if (!info) return;
    setMsg(null);
    try {
      const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
      try {
        await revealItemInDir(info.logPath);
      } catch {
        // Nothing logged yet — show the folder itself.
        await revealItemInDir(info.logPath.replace(/[\\/][^\\/]*$/, ""));
      }
    } catch {
      setMsg("Couldn't open the log folder.");
    }
  };

  return (
    <section className="card stack">
      <div>
        <strong>Support</strong>
        <p className="muted" style={{ margin: "6px 0 0", fontSize: 12 }}>
          {native
            ? info
              ? `${SUITE_NAME} ${info.version} · ${info.os}/${info.arch} · WebView2 ${info.webview}`
              : `${SUITE_NAME} · reading version…`
            : "Available in the desktop app."}
        </p>
        {info ? (
          <p className="faint" style={{ margin: "4px 0 0", fontSize: 11, wordBreak: "break-all" }}>
            Log: {info.logPath}
          </p>
        ) : null}
      </div>
      <div className="row" style={{ flexWrap: "wrap" }}>
        {native ? (
          <>
            <button className="btn" onClick={() => void copyDiagnostics()}>
              Copy diagnostics
            </button>
            <button className="btn ghost" disabled={!info} onClick={() => void openLogFolder()}>
              Open log folder
            </button>
          </>
        ) : null}
        <button className="btn small ghost" onClick={() => void openExternal(SUPPORT_URL)}>
          Report a problem
        </button>
        {msg ? (
          <span className="faint" style={{ fontSize: 12 }}>
            {msg}
          </span>
        ) : null}
      </div>
      {native ? (
        <p className="faint" style={{ fontSize: 12, margin: 0 }}>
          Diagnostics = version, machine facts, the last 200 log lines and a settings summary. No
          notes, tasks or pages are included.
        </p>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Window behaviour                                                     */
/* ------------------------------------------------------------------ */

function WindowSettings() {
  const closeToTray = useAppStore((s) => s.settings.closeToTray !== false);
  const update = useAppStore((s) => s.updateSettings);

  const quit = async () => {
    if (!isTauri()) return;
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("quit_app");
  };

  return (
    <section className="card stack">
      <div>
        <strong>Window</strong>
        <p className="muted" style={{ margin: "6px 0 0", fontSize: 12 }}>
          {closeToTray
            ? "Closing the window hides the app in the tray — the timer, the dictation hotkey and tracking keep running. To quit completely, use the tray icon menu or the button below."
            : "Closing the window quits the app. Nothing keeps running in the background — the dictation hotkey and tracking stop with it."}
        </p>
      </div>
      <label className="field" style={{ maxWidth: 320 }}>
        <span>When I close the window</span>
        <select
          className="select"
          value={closeToTray ? "tray" : "quit"}
          onChange={(e) => update({ closeToTray: e.target.value === "tray" })}
        >
          <option value="tray">keep running in the tray</option>
          <option value="quit">quit</option>
        </select>
      </label>
      <div>
        <button className="btn" onClick={() => void quit()}>
          Quit
        </button>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Scroll guard                                                         */
/* ------------------------------------------------------------------ */

function ScrollGuardSettings() {
  const settings = useAppStore((s) => s.settings);
  const tasks = useAppStore((s) => s.tasks);
  const setGuard = useAppStore((s) => s.setScrollGuard);
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const open = tasks.filter(
    (t) => !t.done || t.id === settings.scrollGuardTaskId,
  );

  const sites = settings.scrollGuardSites;
  const matches = useMemo(() => searchSites(query, sites), [query, sites]);
  // Anything with a dot can be blocked, catalogue or not — the search box is
  // also the "add your own" field.
  const custom = normalizeSite(query);
  const canAddCustom = Boolean(custom) && !sites.includes(custom!) && !matches.some((m) => m.host === custom);

  function add(host: string) {
    if (sites.includes(host)) return;
    setGuard({ sites: [...sites, host] });
    setQuery("");
    searchRef.current?.focus();
  }

  function remove(host: string) {
    setGuard({ sites: sites.filter((s) => s !== host) });
  }

  return (
    <section className="card stack">
      <div>
        <strong>Scroll guard</strong>
        <p className="muted" style={{ margin: "6px 0 0", fontSize: 12 }}>
          On the blocked sites the mouse wheel, touchpad, and Page Down stop working until you check
          off a specific task. You can still read and click.
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

      <div className="field">
        <span>Blocked sites</span>
        <div className="guard-search">
          <input
            ref={searchRef}
            className="input"
            placeholder="Search or type a domain…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setFocused(true)}
            /* A click on a result would blur first and unmount it. */
            onBlur={() => window.setTimeout(() => setFocused(false), 120)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              const first = matches[0]?.host ?? custom;
              if (first) add(first);
            }}
          />
          {focused && (matches.length > 0 || canAddCustom) ? (
            <div className="guard-results">
              {canAddCustom ? (
                <button className="guard-result" onMouseDown={() => add(custom!)}>
                  <span className="guard-result-name">Block {custom}</span>
                  <span className="guard-result-group">custom</span>
                </button>
              ) : null}
              {matches.map((m) => (
                <button key={m.host} className="guard-result" onMouseDown={() => add(m.host)}>
                  <span className="guard-result-name">{m.label}</span>
                  <span className="guard-result-host">{m.host}</span>
                  <span className="guard-result-group">{m.group}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {sites.length ? (
        <div className="guard-list">
          {sites.map((host) => (
            <span key={host} className="guard-chip">
              <span className="guard-chip-name">{siteLabel(host)}</span>
              <span className="guard-chip-host">{host}</span>
              <button
                className="guard-chip-x"
                aria-label={`Unblock ${host}`}
                onClick={() => remove(host)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="faint" style={{ fontSize: 12, margin: 0 }}>
          Nothing blocked yet — the guard has no effect until you add a site.
        </p>
      )}

      <div className="row" style={{ gap: 10 }}>
        <button
          className="btn small"
          onClick={() => setGuard({ sites: DEFAULT_SCROLL_SITES })}
        >
          Reset to defaults
        </button>
        {sites.length ? (
          <button className="btn small ghost" onClick={() => setGuard({ sites: [] })}>
            Clear all
          </button>
        ) : null}
      </div>

      <p className="faint" style={{ fontSize: 12, margin: 0 }}>
        Works in the desktop app, not in the browser preview. Once the task is checked off, the
        guard lifts on its own. The guard installs system-wide keyboard and mouse hooks only while
        it is armed, and removes them the moment it is off.
      </p>
    </section>
  );
}
