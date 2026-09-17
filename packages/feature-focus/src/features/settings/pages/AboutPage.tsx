import { useEffect, useState, type ReactNode } from "react";
import { SUITE_NAME, SUPPORT_URL } from "@core/branding";
import { checkForUpdateDetailed, type UpdateCheck } from "@core/updater";
import { getDictationSettings } from "@feature-dictation/engine";
import { isTauri } from "../../../lib/env";
import { openExternal } from "../../../lib/links";
import { useAppStore } from "../../../store/useAppStore";
import { Button, Card, Note, Row } from "../ui";

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
    /* clipboard blocked - try the legacy path */
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

/** Facts about the install and a settings summary. Never any text from notes or tasks. */
function diagnosticsReport(d: Diagnostics, log: string): string {
  const s = useAppStore.getState();
  const st = s.settings;
  const dictation = getDictationSettings();
  const models = d.whisper.models ?? [];
  return [
    `${SUITE_NAME} ${d.version} - diagnostics ${new Date().toISOString()}`,
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

/**
 * "Check for updates" - the same check the banner runs at start-up, on demand,
 * with the outcome spelled out: nothing is more annoying than a button that
 * seems to do nothing. Install = download, verify the signature, passive NSIS
 * install, relaunch; the key and everything in AppData stay where they are.
 */
function UpdatesRow({ native }: { native: boolean }) {
  const [check, setCheck] = useState<UpdateCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setFailure(null);
    try {
      setCheck(await checkForUpdateDetailed());
    } finally {
      setBusy(false);
    }
  };

  const install = async () => {
    if (check?.state !== "available") return;
    setFailure(null);
    setProgress(0);
    try {
      await check.update.install(setProgress);
    } catch (err) {
      setFailure(err instanceof Error ? err.message : String(err));
      setProgress(null);
    }
  };

  let hint: ReactNode;
  if (!native) hint = "Updates come with the installed app; the browser preview has none.";
  else if (progress !== null) hint = progress < 1 ? `Downloading… ${Math.round(progress * 100)}%` : "Installing… owntools will restart by itself.";
  else if (failure) hint = `The update failed: ${failure}. Try again, or get the installer from the website.`;
  else if (busy) hint = "Checking…";
  else if (!check) hint = "owntools checks for a new version when it starts, unless Offline mode is on. Check now for a newer one.";
  else if (check.state === "available") hint = `owntools ${check.update.version} is ready to install. Your key and your files stay where they are.`;
  else if (check.state === "current") hint = `You're on the latest version${check.version ? ` (${check.version})` : ""}.`;
  else if (check.state === "offline") hint = "Offline mode is on, so nothing was asked. Turn it off under Privacy to check.";
  else if (check.state === "unavailable")
    hint =
      check.reason === "dev"
        ? "Not in a development build - the endpoint only answers for published releases."
        : "Updates come with the installed app; the browser preview has none.";
  else hint = `Couldn't check: ${check.message}`;

  const available = check?.state === "available" && progress === null;

  return (
    <Row id="updates" label="Updates" hint={hint}>
      {!native || progress !== null ? null : available ? (
        <Button kind="primary" onClick={() => void install()}>
          Install &amp; restart
        </Button>
      ) : (
        <Button disabled={busy} onClick={() => void run()}>
          {busy ? "Checking…" : "Check for updates"}
        </Button>
      )}
    </Row>
  );
}

export function AboutPage() {
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
        /* an older backend without the command */
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
      setMsg(ok ? "Diagnostics copied - paste them into your report." : "Couldn't copy. Open the log folder instead.");
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
        // nothing logged yet - show the folder itself
        await revealItemInDir(info.logPath.replace(/[\\/][^\\/]*$/, ""));
      }
    } catch {
      setMsg("Couldn't open the log folder.");
    }
  };

  return (
    <>
      <Card title={SUITE_NAME}>
        <Row label="Version">
          <span className="st-value">{native ? (info ? info.version : "reading…") : "browser preview"}</span>
        </Row>
        {info ? (
          <Row label="System">
            <span className="st-value">
              {info.os}/{info.arch} · WebView2 {info.webview}
            </span>
          </Row>
        ) : null}
        <UpdatesRow native={native} />
      </Card>

      <Card
        id="diagnostics"
        title="Support"
        desc="Diagnostics are the version, machine facts, the last 200 log lines and a settings summary - never your notes, tasks or pages."
      >
        {native ? (
          <>
            <Row label="Copy diagnostics" hint="Paste them into a report so the problem can be found without guessing.">
              <Button onClick={() => void copyDiagnostics()}>Copy</Button>
            </Row>
            <Row label="Log file" hint={info ? <span className="st-path">{info.logPath}</span> : "reading…"}>
              <Button kind="ghost" disabled={!info} onClick={() => void openLogFolder()}>
                Show in folder
              </Button>
            </Row>
          </>
        ) : null}
        <Row label="Report a problem" hint="Opens the support page in your browser.">
          <Button kind="ghost" onClick={() => void openExternal(SUPPORT_URL)}>
            Open
          </Button>
        </Row>
        {msg ? (
          <div className="st-row-foot">
            <Note>{msg}</Note>
          </div>
        ) : null}
      </Card>
    </>
  );
}
