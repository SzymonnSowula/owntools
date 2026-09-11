import { AppWindow, Plus, Trash2 } from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import { Card, Switch } from "../components";
import {
  createProfile,
  describeProfile,
  PROFILE_MODES,
  removeProfile,
  STARTER_PROFILES,
  upsertProfile,
  type AppProfile,
  type ProfileMode,
} from "../profiles";
import { useDictationSettings } from "../useSettings";

/**
 * Settings → Per-app profiles: which application gets which finishing. One
 * row per profile, edited in place; a form to add one; starter chips when
 * the list is empty.
 */
export function ProfilesCard() {
  const [settings, update] = useDictationSettings();
  const [pattern, setPattern] = useState("");
  const [mode, setMode] = useState<ProfileMode>("plain");
  const [fillers, setFillers] = useState(false);
  const [send, setSend] = useState(false);

  const profiles = settings.profiles;

  function save(next: AppProfile[]) {
    update({ profiles: next });
  }

  function add() {
    const profile = createProfile(pattern, {
      mode: mode === "plain" ? undefined : mode,
      removeFillers: fillers ? true : undefined,
      autoSend: send || undefined,
    });
    if (!profile) return;
    save(upsertProfile(profiles, profile));
    setPattern("");
    setMode("plain");
    setFillers(false);
    setSend(false);
  }

  function patch(id: string, changes: Partial<AppProfile>) {
    const current = profiles.find((p) => p.id === id);
    if (!current) return;
    const next: AppProfile = { ...current, ...changes };
    if (next.mode === "plain") delete next.mode;
    if (next.removeFillers !== true) delete next.removeFillers;
    if (next.autoSend !== true) delete next.autoSend;
    save(upsertProfile(profiles, next));
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      add();
    }
  }

  return (
    <Card
      title="Per-app profiles"
      desc="How a take is finished depends on the app it is going to. Matched by the window in front when you press the shortcut."
      flush
    >
      {profiles.length ? (
        <div className="dt-profiles">
          <div className="dt-list-head">
            <span>app</span>
            <span>tone · fillers · Enter</span>
          </div>
          {profiles.map((p) => (
            <div key={p.id} className="dt-profile">
              <div className="dt-profile-main">
                <input
                  className="dt-input"
                  aria-label="App pattern"
                  value={p.appPattern}
                  onChange={(e) => patch(p.id, { appPattern: e.target.value })}
                  onBlur={(e) => {
                    if (!e.target.value.trim()) save(removeProfile(profiles, p.id));
                  }}
                />
                <div className="dt-row-hint">{describeProfile(p)}</div>
              </div>
              <select
                className="dt-select"
                aria-label="Tone"
                value={p.mode ?? "plain"}
                onChange={(e) => patch(p.id, { mode: e.target.value as ProfileMode })}
              >
                {PROFILE_MODES.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
              <label className="dt-profile-flag">
                <Switch
                  label="Remove fillers in this app"
                  checked={p.removeFillers === true}
                  onCheckedChange={(v) => patch(p.id, { removeFillers: v })}
                />
                <span>fillers</span>
              </label>
              <label className="dt-profile-flag">
                <Switch
                  label="Press Enter after typing in this app"
                  checked={p.autoSend === true}
                  onCheckedChange={(v) => patch(p.id, { autoSend: v })}
                />
                <span>Enter</span>
              </label>
              <button
                className="dt-icon-btn danger"
                title="Remove profile"
                aria-label="Remove profile"
                onClick={() => save(removeProfile(profiles, p.id))}
              >
                <Trash2 />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="dt-empty" style={{ padding: "22px 24px 18px" }}>
          <div className="dt-empty-icon">
            <AppWindow />
          </div>
          <div className="dt-empty-title">No profiles yet</div>
          <p className="dt-empty-text">
            Without one, every app gets the same take. A profile can strip fillers for chat, ask the language model
            for an e-mail tone, or press Enter for you.
          </p>
          <div className="dt-chips">
            {STARTER_PROFILES.map((s) => (
              <button
                key={s.label}
                className="dt-chip"
                onClick={() => {
                  const profile = createProfile(s.profile.appPattern, s.profile);
                  if (profile) save(upsertProfile(profiles, profile));
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="dt-import">
        <div className="dt-profile-form">
          <div>
            <label className="dt-field-label" htmlFor="dt-profile-pattern">
              App — part of the process name or window title; * and ? for a pattern
            </label>
            <input
              id="dt-profile-pattern"
              className="dt-input"
              placeholder="slack, outlook, code*, Inbox"
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              onKeyDown={onKey}
            />
          </div>
          <div>
            <label className="dt-field-label" htmlFor="dt-profile-mode">
              Tone
            </label>
            <select
              id="dt-profile-mode"
              className="dt-select"
              style={{ width: "100%" }}
              value={mode}
              onChange={(e) => setMode(e.target.value as ProfileMode)}
            >
              {PROFILE_MODES.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="dt-vocab-foot">
          <div className="dt-profile-flags">
            <label className="dt-profile-flag">
              <Switch label="Remove fillers" checked={fillers} onCheckedChange={setFillers} />
              <span>remove fillers</span>
            </label>
            <label className="dt-profile-flag">
              <Switch label="Press Enter after typing" checked={send} onCheckedChange={setSend} />
              <span>press Enter after typing</span>
            </label>
          </div>
          <div className="dt-vocab-foot-actions">
            <button className="dt-btn primary sm" disabled={!pattern.trim()} onClick={add}>
              <Plus /> Add profile
            </button>
          </div>
        </div>
        <p className="dt-note">
          {PROFILE_MODES.find((m) => m.id === mode)?.hint}
          {mode !== "plain"
            ? " A tone needs a language model (Settings → Intelligence); without one the words are typed as said and History notes it."
            : ""}
        </p>
      </div>
    </Card>
  );
}
