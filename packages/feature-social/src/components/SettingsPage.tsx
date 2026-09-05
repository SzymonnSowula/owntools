import { Check, FolderOpen, Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { isTauri } from "@core/env";
import { logError } from "@core/errors";
import { DEFAULT_MODELS, aiConfigured, complete } from "../ai";
import { TAG_COLORS } from "../model";
import { useSocialStore } from "../store";
import type { AiSettings } from "../types";
import { Field, Switch } from "./primitives";

export function SettingsPage() {
  const settings = useSocialStore((s) => s.settings);
  const saveSettings = useSocialStore((s) => s.saveSettings);
  const tags = useSocialStore((s) => s.tags);
  const addTag = useSocialStore((s) => s.addTag);
  const updateTag = useSocialStore((s) => s.updateTag);
  const removeTag = useSocialStore((s) => s.removeTag);
  const storage = useSocialStore((s) => s.storage);
  const toast = useSocialStore((s) => s.toast);
  const [ai, setAi] = useState<AiSettings>(settings.ai);
  const [testing, setTesting] = useState(false);
  const [root, setRoot] = useState<string | null>(null);
  const [newTag, setNewTag] = useState("");

  useEffect(() => setAi(settings.ai), [settings.ai]);
  useEffect(() => {
    void storage.rootPath().then(setRoot);
  }, [storage]);

  const saveAi = () => {
    void saveSettings({ ai }).then(() => toast({ kind: "success", title: "AI settings saved" }));
  };

  const testAi = async () => {
    setTesting(true);
    try {
      const out = await complete(ai, "Answer with one short word.", "Say hello.", 32);
      toast({ kind: "success", title: "The model answered", body: out.slice(0, 80) });
    } catch (err) {
      logError("social", "ai test", err);
      toast({ kind: "error", title: "AI test failed", body: err instanceof Error ? err.message : String(err) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="sc-main">
      <div className="sc-toolbar">
        <div className="sc-toolbar-title">settings</div>
      </div>
      <div className="sc-content sc-desk sc-scroll">
        <div className="mx-auto grid max-w-[980px] gap-5 p-6 lg:grid-cols-2">
          <div className="sc-card">
            <div className="sc-card-head">
              <span className="sc-card-title">Calendar</span>
            </div>
            <div className="sc-card-body flex flex-col gap-4">
              <Field label="Week starts on">
                <select className="sc-field" value={settings.weekStart} onChange={(e) => void saveSettings({ weekStart: Number(e.target.value) === 0 ? 0 : 1 })}>
                  <option value={1}>Monday</option>
                  <option value={0}>Sunday</option>
                </select>
              </Field>
              <Field label="Default posting time" hint="Used when a post is created from a day cell or a quick pick.">
                <input className="sc-field" type="time" value={settings.defaultTime} onChange={(e) => e.target.value && void saveSettings({ defaultTime: e.target.value })} />
              </Field>
              <Field label="Late tolerance (minutes)" hint="A post due longer ago than this waits for the catch-up sheet instead of going out on its own.">
                <input
                  className="sc-field"
                  type="number"
                  min={1}
                  max={720}
                  value={settings.lateToleranceMinutes}
                  onChange={(e) => void saveSettings({ lateToleranceMinutes: Math.min(720, Math.max(1, Number(e.target.value) || 10)) })}
                />
              </Field>
              <label className="flex items-center justify-between gap-3 text-[13px]">
                <span>
                  Notifications
                  <span className="block text-[11.5px] text-muted">A system notification when a post goes out or fails.</span>
                </span>
                <Switch checked={settings.notifications} onCheckedChange={(v) => void saveSettings({ notifications: v })} />
              </label>
              <div className="text-[11.5px] text-muted">Times are kept in {settings.timezone}.</div>
            </div>
          </div>

          <div className="sc-card">
            <div className="sc-card-head">
              <Sparkles className="h-4 w-4 text-muted" />
              <span className="sc-card-title">AI in the composer</span>
              <span className={`sc-status ml-auto ${aiConfigured(settings.ai) ? "ok" : ""}`}>
                <span className="sc-status-dot" /> {aiConfigured(settings.ai) ? "configured" : "off"}
              </span>
            </div>
            <div className="sc-card-body flex flex-col gap-4">
              <p className="text-[12.5px] leading-5 text-muted">
                Optional. Nothing leaves this machine unless you add a key here; then only the text you ask to rewrite is sent, straight to the provider.
              </p>
              <Field label="Provider">
                <select className="sc-field" value={ai.provider} onChange={(e) => setAi((a) => ({ ...a, provider: e.target.value as AiSettings["provider"] }))}>
                  <option value="none">Off</option>
                  <option value="anthropic">Anthropic (Claude)</option>
                  <option value="openai">OpenAI-compatible (OpenAI, Ollama, LM Studio, OpenRouter…)</option>
                </select>
              </Field>
              {ai.provider === "openai" ? (
                <Field label="Base URL" hint="Ollama: http://localhost:11434/v1 · LM Studio: http://localhost:1234/v1">
                  <input className="sc-field" value={ai.baseUrl} onChange={(e) => setAi((a) => ({ ...a, baseUrl: e.target.value }))} />
                </Field>
              ) : null}
              {ai.provider !== "none" ? (
                <>
                  <Field label="Model" hint={`Default: ${DEFAULT_MODELS[ai.provider]}`}>
                    <input className="sc-field" value={ai.model} placeholder={DEFAULT_MODELS[ai.provider]} onChange={(e) => setAi((a) => ({ ...a, model: e.target.value }))} />
                  </Field>
                  <Field label="API key" hint="Stored in settings.json on this device.">
                    <input className="sc-field" type="password" value={ai.apiKey} autoComplete="off" onChange={(e) => setAi((a) => ({ ...a, apiKey: e.target.value }))} />
                  </Field>
                </>
              ) : null}
              <div className="flex gap-2">
                <button className="sc-btn primary" onClick={saveAi}>
                  <Check /> Save
                </button>
                {ai.provider !== "none" ? (
                  <button className="sc-btn" onClick={() => void testAi()} disabled={testing || !aiConfigured(ai) || !isTauri()} title={!isTauri() ? "Desktop app only" : undefined}>
                    {testing ? <Loader2 className="animate-spin" /> : null} Test
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          <div className="sc-card">
            <div className="sc-card-head">
              <span className="sc-card-title">Tags</span>
            </div>
            <div className="sc-card-body flex flex-col gap-2">
              {tags.map((t) => (
                <div key={t.id} className="flex items-center gap-2">
                  <div className="flex gap-1">
                    {TAG_COLORS.map((c) => (
                      <button
                        key={c}
                        className="h-4 w-4 rounded-full"
                        style={{ background: c, outline: c === t.color ? `2px solid ${c}` : "none", outlineOffset: 2 }}
                        aria-label={`Colour ${c}`}
                        onClick={() => void updateTag(t.id, { color: c })}
                      />
                    ))}
                  </div>
                  <input className="sc-field !h-8 flex-1" defaultValue={t.name} onBlur={(e) => e.target.value.trim() && e.target.value !== t.name && void updateTag(t.id, { name: e.target.value.trim() })} />
                  <button className="sc-icon-btn" aria-label="Delete tag" onClick={() => void removeTag(t.id)}>
                    <Trash2 />
                  </button>
                </div>
              ))}
              <div className="flex gap-2">
                <input
                  className="sc-field !h-8 flex-1"
                  placeholder="New tag"
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newTag.trim()) {
                      void addTag(newTag);
                      setNewTag("");
                    }
                  }}
                />
                <button
                  className="sc-btn sm"
                  disabled={!newTag.trim()}
                  onClick={() => {
                    void addTag(newTag);
                    setNewTag("");
                  }}
                >
                  <Plus /> Add
                </button>
              </div>
            </div>
          </div>

          <div className="sc-card">
            <div className="sc-card-head">
              <span className="sc-card-title">Your data</span>
            </div>
            <div className="sc-card-body flex flex-col gap-3 text-[12.5px] leading-5 text-muted">
              <p>
                Channels, secrets, posts and media are plain files{root ? <> in <code className="text-ink">{root}</code></> : " in the app's data folder"}. Back them up like any other folder; delete the folder to start over.
              </p>
              {isTauri() ? (
                <button className="sc-btn self-start" onClick={() => void storage.reveal()}>
                  <FolderOpen /> Open the social folder
                </button>
              ) : (
                <p>In the browser preview the same files live in IndexedDB, and networks are simulated.</p>
              )}
              <Field label="Unsplash access key" hint="Optional — enables photo search in the media designer. Leave empty to keep it hidden.">
                <input className="sc-field" type="password" defaultValue={settings.unsplashKey} autoComplete="off" onBlur={(e) => e.target.value !== settings.unsplashKey && void saveSettings({ unsplashKey: e.target.value.trim() })} />
              </Field>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
