import { confirmDialog } from "@ui/Dialog";
import { BookA, Copy, TextQuote, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Card, copyToClipboard, PageHead, Switch } from "../components";
import { clearHistory, countWords, getHistory, removeHistoryTake, subscribeHistory, type HistoryTake } from "../history";
import { useDictationSettings } from "../useSettings";
import type { Page } from "../DictateView";

function dayLabel(at: number, now = new Date()): string {
  const d = new Date(at);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 24 * 60 * 60 * 1000;
  if (at >= startOfToday) return "Today";
  if (at >= startOfToday - day) return "Yesterday";
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

function timeLabel(at: number): string {
  return new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function durationLabel(ms?: number): string | null {
  if (!ms) return null;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function useHistory(): HistoryTake[] {
  const [takes, setTakes] = useState<HistoryTake[]>(() => getHistory());
  useEffect(() => subscribeHistory(() => setTakes(getHistory())), []);
  return takes;
}

export function HistoryPage({ onNavigate }: { onNavigate: (page: Page) => void }) {
  const takes = useHistory();
  const [settings, update] = useDictationSettings();
  const [copied, setCopied] = useState<string | null>(null);

  const groups = useMemo(() => {
    const out: { label: string; takes: HistoryTake[] }[] = [];
    for (const take of takes) {
      const label = dayLabel(take.at);
      const last = out[out.length - 1];
      if (last && last.label === label) last.takes.push(take);
      else out.push({ label, takes: [take] });
    }
    return out;
  }, [takes]);

  const words = takes.reduce((n, t) => n + countWords(t.text), 0);

  async function copy(take: HistoryTake) {
    if (await copyToClipboard(take.text)) {
      setCopied(take.id);
      window.setTimeout(() => setCopied((id) => (id === take.id ? null : id)), 1200);
    }
  }

  async function clearAll() {
    const ok = await confirmDialog({
      title: "Clear history?",
      message: `${takes.length} ${takes.length === 1 ? "take" : "takes"} will be forgotten. The text you already typed stays where it is.`,
      okLabel: "Clear",
      kind: "danger",
    });
    if (ok) clearHistory();
  }

  return (
    <div className="dt-page">
      <PageHead
        title="history"
        sub="What you dictated lately — kept on this machine only, so a sentence is never lost and a word that keeps coming out wrong is easy to spot."
        actions={
          takes.length ? (
            <button className="dt-btn ghost sm danger" onClick={() => void clearAll()}>
              <Trash2 /> Clear history
            </button>
          ) : null
        }
      />

      {!settings.keepHistory ? (
        <Card flush>
          <div className="dt-row">
            <div>
              <div className="dt-row-label">History is off</div>
              <div className="dt-row-hint">New takes are not being remembered. Turn it on to keep the last 100.</div>
            </div>
            <div className="dt-row-ctl">
              <Switch label="Keep a history of takes" checked={false} onCheckedChange={(keepHistory) => update({ keepHistory })} />
            </div>
          </div>
        </Card>
      ) : null}

      <Card flush>
        <div className="dt-list-head">
          <span>
            {takes.length} {takes.length === 1 ? "take" : "takes"}
            {words ? ` · ${words} words` : ""}
          </span>
          <span>newest first</span>
        </div>
        {takes.length === 0 ? (
          <div className="dt-empty">
            <div className="dt-empty-icon">
              <TextQuote />
            </div>
            <div className="dt-empty-title">No takes yet</div>
            <p className="dt-empty-text">
              Every take you dictate from now on shows up here with its time and length.
            </p>
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.label}>
              <div className="dt-day">{group.label}</div>
              {group.takes.map((take) => {
                const duration = durationLabel(take.durationMs);
                return (
                  <div key={take.id} className="dt-take">
                    <div className="dt-take-meta">
                      <span>{timeLabel(take.at)}</span>
                      <span>·</span>
                      <span>{countWords(take.text)} words</span>
                      {duration ? (
                        <>
                          <span>·</span>
                          <span>{duration}</span>
                        </>
                      ) : null}
                      {take.app ? (
                        <>
                          <span>·</span>
                          <span className="dt-take-app" title="Typed into">
                            → {take.app}
                          </span>
                        </>
                      ) : null}
                      {take.note ? (
                        <>
                          <span>·</span>
                          <span className="dt-take-note">{take.note}</span>
                        </>
                      ) : null}
                      <span className="dt-take-actions">
                        <button
                          className="dt-icon-btn"
                          title="Copy"
                          aria-label="Copy"
                          onClick={() => void copy(take)}
                        >
                          <Copy />
                        </button>
                        <button
                          className="dt-icon-btn"
                          title="Open the vocabulary"
                          aria-label="Open the vocabulary"
                          onClick={() => onNavigate("vocabulary")}
                        >
                          <BookA />
                        </button>
                        <button
                          className="dt-icon-btn danger"
                          title="Forget this take"
                          aria-label="Forget this take"
                          onClick={() => removeHistoryTake(take.id)}
                        >
                          <Trash2 />
                        </button>
                      </span>
                      {copied === take.id ? <span className="dt-badge accent">copied</span> : null}
                    </div>
                    <div className="dt-take-text">{take.text}</div>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </Card>
    </div>
  );
}
