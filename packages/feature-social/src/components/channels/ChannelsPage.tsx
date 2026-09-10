import { confirmDialog } from "@ui/Dialog";
import { FolderInput, Loader2, MoreHorizontal, Plug, Plus, RefreshCw, Settings2, Trash2 } from "lucide-react";
import { useState } from "react";
import { logError } from "@core/errors";
import { AVAILABILITY_LABEL, networkById } from "../../networks";
import { providerFor } from "../../providers";
import { networkAvailable } from "../../providers/http";
import { useSocialStore } from "../../store";
import type { Channel, ChannelPreferences } from "../../types";
import { useUi } from "../../ui";
import { Avatar } from "../Avatar";
import { Dialog, EmptyState, Field, Menu, Switch } from "../primitives";

/**
 * Connected channels, grouped by collection. Enable / disable, per-channel
 * preferences (signature, limits, network specifics), a connection test
 * and disconnect.
 */

function PreferencesDialog({ channel, onClose }: { channel: Channel; onClose: () => void }) {
  const updateChannel = useSocialStore((s) => s.updateChannel);
  const [prefs, setPrefs] = useState<ChannelPreferences>({ ...channel.preferences });
  const [name, setName] = useState(channel.displayName);
  const net = networkById(channel.provider);
  const set = (patch: Partial<ChannelPreferences>) => setPrefs((p) => ({ ...p, ...patch }));
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={`${channel.displayName.toLowerCase()} · preferences`}
      description="Per-channel preferences."
      footer={
        <>
          <button className="sc-btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="sc-btn primary ml-auto"
            onClick={() => {
              const clean: ChannelPreferences = {};
              if (prefs.signature?.trim()) clean.signature = prefs.signature.trim();
              if (prefs.charLimit && prefs.charLimit > 0) clean.charLimit = Math.round(prefs.charLimit);
              if (prefs.visibility) clean.visibility = prefs.visibility;
              if (prefs.parseMode) clean.parseMode = prefs.parseMode;
              if (prefs.publishAsDraft !== undefined) clean.publishAsDraft = prefs.publishAsDraft;
              if (prefs.defaultTags?.length) clean.defaultTags = prefs.defaultTags;
              void updateChannel(channel.id, { preferences: clean, displayName: name.trim() || channel.displayName });
              onClose();
            }}
          >
            Save
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4 p-5">
        <Field label="Name shown in owntools">
          <input className="sc-field" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Signature" hint="Appended after a blank line to every post on this channel. Leave empty for none.">
          <textarea className="sc-field" rows={2} value={prefs.signature ?? ""} onChange={(e) => set({ signature: e.target.value })} placeholder="— posted with owntools" />
        </Field>
        <Field label="Character limit" hint={`${net.name} default: ${Number.isFinite(net.limits.chars) ? net.limits.chars : "none"}. Override for instances or accounts with a different limit.`}>
          <input
            className="sc-field"
            type="number"
            min={1}
            placeholder={Number.isFinite(net.limits.chars) ? String(net.limits.chars) : "unlimited"}
            value={prefs.charLimit ?? ""}
            onChange={(e) => set({ charLimit: e.target.value ? Number(e.target.value) : undefined })}
          />
        </Field>
        {net.id === "mastodon" ? (
          <Field label="Visibility">
            <select className="sc-field" value={prefs.visibility ?? "public"} onChange={(e) => set({ visibility: e.target.value as ChannelPreferences["visibility"] })}>
              <option value="public">Public</option>
              <option value="unlisted">Unlisted</option>
              <option value="private">Followers only</option>
            </select>
          </Field>
        ) : null}
        {net.id === "telegram" ? (
          <Field label="Text formatting" hint="Plain text is safest; HTML or MarkdownV2 need the special characters escaped by you.">
            <select className="sc-field" value={prefs.parseMode ?? "none"} onChange={(e) => set({ parseMode: e.target.value as ChannelPreferences["parseMode"] })}>
              <option value="none">Plain text</option>
              <option value="HTML">HTML</option>
              <option value="MarkdownV2">MarkdownV2</option>
            </select>
          </Field>
        ) : null}
        {net.id === "devto" || net.id === "medium" ? (
          <>
            <label className="flex items-center justify-between gap-3 text-[13px]">
              <span>Publish as a draft first</span>
              <Switch checked={Boolean(prefs.publishAsDraft)} onCheckedChange={(v) => set({ publishAsDraft: v })} />
            </label>
            <Field label="Default tags" hint="Comma-separated; Dev.to takes up to four.">
              <input
                className="sc-field"
                value={(prefs.defaultTags ?? []).join(", ")}
                onChange={(e) => set({ defaultTags: e.target.value.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean) })}
                placeholder="webdev, productivity"
              />
            </Field>
          </>
        ) : null}
      </div>
    </Dialog>
  );
}

