import { AlertTriangle, ExternalLink, KeyRound, Loader2, RefreshCw } from "lucide-react";
import { useState } from "react";
import { billingUrl, checkChannel, waitingPosts } from "../../channelHealth";
import { networkById } from "../../networks";
import { useSocialStore } from "../../store";
import type { Channel } from "../../types";
import { useUi } from "../../ui";
import { openExternal } from "../Toasts";

/** What stops a channel from publishing, with the action that fixes it and a way to check again. */
export function HealthNote({ channel, compact = false }: { channel: Channel; compact?: boolean }) {
  const openReconnect = useUi((s) => s.openReconnect);
  const toast = useSocialStore((s) => s.toast);
  const [checking, setChecking] = useState(false);
  if (!channel.health) return null;
  const billing = channel.health.kind === "billing" ? billingUrl(channel) : null;
  const check = async () => {
    setChecking(true);
    const r = await checkChannel(channel);
    setChecking(false);
    if (!r.tested) toast({ kind: "info", title: "No test for this network", body: "The note goes away with the next post that goes out." });
    else toast({ kind: r.ok ? "success" : "error", title: r.ok ? "Connection works" : "Still not working", body: r.message });
  };
  return (
    <div className={`sc-health ${channel.health.kind}${compact ? " compact" : ""}`}>
      <span className="sc-health-text">{channel.health.message}</span>
      <span className="sc-health-actions">
        {channel.health.kind === "auth" ? (
          <button className="sc-btn sm primary" onClick={() => openReconnect(channel.id)}>
            <KeyRound /> Reconnect
          </button>
        ) : billing ? (
          <button className="sc-btn sm primary" onClick={() => void openExternal(billing)}>
            <ExternalLink /> Add credits
          </button>
        ) : null}
        <button className="sc-btn sm" onClick={() => void check()} disabled={checking} title="Run the connection test again">
          {checking ? <Loader2 className="animate-spin" /> : <RefreshCw />} Check again
        </button>
      </span>
    </div>
  );
}

/**
 * Above the calendar: every enabled channel that cannot publish, and how many
 * scheduled posts go down with it. Before this, a dead X session showed up
 * only as a failed post once its time had passed, next to a channel that
 * still said "live".
 */
export function ChannelAlerts() {
  const channels = useSocialStore((s) => s.channels);
  const posts = useSocialStore((s) => s.posts);
  const sick = channels.filter((c) => c.health && !c.disabled);
  if (!sick.length) return null;
  return (
    <div className="sc-alerts">
      {sick.map((c) => {
        const waiting = waitingPosts(posts, c.id);
        const auth = c.health!.kind === "auth";
        const what = auth ? "is signed out" : `is out of ${networkById(c.provider).name} API credits`;
        const until = auth ? "you reconnect it" : "credits are added";
        return (
          <div key={c.id} className={`sc-alert ${c.health!.kind}`} role="alert">
            <AlertTriangle className="sc-alert-icon" />
            <div className="min-w-0 flex-1">
              <div className="sc-alert-title">
                {c.displayName} ({c.handle}) {what}
                {waiting ? ` — ${waiting} scheduled post${waiting === 1 ? "" : "s"} will fail until ${until}.` : "."}
              </div>
              <HealthNote channel={c} compact />
            </div>
          </div>
        );
      })}
    </div>
  );
}
