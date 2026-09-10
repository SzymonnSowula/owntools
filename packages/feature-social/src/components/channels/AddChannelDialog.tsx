import { ArrowLeft, Check, ClipboardPaste, Copy, ExternalLink, Loader2, Search, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { logError } from "@core/errors";
import { detectPaste, missingFields, type PasteMatch } from "../../connect";
import { effortLabel, guideFor, type SetupGuide } from "../../guides";
import { AVAILABILITY_LABEL, NETWORKS, countByAvailability, networkById, type NetworkDef } from "../../networks";
import { NeedsCode, ProviderError, providerFor } from "../../providers";
import { DESKTOP_ONLY, fetchBytes, networkAvailable } from "../../providers/http";
import { agentInfo } from "../../providers/oauth";
import { discoverChats, type TelegramChat } from "../../providers/telegram";
import { useSocialStore } from "../../store";
import type { NetworkAvailability } from "../../types";
import { useUi } from "../../ui";
import { openExternal } from "../Toasts";
import { NetworkIcon, badgeColor } from "../NetworkIcon";
import { Dialog, Field, copyText } from "../primitives";

/**
 * "Add channel": paste whatever you have and we work out the network, or
 * pick one from the catalogue and follow the steps. Live networks connect
 * for real; "bring your own app" networks without an adapter yet store the
 * keys and mark the channel as a stub; "coming soon" ones are listed but
 * not clickable.
 */

type FilterKey = "all" | NetworkAvailability;

/** Live first, then bring-your-own, then coming soon — easiest at the top. */
const ORDER: Record<NetworkAvailability, number> = { live: 0, byo: 1, soon: 2 };

function CopyChip({ label, value }: { label: string; value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="sc-copy-chip"
      onClick={() => {
        void copyText(value).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        });
      }}
      title={value}
    >
      {done ? <Check /> : <Copy />}
      <span className="sc-copy-chip-label">{label}</span>
      <code>{value}</code>
    </button>
  );
}

