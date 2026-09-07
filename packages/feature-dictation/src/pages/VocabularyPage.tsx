import { ArrowRight, BookA, ClipboardPaste, Copy, Pencil, Search, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Card, copyToClipboard, Kbd, PageHead } from "../components";
import { useDictationSettings } from "../useSettings";
import {
  createEntry,
  entriesFromText,
  entriesToText,
  isReplacement,
  removeEntry,
  searchEntries,
  sortEntries,
  upsertEntry,
  type VocabularyEntry,
} from "../vocabulary";

/** Spellings to offer on an empty list — harmless, and they show the idea. */
const STARTERS: { spoken: string; replacement?: string }[] = [
  { spoken: "shipshape" },
  { spoken: "Claude Code" },
  { spoken: "Tauri" },
  { spoken: "super whisper", replacement: "Superwhisper" },
];

export function VocabularyPage() {
  const [settings, update] = useDictationSettings();
  const [query, setQuery] = useState("");
  const [spoken, setSpoken] = useState("");
  const [replacement, setReplacement] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [flash, setFlash] = useState<string | null>(null);
  const spokenRef = useRef<HTMLInputElement>(null);
  const flashTimer = useRef<number | null>(null);

  const entries = useMemo(() => sortEntries(settings.entries), [settings.entries]);
  const shown = useMemo(() => searchEntries(entries, query), [entries, query]);
  const rules = entries.filter(isReplacement).length;

  useEffect(
    () => () => {
      if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
    },
    [],
  );

  function say(text: string) {
    setFlash(text);
    if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 1800);
  }

  function reset() {
    setSpoken("");
    setReplacement("");
    setEditingId(null);
  }

  function submit() {
    const entry = createEntry(spoken, replacement);
    if (!entry) {
      spokenRef.current?.focus();
      return;
    }
    const next = editingId ? { ...entry, id: editingId } : entry;
    update({ entries: upsertEntry(settings.entries, next) });
    say(editingId ? "Saved." : isReplacement(next) ? "Replacement added." : "Spelling added.");
    reset();
    spokenRef.current?.focus();
  }

  function edit(entry: VocabularyEntry) {
    setEditingId(entry.id);
    setSpoken(entry.spoken);
    setReplacement(entry.replacement);
    spokenRef.current?.focus();
    spokenRef.current?.scrollIntoView({ block: "nearest" });
  }

  function remove(id: string) {
    update({ entries: removeEntry(settings.entries, id) });
    if (editingId === id) reset();
  }

  function addStarter(s: { spoken: string; replacement?: string }) {
    const entry = createEntry(s.spoken, s.replacement ?? "");
    if (entry) update({ entries: upsertEntry(settings.entries, entry) });
  }

  function runImport() {
    let list = settings.entries;
    const parsed = entriesFromText(importText);
    const stamp = Date.now();
    parsed.forEach((e, i) => {
      list = upsertEntry(list, { ...e, id: `i${stamp.toString(36)}${i.toString(36)}`, createdAt: stamp + i });
    });
    update({ entries: list });
    say(parsed.length ? `Imported ${parsed.length} ${parsed.length === 1 ? "entry" : "entries"}.` : "Nothing to import.");
    setImportText("");
    setImportOpen(false);
  }

  async function copyAll() {
    const ok = await copyToClipboard(entriesToText(entries));
    say(ok ? "List copied." : "Clipboard unavailable.");
  }

  function onEditorKey(e: KeyboardEvent<HTMLElement>) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape" && editingId) {
      e.preventDefault();
      reset();
    }
  }

  return (
    <div className="dt-page">
      <PageHead
        title="vocabulary"
        sub="Names, jargon and phrases whisper should know — and what to type when you say them. A word on its own fixes the spelling; add a replacement and saying the phrase types the text."
        actions={
          <>
            <button className="dt-btn ghost sm" onClick={() => void copyAll()} disabled={!entries.length} title="Copy the list as text">
              <Copy /> Copy
            </button>
            <button className="dt-btn ghost sm" onClick={() => setImportOpen((v) => !v)} title="Paste a list, one entry per line">
              <ClipboardPaste /> Import
            </button>
          </>
        }
      />

      <Card
        title={editingId ? "Edit entry" : "New entry"}
        desc={
          editingId
            ? "Change either side, then save."
            : "Word or phrase as you say it; optionally what should be typed instead."
        }
        action={flash ? <span className="dt-badge accent">{flash}</span> : null}
        flush
      >
        <div className={`dt-vocab-editor${editingId ? " editing" : ""}`} onKeyDown={onEditorKey}>
          <div>
            <label className="dt-field-label" htmlFor="dt-spoken">
              What you say
            </label>
            <input
              id="dt-spoken"
              ref={spokenRef}
              className="dt-input"
              placeholder="my email address"
              value={spoken}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setSpoken(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
                  e.preventDefault();
                  submit();
                }
              }}
            />
          </div>
          <div>
            <label className="dt-field-label" htmlFor="dt-replacement">
              Replace with <span style={{ fontWeight: 500, opacity: 0.7 }}>(optional)</span>
            </label>
            <textarea
              id="dt-replacement"
              className="dt-textarea"
              rows={2}
              placeholder="anna@shipshape.app"
              value={replacement}
              spellCheck={false}
              onChange={(e) => setReplacement(e.target.value)}
            />
          </div>
          <div className="dt-vocab-foot">
            <span className="dt-note">
              Leave it empty to only fix the spelling. A replacement is typed exactly as written — line
              breaks included, so a sign-off works too.
            </span>
            <div className="dt-vocab-foot-actions">
              {editingId ? (
                <button className="dt-btn" onClick={reset}>
                  Cancel
                </button>
              ) : null}
              <button className="dt-btn primary" onClick={submit} disabled={spoken.trim().length < 2}>
                {editingId ? "Save" : replacement.trim() ? "Add replacement" : "Add"}
                <Kbd>Ctrl ↵</Kbd>
              </button>
            </div>
          </div>
        </div>
        {importOpen ? (
          <div className="dt-import">
            <div>
              <label className="dt-field-label" htmlFor="dt-import">
                One entry per line — <code>word</code> or <code>phrase -&gt; replacement</code>
              </label>
              <textarea
                id="dt-import"
                className="dt-textarea"
                rows={4}
                placeholder={"Kubernetes\nmy email address -> anna@shipshape.app"}
                value={importText}
                spellCheck={false}
                onChange={(e) => setImportText(e.target.value)}
              />
            </div>
            <div className="dt-vocab-foot">
              <span className="dt-note">Existing entries with the same phrase are replaced.</span>
              <div className="dt-vocab-foot-actions">
                <button className="dt-btn" onClick={() => setImportOpen(false)}>
                  Cancel
                </button>
                <button className="dt-btn primary" onClick={runImport} disabled={!importText.trim()}>
                  Import
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </Card>

      <Card flush>
        <div className="dt-list-head">
          <span>
            {entries.length} {entries.length === 1 ? "entry" : "entries"}
            {rules ? ` · ${rules} ${rules === 1 ? "replacement" : "replacements"}` : ""}
          </span>
          <div className="dt-search" style={{ width: 240 }}>
            <Search />
            <input
              className="dt-input"
              style={{ padding: "6px 10px 6px 30px", fontSize: 12.5 }}
              placeholder="Search vocabulary"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search vocabulary"
            />
          </div>
        </div>

        {entries.length === 0 ? (
          <div className="dt-empty">
            <div className="dt-empty-icon">
              <BookA />
            </div>
            <div className="dt-empty-title">Nothing here yet</div>
            <p className="dt-empty-text">
              Add the names whisper keeps getting wrong, and the phrases you would rather not spell out
              — an address, a sign-off, a product name in its proper casing.
            </p>
            <div className="dt-chips">
              {STARTERS.map((s) => (
                <button key={s.spoken} className="dt-chip" onClick={() => addStarter(s)}>
                  {s.spoken}
                  {s.replacement ? (
                    <>
                      <span className="dt-chip-arrow">→</span>
                      {s.replacement}
                    </>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        ) : shown.length === 0 ? (
          <div className="dt-empty">
            <div className="dt-empty-title">No match for “{query.trim()}”</div>
          </div>
        ) : (
          shown.map((entry) => {
            const rule = isReplacement(entry);
            return (
              <div
                key={entry.id}
                className={`dt-entry${rule ? "" : " spelling"}${editingId === entry.id ? " editing" : ""}`}
                role="button"
                tabIndex={0}
                onClick={() => edit(entry)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") edit(entry);
                  if (e.key === "Delete") remove(entry.id);
                }}
              >
                <span className="dt-entry-spoken" title={entry.spoken}>
                  {entry.spoken}
                </span>
                {rule ? (
                  <>
                    <span className="dt-entry-arrow" aria-hidden>
                      <ArrowRight />
                    </span>
                    <span className="dt-entry-to" title={entry.replacement}>
                      {entry.replacement.replace(/\s*\n\s*/g, " ⏎ ")}
                    </span>
                  </>
                ) : null}
                <span className="dt-entry-actions" onClick={(e) => e.stopPropagation()}>
                  <button className="dt-icon-btn" title="Edit" aria-label="Edit" onClick={() => edit(entry)}>
                    <Pencil />
                  </button>
                  <button
                    className="dt-icon-btn danger"
                    title="Remove"
                    aria-label="Remove"
                    onClick={() => remove(entry.id)}
                  >
                    {editingId === entry.id ? <X /> : <Trash2 />}
                  </button>
                </span>
              </div>
            );
          })
        )}
      </Card>

      <p className="dt-note" style={{ marginTop: 14 }}>
        Spellings are also handed to whisper before it listens, so a rare name is recognised rather than
        guessed. Replacements apply to live dictation only — a file you transcribe keeps its words.
      </p>
    </div>
  );
}
