import { Check, Loader2, MessageSquareText, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useSocialStore } from "../store";
import { useUi } from "../ui";
import { VOICE_TEMPLATE, voiceWords } from "../voice";
import { Switch } from "./primitives";

/**
 * The two settings cards social owns for agents: the approval switch and the
 * brand voice document. They live in their own file so the Settings page's
 * AI-provider block (a different owner) and this block never edit the same
 * lines.
 */

export function AgentsCard() {
  const settings = useSocialStore((s) => s.settings);
  const saveSettings = useSocialStore((s) => s.saveSettings);
  const waiting = useSocialStore((s) => s.posts.filter((p) => p.status === "needs_review").length);
  const setPage = useUi((s) => s.setPage);
  return (
    <div className="sc-card" data-settings-section="social-agents">
      <div className="sc-card-head">
        <ShieldCheck className="h-4 w-4 text-muted" />
        <span className="sc-card-title">Agents</span>
        {waiting ? (
          <button className="sc-chip on ml-auto" onClick={() => setPage("review")}>
            {waiting} waiting for review
          </button>
        ) : null}
      </div>
      <div className="sc-card-body flex flex-col gap-4">
        <label className="flex items-center justify-between gap-3 text-[13px]">
          <span>
            Agent posts need my approval
            <span className="block text-[11.5px] leading-[1.45] text-muted">
              Posts created by an agent (REST / MCP) or an automation wait in Review as “needs review”; the scheduler never publishes them until you approve. Off = they go straight onto the calendar.
            </span>
          </span>
          <Switch checked={settings.agentPostsNeedApproval} onCheckedChange={(v) => void saveSettings({ agentPostsNeedApproval: v })} label="Agent posts need my approval" />
        </label>
        <p className="text-[11.5px] leading-5 text-muted">
          Every agent write is kept in the activity log on the Agents page, with Undo. Queue slots — the times “Next free slot” and an agent's <code>add_to_queue</code> fill — are set per channel under Channels → Preferences.
        </p>
      </div>
    </div>
  );
}

export function VoiceCard() {
  const voice = useSocialStore((s) => s.voice);
  const saveVoice = useSocialStore((s) => s.saveVoice);
  const toast = useSocialStore((s) => s.toast);
  const [draft, setDraft] = useState(voice);
  const [busy, setBusy] = useState(false);
  useEffect(() => setDraft(voice), [voice]);
  const dirty = draft !== voice;
  const save = async () => {
    setBusy(true);
    try {
      await saveVoice(draft);
      toast({ kind: "success", title: "Brand voice saved", body: "Agents read it through get_brand_voice and the owntools://social/voice resource." });
    } catch (err) {
      toast({ kind: "error", title: "Could not save", body: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="sc-card" data-settings-section="social-voice">
      <div className="sc-card-head">
        <MessageSquareText className="h-4 w-4 text-muted" />
        <span className="sc-card-title">Brand voice</span>
        <span className="ml-auto text-[11.5px] text-muted">{draft.trim() ? `${voiceWords(draft)} words` : "voice.md"}</span>
      </div>
      <div className="sc-card-body flex flex-col gap-3">
        <p className="text-[12.5px] leading-5 text-muted">
          One Markdown document every agent reads before writing a word — how you sound, what you always do, what you never do. Kept as <code>voice.md</code> next to your posts; nothing else reads it.
        </p>
        <textarea className="sc-field sc-voice" value={draft} placeholder={VOICE_TEMPLATE} onChange={(e) => setDraft(e.target.value)} spellCheck />
        <div className="flex flex-wrap items-center gap-2">
          <button className="sc-btn primary" onClick={() => void save()} disabled={busy || !dirty}>
            {busy ? <Loader2 className="animate-spin" /> : <Check />} Save
          </button>
          {!draft.trim() ? (
            <button className="sc-btn ghost" onClick={() => setDraft(VOICE_TEMPLATE)}>
              Start from the template
            </button>
          ) : dirty ? (
            <button className="sc-btn ghost" onClick={() => setDraft(voice)}>
              Discard changes
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
