import { confirmDialog } from "@ui/Dialog";
import { Bot, Check, Copy, ExternalLink, Eye, EyeOff, History, Loader2, Plug, RefreshCw, Server, ShieldCheck, Sparkles, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import { logError } from "@core/errors";
import { describeAction, describeActor, undoPlan } from "../activity";
import {
  INSTALLABLE,
  MCP_RESOURCES,
  MCP_TOOLS,
  REST_ROUTES,
  STARTER_PROMPTS,
  agentInfo,
  agentSnippets,
  agentTargets,
  configureAgent,
  installAgent,
  isDesktop,
  maskToken,
  regenerateAgentToken,
  type AgentInfo,
  type AgentTarget,
} from "../agent";
import { postSummary } from "../model";
import { useSocialStore } from "../store";
import { formatDateTime, fromIso, relativeTime } from "../time";
import type { ActivityEntry } from "../types";
import { useUi } from "../ui";
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

/** One line of activity.jsonl: who did what to which post, with Undo where the log allows it. */
function ActivityRow({ entry }: { entry: ActivityEntry }) {
  const getPost = useSocialStore((s) => s.getPost);
  const posts = useSocialStore((s) => s.posts);
  const undoActivity = useSocialStore((s) => s.undoActivity);
  const toast = useSocialStore((s) => s.toast);
  const openComposer = useUi((s) => s.openComposer);
  const [busy, setBusy] = useState(false);
  void posts; // re-render when the post list changes, so "Open" and "Undo" follow the truth
  const current = getPost(entry.postId);
  const snapshot = entry.after ?? entry.before ?? null;
  const plan = undoPlan(entry, current);
  const when = fromIso(entry.ts);
  const undo = async () => {
    setBusy(true);
    try {
      const out = await undoActivity(entry);
      toast({ kind: out.ok ? "success" : "error", title: out.ok ? out.message : "Cannot undo", body: out.ok ? undefined : out.message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="sc-activity-row">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`sc-activity-actor ${entry.actor}`}>{entry.actor}</span>
          <span className="who">
            {describeActor(entry.actor)} {describeAction(entry)}
          </span>
          <span className="when" title={when ? formatDateTime(when) : entry.ts}>
            {when ? relativeTime(when) : ""}
          </span>
        </div>
        <span className="what">{snapshot ? postSummary(snapshot, 110) : entry.postId}</span>
        {entry.note ? <span className="note">{entry.note}</span> : null}
      </div>
      <div className="flex items-center gap-1">
        {current ? (
          <button className="sc-btn ghost sm" onClick={() => openComposer(entry.postId)} title="Open the post">
            <ExternalLink /> Open
          </button>
        ) : null}
        {plan.kind === "restore" ? (
          <button className="sc-btn sm" onClick={() => void undo()} disabled={busy} title={plan.note}>
            {busy ? <Loader2 className="animate-spin" /> : <Undo2 />} Undo
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ActivityCard() {
  const activity = useSocialStore((s) => s.activity);
  const [shown, setShown] = useState(12);
  return (
    <div className="sc-card">
      <div className="sc-card-head">
        <History className="h-4 w-4 text-muted" />
        <span className="sc-card-title">Activity</span>
        <span className="ml-auto text-[11.5px] text-muted">{activity.length ? `${activity.length} recent` : "activity.jsonl"}</span>
      </div>
      {activity.length === 0 ? (
        <p className="px-4 py-3 text-[12.5px] leading-5 text-muted">
          Nothing yet. When an agent or an automation creates, edits or deletes a post it shows up here with a copy of the post before and after — and an Undo. Your approvals and rejections land here too.
        </p>
      ) : (
        <>
          {activity.slice(0, shown).map((e, i) => (
            <ActivityRow key={`${e.ts}-${e.postId}-${i}`} entry={e} />
          ))}
          {activity.length > shown ? (
            <button className="sc-btn ghost sm m-3" onClick={() => setShown((n) => n + 20)}>
              Show more
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}

function ApprovalCard() {
  const settings = useSocialStore((s) => s.settings);
  const saveSettings = useSocialStore((s) => s.saveSettings);
  const waiting = useSocialStore((s) => s.posts.filter((p) => p.status === "needs_review").length);
  const setPage = useUi((s) => s.setPage);
  return (
    <div className="sc-card">
      <div className="sc-card-head">
        <ShieldCheck className="h-4 w-4 text-muted" />
        <span className="sc-card-title">How approval works</span>
        {waiting ? (
          <button className="sc-chip on ml-auto" onClick={() => setPage("review")}>
            {waiting} waiting for you
          </button>
        ) : null}
      </div>
      <div className="sc-card-body flex flex-col gap-3">
        <label className="flex items-center justify-between gap-3 text-[13px]">
          <span>
            Agent posts need my approval
            <span className="block text-[11.5px] leading-[1.45] text-muted">
              Anything an agent or an automation creates lands in <b>Review</b> as “needs review”. The scheduler never publishes it; you approve, edit or reject. The agent is told so it can tell you.
            </span>
          </span>
          <Switch checked={settings.agentPostsNeedApproval} onCheckedChange={(v) => void saveSettings({ agentPostsNeedApproval: v })} label="Agent posts need my approval" />
        </label>
        <p className="text-[11.5px] leading-5 text-muted">
          Off = an agent's post goes straight onto the calendar, like your own. Either way every agent write is in the activity log below with Undo, and <code>client_ref</code> on a create means a retry never doubles a post.
        </p>
      </div>
    </div>
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
  const [targets, setTargets] = useState<AgentTarget[]>([]);
  const [installing, setInstalling] = useState<string | null>(null);
  const [copiedPrompt, setCopiedPrompt] = useState<string | null>(null);

  const refresh = async () => {
    const i = await agentInfo();
    setInfo(i);
    setLoaded(true);
    if (i) setPort(String(i.port));
    setTargets(await agentTargets().catch(() => []));
  };

  /**
   * Writes the MCP entry into that agent's own config. It is another
   * program's settings file, so it is confirmed first and the path is on
   * screen before and after.
   */
  const install = async (id: string, name: string, path: string, already: boolean) => {
    const ok = await confirmDialog({
      title: `Add owntools to ${name}`,
      message: `${already ? "Update" : "Add"} the owntools-social server in\n${path || "the agent's config file"}\n\nNothing else in that file is touched. ${name} can then read and schedule your posts.`,
      okLabel: already ? "Update" : "Add it",
      cancelLabel: "Cancel",
    });
    if (!ok) return;
    setInstalling(id);
    try {
      const out = await installAgent(id);
      toast({ kind: "success", title: `${name} is connected`, body: out.note });
      setTargets(await agentTargets().catch(() => []));
    } catch (err) {
      logError("social", `install agent ${id}`, err);
      toast({ kind: "error", title: `Could not set up ${name}`, body: err instanceof Error ? err.message : String(err) });
    } finally {
      setInstalling(null);
    }
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
      !(await confirmDialog({ title: "New token", message: "Generate a new token? Every agent configured with the old one stops working until you update it — for the ones listed under “Connect an agent”, that is one press of Update.", kind: "warning", okLabel: "Generate", cancelLabel: "Keep current" }))
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
                <span className="ml-auto text-[11.5px] text-muted">{MCP_TOOLS.length} tools · {MCP_RESOURCES.length} resources</span>
              </div>
              <ul className="divide-y divide-line text-[12.5px]">
                {MCP_TOOLS.map((t) => (
                  <li key={t.name} className="flex gap-3 px-4 py-2">
                    <code className="w-[128px] shrink-0 text-[11.5px] text-accent">{t.name}</code>
                    <span className="text-muted">{t.what}</span>
                  </li>
                ))}
              </ul>
              <div className="border-t border-line px-4 py-2 text-[11.5px] text-muted">Resources</div>
              <ul className="divide-y divide-line text-[12.5px]">
                {MCP_RESOURCES.map((r) => (
                  <li key={r.uri} className="flex flex-col gap-0.5 px-4 py-2">
                    <code className="text-[11.5px] text-accent">{r.uri}</code>
                    <span className="text-muted">{r.what}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="flex flex-col gap-5">
            <ApprovalCard />
            <ActivityCard />
            <div className="sc-card">
              <div className="sc-card-head">
                <Plug className="h-4 w-4 text-muted" />
                <span className="sc-card-title">Connect an agent</span>
                <span className="ml-auto text-[11.5px] text-muted">writes the server into its config</span>
              </div>
              <div className="sc-card-body flex flex-col gap-2">
                {!desktop ? (
                  <p className="text-[12.5px] leading-5 text-muted">Available in the desktop app — it is the one that can see your agents' config files.</p>
                ) : null}
                {INSTALLABLE.map((a) => {
                  const t = targets.find((x) => x.id === a.id);
                  return (
                    <div key={a.id} className="sc-agent-row">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-[13px] font-semibold">
                          {a.name}
                          {t?.installed ? <span className="sc-pill live">connected</span> : t?.detected ? <span className="sc-pill byo">found</span> : null}
                        </div>
                        <div className="truncate text-[11.5px] text-muted">{t?.path || a.what}</div>
                      </div>
                      <button
                        className={`sc-btn sm ${t?.installed ? "" : "primary"}`}
                        disabled={!desktop || installing !== null || !effective.token}
                        onClick={() => void install(a.id, a.name, t?.path ?? "", Boolean(t?.installed))}
                      >
                        {installing === a.id ? <Loader2 className="animate-spin" /> : null}
                        {t?.installed ? "Update" : "Add"}
                      </button>
                    </div>
                  );
                })}
                <p className="text-[11.5px] leading-5 text-muted">
                  Anything else — ChatGPT, OpenClaw, Hermes, your own script — copies in from the block below.
                </p>
              </div>
            </div>

            <div className="sc-card">
              <div className="sc-card-head">
                <Sparkles className="h-4 w-4 text-accent" />
                <span className="sc-card-title">What to ask it</span>
              </div>
              <ul className="divide-y divide-line">
                {STARTER_PROMPTS.map((p) => (
                  <li key={p.title} className="flex items-start gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <div className="text-[12.5px] font-semibold">{p.title}</div>
                      <div className="text-[11.5px] leading-[1.45] text-muted">{p.prompt}</div>
                    </div>
                    <button
                      className="sc-icon-btn ml-auto shrink-0"
                      aria-label={`Copy: ${p.title}`}
                      onClick={() => {
                        void copyText(p.prompt).then(() => {
                          setCopiedPrompt(p.title);
                          setTimeout(() => setCopiedPrompt(null), 1400);
                        });
                      }}
                    >
                      {copiedPrompt === p.title ? <Check /> : <Copy />}
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <div className="sc-card">
              <div className="sc-card-head flex-wrap">
                <span className="sc-card-title">Copy it in by hand</span>
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
