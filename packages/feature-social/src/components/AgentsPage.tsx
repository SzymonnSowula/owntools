import { confirmDialog } from "@ui/Dialog";
import { Bot, Check, Copy, Eye, EyeOff, Loader2, RefreshCw, Server } from "lucide-react";
import { useEffect, useState } from "react";
import { logError } from "@core/errors";
import { MCP_TOOLS, REST_ROUTES, agentInfo, agentSnippets, configureAgent, isDesktop, maskToken, regenerateAgentToken, type AgentInfo } from "../agent";
import { useSocialStore } from "../store";
import { Switch, copyText } from "./primitives";

/**
 * The Agents page: where the local server lives, the token that guards it,
 * and copy-paste setup for Claude Code, Cursor, Codex, ChatGPT, OpenClaw,
 * Hermes and plain REST.
 */

function CodeBlock({ code }: { code: string }) {
  const [done, setDone] = useState(false);
  return (
    <pre className="sc-code">
      <button
        className="sc-icon-btn copy"
        aria-label="Copy"
        onClick={() => {
          void copyText(code).then(() => {
            setDone(true);
            setTimeout(() => setDone(false), 1400);
          });
        }}
      >
        {done ? <Check /> : <Copy />}
      </button>
      {code}
    </pre>
  );
}

