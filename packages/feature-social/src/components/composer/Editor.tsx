import { AtSign, Bold, Hash, Image as ImageIcon, Italic, Link2, ListPlus, Loader2, Smile, Sparkles } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AiTask } from "../../ai";
import { findFacets } from "../../facets";
import { measure } from "../../limits";
import { networkById } from "../../networks";
import { toggleUnicodeStyle } from "../../unicode";
import { Menu, Popover, Tip } from "../primitives";

const EmojiPicker = lazy(() => import("emoji-picker-react"));

/**
 * The post editor: a plain textarea (what you see is exactly what gets
 * posted) with a mirror layer behind it that colours links, mentions and
 * hashtags and marks the characters past the limit. The toolbar inserts at
 * the caret; bold/italic swap the selection for Unicode styled letters.
 */

export interface EditorAi {
  enabled: boolean;
  busy: boolean;
  run: (kind: AiTask["kind"]) => Promise<void>;
  setup: () => void;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** The strictest limit among the selected networks, and which network it belongs to. */
  counter: { limit: number; networkId: string; name: string } | null;
  autoFocus?: boolean;
  onAddMedia?: () => void;
  onAddThread?: () => void;
  ai?: EditorAi | null;
  /** Show the Unicode bold / italic buttons. */
  unicode?: boolean;
  compact?: boolean;
  extra?: ReactNode;
}

/** First UTF-16 index whose prefix no longer fits `limit` on `networkId`, or null. */
export function overflowStart(networkId: string, text: string, limit: number): number | null {
  if (!Number.isFinite(limit) || measure(networkId, text) <= limit) return null;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (measure(networkId, text.slice(0, mid)) <= limit) lo = mid + 1;
    else hi = mid;
  }
  return Math.max(0, lo - 1);
}

function Mirror({ text, networkId, limit }: { text: string; networkId: string | null; limit: number | null }) {
  const nodes = useMemo(() => {
    const over = networkId && limit !== null ? overflowStart(networkId, text, limit) : null;
    const facets = findFacets(text);
    const out: ReactNode[] = [];
    let cursor = 0;
    const push = (s: string, cls: string | null, key: string) => {
      if (!s) return;
      if (over !== null && cursor + s.length > over) {
        const okPart = s.slice(0, Math.max(0, over - cursor));
        const overPart = s.slice(Math.max(0, over - cursor));
        if (okPart) out.push(cls ? <span key={`${key}a`} className={cls}>{okPart}</span> : okPart);
        out.push(<span key={`${key}b`} className="f-over">{overPart}</span>);
      } else {
        out.push(cls ? <span key={key} className={cls}>{s}</span> : s);
      }
      cursor += s.length;
    };
    for (const f of facets) {
      push(text.slice(cursor, f.start), null, `t${cursor}`);
      push(text.slice(f.start, f.end), `f-${f.kind}`, `f${f.start}`);
    }
    push(text.slice(cursor), null, "tail");
    // A trailing newline needs a visible line so the heights match the textarea.
    if (text.endsWith("\n")) out.push(" ");
    return out;
  }, [text, networkId, limit]);
  return (
    <div className="sc-editor-mirror" aria-hidden>
      {nodes}
    </div>
  );
}

