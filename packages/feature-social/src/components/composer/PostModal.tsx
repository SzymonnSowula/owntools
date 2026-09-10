import { confirmDialog } from "@ui/Dialog";
import * as Tabs from "@radix-ui/react-tabs";
import { AlertTriangle, Check, ChevronDown, Globe, Info, Loader2, Plus, Repeat, RotateCcw, Send, Tag as TagIcon, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { logError } from "@core/errors";
import { aiConfigured, runAiTask, type AiTask } from "../../ai";
import { charLimit, hasErrors, resolveContent, validatePost, type Issue } from "../../limits";
import { newPost, postIsEmpty } from "../../model";
import { networkById } from "../../networks";
import { REPEAT_OPTIONS, describeRepeat } from "../../recurrence";
import { finalContent, publishPost } from "../../scheduler";
import { mediaById as mediaLookup, useSocialStore } from "../../store";
import { fromIso, toIso } from "../../time";
import type { Channel, ChannelOverride, MediaRef, Post, PostContent, ThreadPart } from "../../types";
import { useUi } from "../../ui";
import { Avatar } from "../Avatar";
import { Dialog, Popover } from "../primitives";
import { DateTimePicker } from "./DateTimePicker";
import { Editor } from "./Editor";
import { MediaStrip, mimeFromName } from "./MediaStrip";
import { NetworkPreview } from "./Preview";

/**
 * Create / edit a post. One working copy of the post lives here until the
 * footer saves it: draft, scheduled, or published right away. Every
 * selected channel gets a tab where the text can be tuned for that network
 * without touching the others.
 */

const MAX_PREVIEWS = 4;

function IssueList({ issues }: { issues: Issue[] }) {
  if (!issues.length) return null;
  return (
    <div className="mx-4 mt-3 flex flex-col gap-1.5">
      {issues.map((i, n) => (
        <div key={n} className={`sc-issue ${i.level}`}>
          {i.level === "error" ? <AlertTriangle /> : <Info />}
          <span>{i.message}</span>
        </div>
      ))}
    </div>
  );
}

function ThreadParts({
  parts,
  onChange,
  counter,
}: {
  parts: ThreadPart[];
  onChange: (parts: ThreadPart[]) => void;
  counter: { limit: number; networkId: string; name: string } | null;
}) {
  return (
    <>
      {parts.map((part, i) => (
        <div key={i}>
          <div className="sc-thread-line">
            Part {i + 2}
            <button
              className="sc-icon-btn !h-6 !w-6"
              aria-label="Remove part"
              onClick={() => onChange(parts.filter((_, j) => j !== i))}
            >
              <X />
            </button>
          </div>
          <div className="sc-thread-part">
            <Editor
              compact
              value={part.text}
              onChange={(text) => onChange(parts.map((p, j) => (j === i ? { ...p, text } : p)))}
              placeholder="Continue the thread…"
              counter={counter}
              unicode
              extra={null}
            />
            <MediaStrip refs={part.media} onChange={(media) => onChange(parts.map((p, j) => (j === i ? { ...p, media } : p)))} max={4} />
          </div>
        </div>
      ))}
    </>
  );
}

export function PostModal() {
  const composer = useUi((s) => s.composer);
  const closeComposer = useUi((s) => s.closeComposer);
  const setPage = useUi((s) => s.setPage);
  const setAddChannelOpen = useUi((s) => s.setAddChannelOpen);
  const channels = useSocialStore((s) => s.channels);
  const tags = useSocialStore((s) => s.tags);
  const media = useSocialStore((s) => s.media);
  const settings = useSocialStore((s) => s.settings);
  const getPost = useSocialStore((s) => s.getPost);
  const createPost = useSocialStore((s) => s.createPost);
  const updatePost = useSocialStore((s) => s.updatePost);
  const deletePost = useSocialStore((s) => s.deletePost);
  const addTag = useSocialStore((s) => s.addTag);
  const addMedia = useSocialStore((s) => s.addMedia);
  const toast = useSocialStore((s) => s.toast);

  const [draft, setDraft] = useState<Post>(() => newPost());
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState<string>("all");
  const [busy, setBusy] = useState<"draft" | "schedule" | "now" | "delete" | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [newTag, setNewTag] = useState("");
  const [tagOpen, setTagOpen] = useState(false);
  const [repeatOpen, setRepeatOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Load the working copy whenever the composer opens.
  useEffect(() => {
    if (!composer.open) return;
    const existing = composer.postId ? getPost(composer.postId) : null;
    const seed = composer.seed ?? {};
    const enabled = channels.filter((c) => !c.disabled && !c.stub).map((c) => c.id);
    const base = existing
      ? structuredClone(existing)
      : newPost({
          ...seed,
          channelIds: seed.channelIds?.length ? seed.channelIds : enabled.length <= 3 ? enabled : [],
        });
    setDraft(base);
    setDirty(false);
    setTab("all");
    setBusy(null);
  }, [composer.open, composer.postId, composer.seed, channels, getPost]);

  const selected = useMemo(() => draft.channelIds.map((id) => channels.find((c) => c.id === id)).filter((c): c is Channel => Boolean(c)), [draft.channelIds, channels]);
  const lookup = useMemo(() => mediaLookup(media), [media]);
  const issues = useMemo(() => validatePost(draft, channels, lookup), [draft, channels, lookup]);
  const blocked = hasErrors(issues);
  const warnings = useMemo(() => Object.values(issues).flat().filter((i) => i.level === "warning").length, [issues]);

  const patch = (fn: (p: Post) => Post) => {
    setDraft((p) => fn(p));
    setDirty(true);
  };

  /** Content edited in the current tab: the global content or a channel override. */
  const editing: PostContent = tab === "all" ? draft.content : resolveContent(draft, tab);
  const setEditing = (change: Partial<PostContent>) => {
    if (tab === "all") {
      patch((p) => ({ ...p, content: { ...p.content, ...change } }));
    } else {
      patch((p) => {
        const o: ChannelOverride = { ...(p.overrides[tab] ?? {}) };
        const resolved = resolveContent(p, tab);
        const next: ChannelOverride = { ...o };
        if (change.text !== undefined) next.text = change.text;
        if (change.media !== undefined) next.media = change.media;
        if (change.thread !== undefined) next.thread = change.thread;
        if (change.title !== undefined) next.title = change.title;
        // Anything untouched stays inherited; explicitly copy what the user is now editing.
        if (next.text === undefined && change.text === undefined && (change.media || change.thread)) next.text = resolved.text;
        return { ...p, overrides: { ...p.overrides, [tab]: next } };
      });
    }
  };
  const hasOverride = tab !== "all" && Boolean(draft.overrides[tab] && Object.keys(draft.overrides[tab]!).length);
  const resetOverride = () =>
    patch((p) => {
      const next = { ...p.overrides };
      delete next[tab];
      return { ...p, overrides: next };
    });

  // Counter: the strictest limit among the channels this tab feeds.
  const counterFor = (ids: string[]) => {
    let best: { limit: number; networkId: string; name: string } | null = null;
    for (const id of ids) {
      const ch = channels.find((c) => c.id === id);
      if (!ch) continue;
      const net = networkById(ch.provider);
      const content = resolveContent(draft, id);
      const limit = charLimit(net, ch, content.media.length > 0);
      if (!best || limit < best.limit) best = { limit, networkId: net.id, name: net.name };
    }
    return best;
  };
  const counter = tab === "all" ? counterFor(draft.channelIds.filter((id) => !draft.overrides[id]?.text)) : counterFor([tab]);
  const showUnicode = selected.some((c) => networkById(c.provider).unicodeStyling);
  const threadsPossible = selected.some((c) => networkById(c.provider).threads);
  const needsTitle = selected.some((c) => networkById(c.provider).titleRequired);

  const ai = {
    enabled: aiConfigured(settings.ai),
    busy: aiBusy,
    setup: () => {
      closeComposer();
      setPage("settings");
    },
    run: async (kind: AiTask["kind"]) => {
      setAiBusy(true);
      try {
        const out = await runAiTask(settings.ai, { kind, text: editing.text, networkId: counter?.networkId, limit: counter?.limit });
        if (!out) throw new Error("The model returned nothing.");
        if (kind === "hashtags") setEditing({ text: `${editing.text.trimEnd()}\n\n${out}` });
        else setEditing({ text: out });
      } catch (err) {
        logError("social", "ai", err);
        toast({ kind: "error", title: "AI request failed", body: err instanceof Error ? err.message : String(err) });
      } finally {
        setAiBusy(false);
      }
    },
  };

  const importFiles = async (files: File[]) => {
    const usable = files.filter((f) => f.type.startsWith("image/") || f.type.startsWith("video/") || /\.(png|jpe?g|gif|webp|mp4|webm|mov)$/i.test(f.name));
    if (!usable.length) return;
    try {
      const refs: MediaRef[] = [...editing.media];
      for (const f of usable) {
        const item = await addMedia({ bytes: new Uint8Array(await f.arrayBuffer()), name: f.name, mime: f.type || mimeFromName(f.name) });
        refs.push({ id: item.id });
      }
      setEditing({ media: refs.slice(0, 10) });
    } catch (err) {
      logError("social", "import media", err);
      toast({ kind: "error", title: "Could not add media", body: err instanceof Error ? err.message : String(err) });
    }
  };

  useEffect(() => {
    if (!composer.open) return;
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length) {
        e.preventDefault();
        void importFiles(files);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composer.open, editing.media, tab]);

  const persist = async (status: Post["status"], opts: { publishNow?: boolean } = {}): Promise<Post | null> => {
    const clean: Post = {
      ...draft,
      status,
      content: { ...draft.content, thread: draft.content.thread.filter((p) => p.text.trim() || p.media.length) },
      attempts: status === "scheduled" ? 0 : draft.attempts,
      nextAttemptAt: null,
      lastError: status === "scheduled" ? null : draft.lastError,
      results: status === "scheduled" && draft.status === "failed" ? Object.fromEntries(Object.entries(draft.results).filter(([, r]) => r.status === "ok")) : draft.results,
    };
    if (opts.publishNow) clean.scheduledAt = toIso(new Date());
    const exists = Boolean(composer.postId && getPost(composer.postId));
    const saved = exists ? await updatePost(clean.id, () => clean) : await createPost(clean);
    return saved;
  };

  const close = async () => {
    if (
      dirty &&
      !postIsEmpty(draft) &&
      !(await confirmDialog({ title: "Discard changes?", message: "Discard the changes to this post?", kind: "warning", okLabel: "Discard", cancelLabel: "Keep editing" }))
    )
      return;
    closeComposer();
  };

  const saveDraft = async () => {
    setBusy("draft");
    try {
      await persist("draft");
      toast({ kind: "success", title: "Draft saved" });
      closeComposer();
    } catch (err) {
      toast({ kind: "error", title: "Could not save", body: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  };

  const schedule = async () => {
    if (!draft.channelIds.length) {
      toast({ kind: "error", title: "Pick at least one channel" });
      return;
    }
    if (!draft.scheduledAt) {
      toast({ kind: "error", title: "Pick a date and time", body: "Or save it as a draft for now." });
      return;
    }
    if (blocked) {
      toast({ kind: "error", title: "Fix the red issues first" });
      return;
    }
    const when = fromIso(draft.scheduledAt);
    if (
      when &&
      when.getTime() < Date.now() - 60_000 &&
      !(await confirmDialog({ title: "That time has passed", message: "The post will go out on the next check. Schedule anyway?", okLabel: "Schedule", cancelLabel: "Change time" }))
    )
      return;
    setBusy("schedule");
    try {
      await persist("scheduled");
      toast({ kind: "success", title: draft.status === "scheduled" ? "Post updated" : "Added to the calendar" });
      closeComposer();
    } catch (err) {
      toast({ kind: "error", title: "Could not schedule", body: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  };

  const postNow = async () => {
    if (!draft.channelIds.length) {
      toast({ kind: "error", title: "Pick at least one channel" });
      return;
    }
    if (blocked) {
      toast({ kind: "error", title: "Fix the red issues first" });
      return;
    }
    setBusy("now");
    try {
      const saved = await persist("scheduled", { publishNow: true });
      closeComposer();
      if (saved) void publishPost(saved.id, { manual: true });
    } catch (err) {
      toast({ kind: "error", title: "Could not publish", body: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!composer.postId || !getPost(composer.postId)) {
      closeComposer();
      return;
    }
    const ok = await confirmDialog({ title: "Delete post", message: "Delete this post? Published copies stay on the networks.", kind: "danger", okLabel: "Delete", cancelLabel: "Keep" });
    if (!ok) return;
    setBusy("delete");
    await deletePost(composer.postId);
    setBusy(null);
    closeComposer();
  };

  const previewChannels = tab === "all" ? selected.slice(0, MAX_PREVIEWS) : selected.filter((c) => c.id === tab);
  const scheduledDate = fromIso(draft.scheduledAt);
  const isPublished = draft.status === "published";
  const primaryLabel = isPublished ? "Save changes" : draft.status === "scheduled" ? "Update" : "Add to calendar";

  return (
    <Dialog
      open={composer.open}
      onOpenChange={(o) => {
        if (!o) close();
      }}
      title={composer.postId && getPost(composer.postId) ? (isPublished ? "published post" : "edit post") : "create post"}
      size="wide"
      description="Write a post, pick channels and a time."
      headExtra={
        draft.status === "published" || draft.status === "failed" ? (
          <span className={`sc-status mr-2 ${draft.status === "published" ? "ok" : "err"}`}>
            <span className="sc-status-dot" /> {draft.status === "published" ? "Published" : draft.lastError ?? "Failed"}
          </span>
        ) : null
      }
      footer={
        <>
          <Popover
            open={tagOpen}
            onOpenChange={setTagOpen}
            side="top"
            className="w-[240px] p-2"
            trigger={
              <button className="sc-btn">
                <TagIcon /> {draft.tags.length ? tags.filter((t) => draft.tags.includes(t.id)).map((t) => t.name).join(", ") : "Add tag"} <ChevronDown />
              </button>
            }
          >
            {tags.map((t) => {
              const on = draft.tags.includes(t.id);
              return (
                <button key={t.id} className="sc-menu-item" onClick={() => patch((p) => ({ ...p, tags: on ? p.tags.filter((x) => x !== t.id) : [...p.tags, t.id] }))}>
                  <span className="sc-chip-dot" style={{ background: t.color }} />
                  {t.name}
                  {on ? <Check className="check" /> : null}
                </button>
              );
            })}
            <div className="mt-1 flex gap-1 border-t border-line pt-2">
              <input
                className="sc-field !h-8"
                placeholder="New tag"
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newTag.trim()) {
                    void addTag(newTag).then((t) => patch((p) => ({ ...p, tags: [...p.tags, t.id] })));
                    setNewTag("");
                  }
                }}
              />
              <button
                className="sc-btn sm"
                disabled={!newTag.trim()}
                onClick={() => {
                  void addTag(newTag).then((t) => patch((p) => ({ ...p, tags: [...p.tags, t.id] })));
                  setNewTag("");
                }}
              >
                <Plus />
              </button>
            </div>
          </Popover>
          <Popover
            open={repeatOpen}
            onOpenChange={setRepeatOpen}
            side="top"
            className="w-[240px] p-2"
            trigger={
              <button className="sc-btn" disabled={isPublished}>
                <Repeat /> {describeRepeat(draft.repeat)} <ChevronDown />
              </button>
            }
          >
            {REPEAT_OPTIONS.map((o) => (
              <button
                key={o.kind}
                className="sc-menu-item"
                onClick={() => {
                  patch((p) => ({ ...p, repeat: o.kind === "every-n-days" ? { kind: o.kind, every: p.repeat.every ?? 3 } : { kind: o.kind } }));
                  if (o.kind !== "every-n-days") setRepeatOpen(false);
                }}
              >
                {o.label}
                {draft.repeat.kind === o.kind ? <Check className="check" /> : null}
              </button>
            ))}
            {draft.repeat.kind === "every-n-days" ? (
              <div className="mt-1 flex items-center gap-2 border-t border-line px-1 pt-2 text-[12px]">
                every
                <input
                  type="number"
                  min={1}
                  max={365}
                  className="sc-field !h-8 !w-16"
                  value={draft.repeat.every ?? 3}
                  onChange={(e) => patch((p) => ({ ...p, repeat: { ...p.repeat, every: Math.max(1, Number(e.target.value) || 1) } }))}
                />
                days
              </div>
            ) : null}
            {draft.repeat.kind !== "none" ? (
              <div className="mt-2 px-1 text-[11px] text-muted">The next occurrence is created after each successful publish.</div>
            ) : null}
          </Popover>
          <button className="sc-btn danger" onClick={() => void remove()} disabled={busy !== null}>
            <Trash2 /> {composer.postId && getPost(composer.postId) ? "Delete" : "Discard"}
          </button>
          <div className="ml-auto flex items-center gap-2">
            <DateTimePicker
              value={scheduledDate}
              onChange={(d) => patch((p) => ({ ...p, scheduledAt: d ? toIso(d) : null }))}
              weekStart={settings.weekStart}
              defaultTime={settings.defaultTime}
              disabled={isPublished}
            />
            {!isPublished ? (
              <button className="sc-btn" onClick={() => void saveDraft()} disabled={busy !== null}>
                {busy === "draft" ? <Loader2 className="animate-spin" /> : null} Save as draft
              </button>
            ) : null}
            {isPublished ? (
              <button className="sc-btn primary" onClick={() => void saveDraft().then(() => undefined)} disabled={busy !== null}>
                Save
              </button>
            ) : (
              <>
                {/* Publishing by hand is half of what this tool is for, so it
                    is a button of its own rather than an item behind a caret. */}
                <button
                  className="sc-btn"
                  onClick={() => void postNow()}
                  disabled={busy !== null}
                  title={settings.simulate ? "Simulated in the browser preview" : "Publish straight away"}
                >
                  {busy === "now" ? <Loader2 className="animate-spin" /> : <Send />} Post now
                </button>
                <button className="sc-btn primary" onClick={() => void schedule()} disabled={busy !== null}>
                  {busy === "schedule" ? <Loader2 className="animate-spin" /> : null} {primaryLabel}
                </button>
              </>
            )}
          </div>
        </>
      }
    >
      <div
        ref={bodyRef}
        className={`sc-composer h-full${dropping ? " sc-dropzone" : ""}`}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) {
            e.preventDefault();
            setDropping(true);
          }
        }}
        onDragLeave={() => setDropping(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDropping(false);
          void importFiles(Array.from(e.dataTransfer.files));
        }}
      >
        <div className="sc-composer-left sc-scroll">
          {/* Channel picker */}
          <div className="sc-picker">
            {channels.length === 0 ? (
              <button className="sc-btn sm" onClick={() => { closeComposer(); setAddChannelOpen(true); }}>
                <Plus /> Connect a channel to post to
              </button>
            ) : (
              channels
                .filter((c) => !c.disabled || draft.channelIds.includes(c.id))
                .map((c) => {
                  const on = draft.channelIds.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      className={`sc-pick ${on ? "on" : "off"}`}
                      title={`${c.displayName} · ${c.handle}${c.stub ? " (keys only — cannot publish yet)" : ""}`}
                      disabled={isPublished}
                      onClick={() =>
                        patch((p) => ({
                          ...p,
                          channelIds: on ? p.channelIds.filter((x) => x !== c.id) : [...p.channelIds, c.id],
                        }))
                      }
                    >
                      <Avatar channel={c} muted={!on} />
                      {on ? (
                        <span className="sc-pick-check">
                          <Check />
                        </span>
                      ) : null}
                    </button>
                  );
                })
            )}
            {channels.length ? (
              <button className="sc-icon-btn" title="Add channel" onClick={() => { closeComposer(); setAddChannelOpen(true); }}>
                <Plus />
              </button>
            ) : null}
            {selected.length ? (
              <span className="ml-auto text-[11.5px] text-muted">
                {selected.length} channel{selected.length === 1 ? "" : "s"}
                {warnings ? ` · ${warnings} note${warnings === 1 ? "" : "s"}` : ""}
              </span>
            ) : null}
          </div>

          {/* Global + per-channel tabs */}
          <Tabs.Root value={tab} onValueChange={setTab}>
            <Tabs.List className="sc-tabs">
              <Tabs.Trigger value="all" className="sc-tab">
                <Globe /> All channels
              </Tabs.Trigger>
              {selected.map((c) => {
                const own = issues[c.id] ?? [];
                const err = own.some((i) => i.level === "error");
                const warn = !err && own.length > 0;
                return (
                  <Tabs.Trigger key={c.id} value={c.id} className="sc-tab">
                    <Avatar channel={c} size="sm" />
                    {c.displayName}
                    {draft.overrides[c.id] ? <span className="text-[10px] text-accent">edited</span> : null}
                    {err ? <AlertTriangle className="err" /> : warn ? <Info className="warn" /> : null}
                  </Tabs.Trigger>
                );
              })}
            </Tabs.List>
          </Tabs.Root>

          {tab !== "all" ? (
            <div className="mx-4 mt-3 flex items-center gap-2 text-[12px] text-muted">
              {hasOverride ? (
                <>
                  <span>This channel has its own text.</span>
                  <button className="sc-btn ghost sm" onClick={resetOverride}>
                    <RotateCcw /> Use the global text
                  </button>
                </>
              ) : (
                <span>Edit here to give this channel its own version — the other channels keep the global text.</span>
              )}
            </div>
          ) : null}

          {needsTitle || editing.title ? (
            <div className="mx-4 mt-3">
              <input className="sc-field" placeholder="Title (articles, pins, Reddit)" value={editing.title ?? ""} onChange={(e) => setEditing({ title: e.target.value })} />
            </div>
          ) : null}

          <div className="mt-3">
            <Editor
              value={editing.text}
              onChange={(text) => setEditing({ text })}
              placeholder={tab === "all" ? "What do you want to say? Links, #hashtags and @mentions are recognised as you type." : `Text for ${selected.find((c) => c.id === tab)?.displayName ?? "this channel"}…`}
              counter={counter}
              autoFocus
              onAddMedia={() => setPickerOpen(true)}
              onAddThread={threadsPossible ? () => setEditing({ thread: [...editing.thread, { text: "", media: [] }] }) : undefined}
              ai={ai}
              unicode={showUnicode}
            />
          </div>
          <MediaStrip refs={editing.media} onChange={(refs) => setEditing({ media: refs })} pickerOpen={pickerOpen} onPickerOpenChange={setPickerOpen} />
          {editing.thread.length ? <ThreadParts parts={editing.thread} onChange={(thread) => setEditing({ thread })} counter={counter} /> : null}
          <IssueList issues={tab === "all" ? Object.values(issues).flat().filter((i, n, arr) => arr.findIndex((x) => x.message === i.message) === n) : (issues[tab] ?? [])} />
          {draft.source === "agent" ? <div className="mx-4 mt-3 text-[11.5px] text-muted">Created by an agent over the local API.</div> : null}
          <div className="h-6" />
        </div>

        <div className="sc-composer-right">
          <div className="sc-preview-head">
            Post preview
            {selected.length > MAX_PREVIEWS && tab === "all" ? <span className="ml-auto normal-case tracking-normal">first {MAX_PREVIEWS} of {selected.length}</span> : null}
          </div>
          <div className="sc-preview-body sc-scroll">
            {previewChannels.length === 0 ? (
              <div className="rounded-[12px] border border-dashed border-line p-6 text-center text-[12px] text-muted">
                Pick a channel to see how the post will look there.
              </div>
            ) : (
              previewChannels.map((c) => <NetworkPreview key={c.id} channel={c} content={finalContent(draft, c)} mediaById={lookup} />)
            )}
          </div>
        </div>
      </div>
    </Dialog>
  );
}