export function AgentsPage() {
  const settings = useSocialStore((s) => s.settings);
  const toast = useSocialStore((s) => s.toast);
  const [info, setInfo] = useState<AgentInfo | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [port, setPort] = useState<string>(() => String(settings.agent.port));
  const [agent, setAgent] = useState("claude-code");

  const refresh = async () => {
    const i = await agentInfo();
    setInfo(i);
    setLoaded(true);
    if (i) setPort(String(i.port));
  };
  useEffect(() => {
    void refresh();
  }, []);

  const desktop = isDesktop();
  const effective = info ?? { running: false, enabled: settings.agent.enabled, port: settings.agent.port, token: settings.agent.token || "<token shown in the desktop app>", url: `http://127.0.0.1:${settings.agent.port}` };
  const snippets = agentSnippets(effective);
  const current = snippets.find((s) => s.id === agent) ?? snippets[0]!;

  const rotate = async () => {
    if (
      !(await confirmDialog({ title: "New token", message: "Generate a new token? Every agent configured with the old one stops working until you update it.", kind: "warning", okLabel: "Generate", cancelLabel: "Keep current" }))
    )
      return;
    setBusy(true);
    try {
      setInfo(await regenerateAgentToken());
      setReveal(true);
      toast({ kind: "success", title: "New token generated" });
    } catch (err) {
      logError("social", "regenerate token", err);
      toast({ kind: "error", title: "Could not regenerate", body: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const apply = async (patch: { port?: number; enabled?: boolean }) => {
    setBusy(true);
    try {
      setInfo(await configureAgent(patch));
      toast({ kind: "success", title: patch.enabled === false ? "Agent API paused" : "Server updated" });
    } catch (err) {
      logError("social", "configure agent", err);
      toast({ kind: "error", title: "Could not update the server", body: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sc-main">
      <div className="sc-toolbar">
        <div className="sc-toolbar-title">agents</div>
        <span className="text-[12px] text-muted">Let Claude Code, Cursor, Codex, ChatGPT, OpenClaw or Hermes plan and schedule posts through a local API.</span>
      </div>
      <div className="sc-content sc-desk sc-scroll">
        <div className="mx-auto grid max-w-[980px] gap-5 p-6 lg:grid-cols-[360px_1fr]">
          <div className="flex flex-col gap-5">
            <div className="sc-card">
              <div className="sc-card-head">
                <Server className="h-4 w-4 text-muted" />
                <span className="sc-card-title">Local server</span>
                <span className={`sc-status ml-auto ${!desktop ? "warn" : effective.running && effective.enabled ? "ok" : effective.running ? "warn" : "err"}`}>
                  <span className="sc-status-dot" />
                  {!desktop ? "desktop app only" : !effective.running ? "not running" : effective.enabled ? "running" : "paused"}
                </span>
              </div>
              <div className="sc-card-body flex flex-col gap-4">
                {!desktop ? (
                  <p className="text-[12.5px] leading-5 text-muted">
                    The server is part of the desktop app. In the browser preview the snippets below show the shape of the setup with placeholder values.
                  </p>
                ) : !loaded ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted" />
                ) : null}
                <div>
                  <div className="sc-label">Address</div>
                  <div className="sc-token select-all">{effective.url}</div>
                  <div className="sc-hint">Binds to 127.0.0.1 only — reachable from this machine. For ChatGPT connectors, expose it through a tunnel.</div>
                </div>
                <label className="flex items-center justify-between gap-3 text-[13px]">
                  <span>
                    Accept agent requests
                    <span className="block text-[11.5px] text-muted">Off = REST and MCP answer 403; sign-in callbacks keep working.</span>
                  </span>
                  <Switch checked={effective.enabled} onCheckedChange={(v) => void apply({ enabled: v })} label="Agent API enabled" />
                </label>
                <div className="flex items-end gap-2">
                  <label className="flex-1">
                    <span className="sc-label">Port</span>
                    <input className="sc-field" type="number" min={1024} max={65535} value={port} onChange={(e) => setPort(e.target.value)} disabled={!desktop} />
                  </label>
                  <button className="sc-btn" disabled={!desktop || busy || Number(port) === effective.port || !(Number(port) >= 1024 && Number(port) <= 65535)} onClick={() => void apply({ port: Number(port) })}>
                    Apply
                  </button>
                </div>
              </div>
            </div>

            <div className="sc-card">
              <div className="sc-card-head">
                <Bot className="h-4 w-4 text-muted" />
                <span className="sc-card-title">Access token</span>
              </div>
              <div className="sc-card-body flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <span className="sc-token flex-1 truncate">{reveal ? effective.token : maskToken(effective.token)}</span>
                  <button className="sc-icon-btn" aria-label={reveal ? "Hide" : "Reveal"} onClick={() => setReveal((v) => !v)}>
                    {reveal ? <EyeOff /> : <Eye />}
                  </button>
                  <button
                    className="sc-icon-btn"
                    aria-label="Copy token"
                    onClick={() => void copyText(effective.token).then((ok) => toast({ kind: ok ? "success" : "error", title: ok ? "Token copied" : "Clipboard refused" }))}
                  >
                    <Copy />
                  </button>
                </div>
                <div className="sc-hint">Sent as <code>Authorization: Bearer …</code>. Anyone on this machine with the token can read and write your posts.</div>
                <button className="sc-btn sm self-start" onClick={() => void rotate()} disabled={!desktop || busy}>
                  <RefreshCw /> Regenerate
                </button>
              </div>
            </div>

            <div className="sc-card">
              <div className="sc-card-head">
                <span className="sc-card-title">What agents can do</span>
              </div>
              <ul className="divide-y divide-line text-[12.5px]">
                {MCP_TOOLS.map((t) => (
                  <li key={t.name} className="flex gap-3 px-4 py-2">
                    <code className="w-[112px] shrink-0 text-[11.5px] text-accent">{t.name}</code>
                    <span className="text-muted">{t.what}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="flex flex-col gap-5">
            <div className="sc-card">
              <div className="sc-card-head flex-wrap">
                <span className="sc-card-title">Set up an agent</span>
                <div className="ml-auto flex flex-wrap gap-1">
                  {snippets.map((s) => (
                    <button key={s.id} className={`sc-chip${s.id === current.id ? " on" : ""}`} onClick={() => setAgent(s.id)}>
                      {s.name}
                    </button>
                  ))}
                </div>
              </div>
              <div className="sc-card-body">
                <p className="mb-3 text-[12.5px] leading-5 text-muted">{current.note}</p>
                <CodeBlock code={current.code} />
                {current.needsPublicUrl ? (
                  <div className="sc-issue warning mt-3">
                    <span>ChatGPT cannot reach 127.0.0.1. The tunnel makes your local server public — keep the token secret and close the tunnel when you are done.</span>
                  </div>
                ) : null}
                <p className="mt-3 text-[12px] text-muted">
                  MCP endpoint: <code>{effective.url}/mcp</code> (Streamable HTTP, JSON responses). Every post an agent creates shows up in the calendar as “agent” and can be edited before it goes out.
                </p>
              </div>
            </div>

            <div className="sc-card">
              <div className="sc-card-head">
                <span className="sc-card-title">REST routes</span>
                <span className="ml-auto text-[11.5px] text-muted">JSON in, JSON out</span>
              </div>
              <ul className="divide-y divide-line text-[12.5px]">
                {REST_ROUTES.map((r) => (
                  <li key={r.method + r.path} className="grid grid-cols-[52px_190px_1fr] gap-3 px-4 py-2">
                    <code className="text-[11px] font-bold text-accent">{r.method}</code>
                    <code className="text-[11.5px]">{r.path}</code>
                    <span className="text-muted">{r.what}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