export function Editor({ value, onChange, placeholder, counter, autoFocus, onAddMedia, onAddThread, ai, unicode = true, compact, extra }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);

  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.max(compact ? 72 : 132, el.scrollHeight)}px`;
  }, [compact]);

  useEffect(() => {
    resize();
  }, [value, resize]);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  const replaceSelection = (transform: (selected: string) => string, fallbackHint?: string) => {
    const el = ref.current;
    if (!el) return;
    const { selectionStart, selectionEnd } = el;
    const selected = value.slice(selectionStart, selectionEnd);
    if (!selected && fallbackHint !== undefined) {
      insertAtCursor(fallbackHint);
      return;
    }
    const next = value.slice(0, selectionStart) + transform(selected) + value.slice(selectionEnd);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(selectionStart, selectionStart + transform(selected).length);
    });
  };

  const insertAtCursor = (text: string) => {
    const el = ref.current;
    if (!el) {
      onChange(value + text);
      return;
    }
    const { selectionStart, selectionEnd } = el;
    const before = value.slice(0, selectionStart);
    const after = value.slice(selectionEnd);
    // Keep a space before a word-like insertion when the caret follows a letter.
    const pad = /\S$/.test(before) && /^[#@\p{L}\p{N}]/u.test(text) ? " " : "";
    const next = `${before}${pad}${text}${after}`;
    onChange(next);
    const pos = before.length + pad.length + text.length;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  };

  const count = counter ? measure(counter.networkId, value) : [...value].length;
  const limit = counter?.limit ?? null;
  const ratio = limit && Number.isFinite(limit) ? count / limit : 0;
  const counterClass = ratio > 1 ? "over" : ratio > 0.9 ? "warn" : "";
  const netName = counter ? networkById(counter.networkId).name : null;

  const aiItems = ai
    ? ai.enabled
      ? [
          { key: "draft", label: value.trim() ? "Write a post from this brief" : "Write a post (type a brief first)", disabled: !value.trim(), onSelect: () => void ai.run("draft") },
          { key: "improve", label: "Tighten the wording", disabled: !value.trim(), onSelect: () => void ai.run("improve") },
          { key: "rewrite", label: `Rewrite for ${netName ?? "this network"}`, disabled: !value.trim(), onSelect: () => void ai.run("rewrite") },
          { key: "shorten", label: `Shorten to fit${limit && Number.isFinite(limit) ? ` (${limit})` : ""}`, disabled: !value.trim(), onSelect: () => void ai.run("shorten") },
          { key: "hashtags", label: "Suggest hashtags", disabled: !value.trim(), sepBefore: true, onSelect: () => void ai.run("hashtags") },
        ]
      : [{ key: "setup", label: "Set up an AI provider in Settings…", onSelect: ai.setup }]
    : [];

  return (
    <div className="sc-editor">
      <div className="sc-editor-stack">
        <Mirror text={value} networkId={counter?.networkId ?? null} limit={limit} />
        <textarea
          ref={ref}
          className="sc-editor-text"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onInput={resize}
          spellCheck
          style={compact ? { minHeight: 72 } : undefined}
        />
      </div>
      <div className="sc-editor-bar">
        {onAddMedia ? (
          <Tip label="Insert media" side="top">
            <button className="sc-icon-btn" onClick={onAddMedia} aria-label="Insert media">
              <ImageIcon />
            </button>
          </Tip>
        ) : null}
        {unicode ? (
          <>
            <Tip label="Bold (Unicode letters)" side="top">
              <button className="sc-icon-btn" aria-label="Bold" onClick={() => replaceSelection((s) => toggleUnicodeStyle(s, "bold"), "")}>
                <Bold />
              </button>
            </Tip>
            <Tip label="Italic (Unicode letters)" side="top">
              <button className="sc-icon-btn" aria-label="Italic" onClick={() => replaceSelection((s) => toggleUnicodeStyle(s, "italic"), "")}>
                <Italic />
              </button>
            </Tip>
          </>
        ) : null}
        <Popover
          open={emojiOpen}
          onOpenChange={setEmojiOpen}
          className="sc-emoji overflow-hidden"
          trigger={
            <button className="sc-icon-btn" aria-label="Emoji">
              <Smile />
            </button>
          }
        >
          <Suspense fallback={<div className="grid h-[380px] w-[320px] place-items-center text-muted"><Loader2 className="h-4 w-4 animate-spin" /></div>}>
            <EmojiPicker
              width={320}
              height={380}
              lazyLoadEmojis
              skinTonesDisabled
              searchPlaceholder="Search emoji"
              previewConfig={{ showPreview: false }}
              emojiStyle={"native" as never}
              theme={(isDarkTheme() ? "dark" : "light") as never}
              onEmojiClick={(e: { emoji: string }) => {
                insertAtCursor(e.emoji);
                setEmojiOpen(false);
              }}
            />
          </Suspense>
        </Popover>
        <Tip label="Link" side="top">
          <button className="sc-icon-btn" aria-label="Insert link" onClick={() => replaceSelection((s) => (/^https?:\/\//i.test(s) ? s : `https://${s}`), "https://")}>
            <Link2 />
          </button>
        </Tip>
        <Tip label="Hashtag" side="top">
          <button className="sc-icon-btn" aria-label="Insert hashtag" onClick={() => replaceSelection((s) => `#${s.replace(/\s+/g, "")}`, "#")}>
            <Hash />
          </button>
        </Tip>
        <Tip label="Mention" side="top">
          <button className="sc-icon-btn" aria-label="Insert mention" onClick={() => replaceSelection((s) => `@${s.replace(/\s+/g, "")}`, "@")}>
            <AtSign />
          </button>
        </Tip>
        {onAddThread ? (
          <>
            <span className="sep" />
            <Tip label="Add a thread part" side="top">
              <button className="sc-icon-btn" aria-label="Add thread part" onClick={onAddThread}>
                <ListPlus />
              </button>
            </Tip>
          </>
        ) : null}
        {ai ? (
          <>
            <span className="sep" />
            <Menu
              align="start"
              side="top"
              label="AI"
              trigger={
                <button className={`sc-btn ghost sm${ai.busy ? " opacity-70" : ""}`} disabled={ai.busy} aria-label="Generate with AI">
                  {ai.busy ? <Loader2 className="animate-spin" /> : <Sparkles />} AI
                </button>
              }
              items={aiItems}
            />
          </>
        ) : null}
        {extra}
        <span className={`sc-count ${counterClass}`} title={netName ? `Counted the way ${netName} counts` : undefined}>
          {limit && Number.isFinite(limit) ? (
            <span className="inline-flex items-center gap-1.5">
              <svg className="sc-ring" viewBox="0 0 20 20" aria-hidden>
                <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2.5" />
                <circle
                  cx="10"
                  cy="10"
                  r="8"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeDasharray={`${Math.min(1, ratio) * 50.27} 50.27`}
                  strokeLinecap="round"
                />
              </svg>
              {ratio > 0.8 ? `${limit - count}` : `${count} / ${limit}`}
            </span>
          ) : (
            <span>{count}</span>
          )}
        </span>
      </div>
    </div>
  );
}

function isDarkTheme(): boolean {
  const t = document.documentElement.dataset.theme;
  return t === "dark" || t === "ocean";
}