function MoveDialog({ channel, onClose }: { channel: Channel; onClose: () => void }) {
  const collections = useSocialStore((s) => s.collections);
  const updateChannel = useSocialStore((s) => s.updateChannel);
  const [value, setValue] = useState(channel.collection);
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="move to collection"
      description="Move the channel to another collection."
      footer={
        <button
          className="sc-btn primary ml-auto"
          onClick={() => {
            void updateChannel(channel.id, { collection: value.trim() || "Personal" });
            onClose();
          }}
        >
          Move
        </button>
      }
    >
      <div className="p-5">
        <Field label="Collection" hint="Type a new name to create one.">
          <input className="sc-field" list="sc-collections-move" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
          <datalist id="sc-collections-move">
            {collections.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
      </div>
    </Dialog>
  );
}

function ChannelRow({ channel }: { channel: Channel }) {
  const updateChannel = useSocialStore((s) => s.updateChannel);
  const removeChannel = useSocialStore((s) => s.removeChannel);
  const credentials = useSocialStore((s) => s.credentials);
  const settings = useSocialStore((s) => s.settings);
  const posts = useSocialStore((s) => s.posts);
  const toast = useSocialStore((s) => s.toast);
  const [dialog, setDialog] = useState<"prefs" | "move" | null>(null);
  const [testing, setTesting] = useState(false);
  const net = networkById(channel.provider);
  const count = posts.filter((p) => p.channelIds.includes(channel.id) && p.status !== "cancelled").length;
  const published = posts.filter((p) => p.results[channel.id]?.status === "ok").length;
  const provider = providerFor(channel.provider, settings.simulate || !networkAvailable());
  const simulated = channel.meta.simulated === "true";

  const test = async () => {
    if (!provider.verify) {
      toast({ kind: "info", title: "No test for this network", body: "Webhook networks only answer when a message is sent." });
      return;
    }
    setTesting(true);
    try {
      const r = await provider.verify(channel, credentials[channel.id] ?? {});
      toast({ kind: r.ok ? "success" : "error", title: r.ok ? "Connection works" : "Connection failed", body: r.message });
    } catch (err) {
      logError("social", "verify", err);
      toast({ kind: "error", title: "Connection failed", body: err instanceof Error ? err.message : String(err) });
    } finally {
      setTesting(false);
    }
  };

  const disconnect = async () => {
    const message = `Disconnect ${channel.displayName}? Its keys are deleted from this device; posts that mention it keep their history.`;
    const ok = await confirmDialog({ title: "Disconnect channel", message, kind: "danger", okLabel: "Disconnect", cancelLabel: "Keep" });
    if (!ok) return;
    await removeChannel(channel.id);
    toast({ kind: "info", title: `${channel.displayName} disconnected` });
  };

  return (
    <div className={`flex items-center gap-3 px-4 py-3 ${channel.disabled ? "opacity-60" : ""}`}>
      <Avatar channel={channel} size="lg" muted={channel.disabled} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13.5px] font-semibold">{channel.displayName}</span>
          <span className={`sc-pill ${simulated ? "sim" : channel.stub ? "byo" : "live"}`}>{simulated ? "simulated" : channel.stub ? "keys only" : AVAILABILITY_LABEL[net.availability] === "live" ? "live" : "connected"}</span>
        </div>
        <div className="truncate text-[12px] text-muted">
          {net.name} · {channel.handle}
          {count ? ` · ${count} post${count === 1 ? "" : "s"}` : ""}
          {published ? ` · ${published} published` : ""}
          {channel.preferences.signature ? " · signature" : ""}
        </div>
      </div>
      <Switch checked={!channel.disabled} onCheckedChange={(v) => void updateChannel(channel.id, { disabled: !v })} label="Enabled" />
      <Menu
        trigger={
          <button className="sc-icon-btn" aria-label="Channel menu">
            {testing ? <Loader2 className="animate-spin" /> : <MoreHorizontal />}
          </button>
        }
        items={[
          { key: "prefs", label: "Preferences…", icon: <Settings2 />, onSelect: () => setDialog("prefs") },
          { key: "test", label: "Test connection", icon: <RefreshCw />, onSelect: () => void test(), disabled: channel.stub || simulated },
          { key: "move", label: "Move to collection…", icon: <FolderInput />, onSelect: () => setDialog("move") },
          { key: "remove", label: "Disconnect", icon: <Trash2 />, danger: true, sepBefore: true, onSelect: () => void disconnect() },
        ]}
      />
      {dialog === "prefs" ? <PreferencesDialog channel={channel} onClose={() => setDialog(null)} /> : null}
      {dialog === "move" ? <MoveDialog channel={channel} onClose={() => setDialog(null)} /> : null}
    </div>
  );
}