function Steps({ guide }: { guide: SetupGuide }) {
  return (
    <ol className="sc-steps">
      {guide.steps.map((s, i) => (
        <li key={i}>
          <span className="sc-step-n">{i + 1}</span>
          <div className="sc-step-body">
            <span>{s.text}</span>
            {s.copy ? <CopyChip label={s.copy.label} value={s.copy.value} /> : null}
            {s.link ? (
              <button className="sc-btn ghost sm mt-1.5" onClick={() => void openExternal(s.link!.url)}>
                <ExternalLink /> {s.link.label}
              </button>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** The one box that replaces "which network is this token from?". */
function PasteBox({ onPick }: { onPick: (match: PasteMatch) => void }) {
  const [text, setText] = useState("");
  const match = useMemo(() => (text.trim() ? detectPaste(text) : null), [text]);
  const net = match ? networkById(match.network) : null;
  return (
    <div className="sc-paste">
      <div className="sc-paste-head">
        <ClipboardPaste className="h-4 w-4 text-accent" />
        <span>Paste anything</span>
        <span className="sc-paste-hint">a webhook URL, a bot token, an app password, a handle — we work out the rest</span>
      </div>
      <textarea
        className="sc-field sc-paste-input"
        rows={2}
        value={text}
        autoFocus
        spellCheck={false}
        placeholder="https://discord.com/api/webhooks/…    ·    123456789:AA…    ·    @you@mastodon.social"
        onChange={(e) => setText(e.target.value)}
      />
      {match && net ? (
        // A network we have not built yet is still worth naming — it just
        // does not get a form the catalogue would refuse to open.
        <button className="sc-paste-hit" onClick={() => onPick(match)} disabled={net.availability === "soon"}>
          <span className="sc-net-icon" style={{ background: badgeColor(net.id) }}>
            <NetworkIcon id={net.id} />
          </span>
          <span className="sc-paste-hit-text">
            <strong>That is {match.what}.</strong>
            <span>
              {net.availability === "soon"
                ? `${net.name} is on the way — not connectable yet.`
                : `${match.confidence === "exact" ? `Ready to connect ${net.name}` : `Opens the ${net.name} form with what we could read`} →`}
            </span>
          </span>
          {net.availability === "soon" ? null : <Sparkles className="ml-auto h-4 w-4 text-accent" />}
        </button>
      ) : text.trim().length > 6 ? (
        <div className="sc-paste-miss">Not something we recognise yet — pick the network below instead.</div>
      ) : null}
    </div>
  );
}

/** Telegram only: the bot's recent chats, so nobody hunts for a numeric id. */
function ChatFinder({ token, onPick }: { token: string; onPick: (chat: TelegramChat) => void }) {
  const [busy, setBusy] = useState(false);
  const [chats, setChats] = useState<TelegramChat[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const find = async () => {
    setBusy(true);
    setError(null);
    try {
      setChats(await discoverChats(token));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-1.5">
      <button className="sc-btn sm" disabled={!token.trim() || busy} onClick={() => void find()}>
        {busy ? <Loader2 className="animate-spin" /> : <Search />} Find my chats
      </button>
      {chats?.length ? (
        <div className="sc-chat-list">
          {chats.map((c) => (
            <button key={c.id} className="sc-chat" onClick={() => onPick(c)}>
              <span className="font-semibold">{c.title}</span>
              <span className="text-muted">{c.username ? `@${c.username}` : c.type}</span>
            </button>
          ))}
        </div>
      ) : chats ? (
        <div className="sc-hint mt-1.5">
          Nothing yet. Add the bot to the channel as an administrator (or send it a message), then press it again.
        </div>
      ) : null}
      {error ? <div className="sc-issue error mt-2"><span>{error}</span></div> : null}
    </div>
  );
}

export function AddChannelDialog() {
  const open = useUi((s) => s.addChannelOpen);
  const setOpen = useUi((s) => s.setAddChannelOpen);
  const settings = useSocialStore((s) => s.settings);
  const collections = useSocialStore((s) => s.collections);
  const addChannel = useSocialStore((s) => s.addChannel);
  const toast = useSocialStore((s) => s.toast);

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [picked, setPicked] = useState<NetworkDef | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [collection, setCollection] = useState(collections[0] ?? "Personal");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [authorizeUrl, setAuthorizeUrl] = useState<string | null>(null);
  const [redirect, setRedirect] = useState<string | null>(null);

  const simulate = settings.simulate || !networkAvailable();

  useEffect(() => {
    if (!open) {
      setPicked(null);
      setValues({});
      setError(null);
      setProgress(null);
      setAuthorizeUrl(null);
      setBusy(false);
    }
  }, [open]);

  useEffect(() => {
    void agentInfo().then((info) => setRedirect(info ? `http://127.0.0.1:${info.port}/oauth/callback` : null));
  }, [open]);

  const counts = useMemo(countByAvailability, []);
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return NETWORKS.filter((n) => (filter === "all" || n.availability === filter) && (!q || n.name.toLowerCase().includes(q) || n.blurb.toLowerCase().includes(q))).sort(
      (a, b) => ORDER[a.availability] - ORDER[b.availability],
    );
  }, [query, filter]);

  const provider = picked ? providerFor(picked.id, simulate) : null;
  // Shown in the browser preview too: the steps describe the real network,
  // and the "simulated" pill next to the name says what this run will do.
  const guide = picked ? guideFor(picked.id, redirect) : null;

  const pickNetwork = (net: NetworkDef, prefill: Record<string, string> = {}) => {
    setPicked(net);
    setValues(prefill);
    setError(null);
    setAuthorizeUrl(null);
  };

  const connect = async () => {
    if (!picked || !provider) return;
    setBusy(true);
    setError(null);
    try {
      const out = await provider.connect({ ...values }, (m) => setProgress(m));
      let avatar: { bytes: Uint8Array; mime: string } | null = null;
      if (out.avatarUrl && networkAvailable()) avatar = await fetchBytes(out.avatarUrl);
      const ch = await addChannel({ ...out.channel, collection: collection.trim() || "Personal", disabled: false }, out.creds, avatar);
      toast({ kind: "success", title: `${ch.displayName} connected`, body: ch.stub ? "Keys saved. Publishing to this network is not wired up yet." : simulate ? "Simulated — nothing was sent." : undefined });
      setOpen(false);
    } catch (err) {
      if (err instanceof NeedsCode) {
        setValues((v) => ({ ...v, clientId: err.app.client_id, clientSecret: err.app.client_secret }));
        setAuthorizeUrl(err.url);
        setProgress(null);
        void openExternal(err.url);
        return;
      }
      logError("social", `connect ${picked.id}`, err);
      setError(err instanceof ProviderError || err instanceof Error ? err.message : String(err));
      setProgress(null);
    } finally {
      setBusy(false);
    }
  };

  const fields = provider?.fields ?? [];
  const visibleFields = fields.filter((f) => !(picked?.id === "mastodon" && f.key === "code" && !authorizeUrl));
  const required = fields.filter((f) => !f.optional && !(picked?.id === "mastodon" && f.key === "code"));
  const canSubmit = required.every((f) => values[f.key]?.trim()) && (!authorizeUrl || values.code?.trim());
  const stillNeeded = picked ? missingFields(values, required) : [];

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      size="medium"
      title={picked ? `connect ${picked.name.toLowerCase()}` : "add channel"}
      description="Choose a network and connect an account."
      headExtra={
        picked ? (
          <button className="sc-btn ghost sm" onClick={() => { setPicked(null); setError(null); setAuthorizeUrl(null); }}>
            <ArrowLeft /> All networks
          </button>
        ) : null
      }
      footer={
        picked ? (
          <>
            <span className="text-[12px] text-muted">
              {simulate
                ? "Browser preview: the connection is simulated."
                : stillNeeded.length
                  ? `Still needs: ${stillNeeded.join(", ")}.`
                  : picked.availability === "byo" && provider && !("verify" in provider)
                    ? "Keys are stored on this device; publishing arrives in a later build."
                    : "Secrets are stored in credentials.json on this device only."}
            </span>
            <div className="ml-auto flex items-center gap-2">
              {progress ? (
                <span className="flex items-center gap-2 text-[12px] text-muted">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> {progress}
                </span>
              ) : null}
              <button className="sc-btn primary" onClick={() => void connect()} disabled={busy || !canSubmit}>
                {busy ? <Loader2 className="animate-spin" /> : null}
                {authorizeUrl ? "Finish" : picked.auth === "oauth-pkce" && !simulate ? "Sign in with the browser" : "Connect"}
              </button>
            </div>
          </>
        ) : (
          <span className="text-[12px] text-muted">
            {counts.live} live · {counts.byo} bring your own app · {counts.soon} coming soon — every one publishes from this machine, nothing goes through an owntools server.
          </span>
        )
      }
    >
      {!picked ? (
        <>
          <div className="px-4 pt-4">
            <PasteBox onPick={(m) => pickNetwork(networkById(m.network), m.values)} />
          </div>
          <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input className="sc-field !pl-8" placeholder="Search networks" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            {(["all", "live", "byo", "soon"] as FilterKey[]).map((k) => (
              <button key={k} className={`sc-chip${filter === k ? " on" : ""}`} onClick={() => setFilter(k)}>
                {k === "all" ? "all" : AVAILABILITY_LABEL[k]}
              </button>
            ))}
          </div>
          <div className="sc-catalogue">
            {list.map((n) => {
              const g = guideFor(n.id, null);
              return (
                <button
                  key={n.id}
                  className="sc-net"
                  disabled={n.availability === "soon" && !simulate}
                  onClick={() => pickNetwork(n)}
                  title={n.availability === "soon" ? "Not available yet" : `Connect ${n.name}`}
                >
                  <div className="flex w-full items-center gap-2">
                    <span className="sc-net-icon" style={{ background: badgeColor(n.id) }}>
                      <NetworkIcon id={n.id} />
                    </span>
                    <span className="sc-net-name">{n.name}</span>
                    {g ? <span className="sc-net-time">{g.minutes} min</span> : null}
                  </div>
                  <span className="sc-net-blurb">{n.blurb}</span>
                  <span className={`sc-pill ${n.availability}`}>{AVAILABILITY_LABEL[n.availability]}</span>
                </button>
              );
            })}
            {list.length === 0 ? <div className="col-span-full py-8 text-center text-[12.5px] text-muted">No network matches “{query}”.</div> : null}
          </div>
        </>
      ) : (
        <div className="mx-auto max-w-[560px] px-5 py-5">
          <div className="mb-4 flex items-center gap-3">
            <span className="sc-net-icon !h-11 !w-11 !rounded-[12px]" style={{ background: badgeColor(picked.id) }}>
              <NetworkIcon id={picked.id} size={22} />
            </span>
            <div>
              <div className="flex items-center gap-2 text-[15px] font-bold">
                {picked.name}
                <span className={`sc-pill ${simulate ? "sim" : picked.availability}`}>{simulate ? "simulated" : AVAILABILITY_LABEL[picked.availability]}</span>
              </div>
              <div className="text-[12px] text-muted">
                {guide ? `${effortLabel(guide.minutes)} · you will paste ${guide.yields}` : picked.blurb}
              </div>
            </div>
          </div>
          {!networkAvailable() ? <div className="sc-issue warning mb-4"><span>{DESKTOP_ONLY} A demo channel will be created instead.</span></div> : null}
          {guide ? <Steps guide={guide} /> : picked.note && !simulate ? <div className="sc-issue warning mb-4"><span>{picked.note}</span></div> : null}
          {picked.auth === "oauth-pkce" && !simulate && !guide ? (
            <div className="mb-4 rounded-[12px] border border-line bg-paper p-3 text-[12px]">
              <div className="font-semibold">Redirect URL for your app</div>
              <div className="sc-token mt-1 select-all">{redirect ?? "starting the local server…"}</div>
              {picked.devPortal ? (
                <button className="sc-btn ghost sm mt-2" onClick={() => void openExternal(picked.devPortal!)}>
                  <ExternalLink /> Open the developer portal
                </button>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-col gap-3">
            {visibleFields.map((f) => (
              <Field key={f.key} label={`${f.label}${f.optional ? " (optional)" : ""}`} hint={f.hint}>
                <input
                  className="sc-field"
                  type={f.secret ? "password" : "text"}
                  placeholder={f.placeholder}
                  value={values[f.key] ?? ""}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && canSubmit && !busy) void connect();
                  }}
                />
                {picked.id === "telegram" && f.key === "chatId" && !simulate ? (
                  <ChatFinder
                    token={values.token ?? ""}
                    onPick={(c) => setValues((v) => ({ ...v, chatId: c.username ? `@${c.username}` : c.id }))}
                  />
                ) : null}
              </Field>
            ))}
            {authorizeUrl ? (
              <div className="sc-issue warning">
                <span>
                  A browser tab opened with the authorisation page. Approve owntools there, copy the code and paste it above.{" "}
                  <button className="font-semibold underline" onClick={() => void openExternal(authorizeUrl)}>
                    Open it again
                  </button>
                </span>
              </div>
            ) : null}
            <Field label="Collection" hint="Groups channels in the sidebar — Personal, Work, a client…">
              <input className="sc-field" list="sc-collections" value={collection} onChange={(e) => setCollection(e.target.value)} />
              <datalist id="sc-collections">
                {collections.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </Field>
            {error ? <div className="sc-issue error"><span>{error}</span></div> : null}
          </div>
        </div>
      )}
    </Dialog>
  );
}