export function ChannelsPage() {
  const channels = useSocialStore((s) => s.channels);
  const collections = useSocialStore((s) => s.collections);
  const renameCollection = useSocialStore((s) => s.renameCollection);
  const setAddChannelOpen = useUi((s) => s.setAddChannelOpen);
  const [renaming, setRenaming] = useState<{ from: string; to: string } | null>(null);

  return (
    <div className="sc-main">
      <div className="sc-toolbar">
        <div className="sc-toolbar-title">channels</div>
        <span className="text-[12px] text-muted">
          {channels.length} connected · {channels.filter((c) => !c.disabled).length} active
        </span>
        <button className="sc-btn primary ml-auto" onClick={() => setAddChannelOpen(true)}>
          <Plus /> Add channel
        </button>
      </div>
      <div className="sc-content sc-desk sc-scroll">
        {channels.length === 0 ? (
          <div className="grid h-full place-items-center p-6">
            <div className="sc-card max-w-[460px]">
              <EmptyState
                icon={<Plug />}
                title="no channels yet"
                action={
                  <button className="sc-btn primary" onClick={() => setAddChannelOpen(true)}>
                    <Plus /> Add channel
                  </button>
                }
              >
                Paste whatever you have — a Discord or Slack webhook URL, a Telegram bot token, a Bluesky app password, a @you@instance address — and owntools works out which network it is. Bluesky, Mastodon, Telegram, Discord, Slack, Dev.to and Medium take a minute or two; X and LinkedIn need your own developer app. Keys never leave this device.
              </EmptyState>
            </div>
          </div>
        ) : (
          <div className="mx-auto flex max-w-[820px] flex-col gap-5 p-6">
            {collections.map((col) => {
              const own = channels.filter((c) => c.collection === col);
              if (!own.length) return null;
              return (
                <div key={col} className="sc-card">
                  <div className="sc-card-head">
                    {renaming?.from === col ? (
                      <input
                        className="sc-field !h-8 max-w-[240px]"
                        autoFocus
                        value={renaming.to}
                        onChange={(e) => setRenaming({ from: col, to: e.target.value })}
                        onBlur={() => {
                          if (renaming.to.trim() && renaming.to !== col) void renameCollection(col, renaming.to);
                          setRenaming(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          if (e.key === "Escape") setRenaming(null);
                        }}
                      />
                    ) : (
                      <button className="sc-card-title hover:text-accent" onClick={() => setRenaming({ from: col, to: col })} title="Rename collection">
                        {col}
                      </button>
                    )}
                    <span className="ml-auto text-[12px] text-muted">
                      {own.length} channel{own.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="divide-y divide-line">
                    {own.map((c) => (
                      <ChannelRow key={c.id} channel={c} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
