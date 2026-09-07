import { Keyboard } from "lucide-react";
import { DICTATION_HOTKEY_HINT, DICTATION_HOTKEY_LABEL } from "@core/hotkeys";
import { Alert, Card, Kbd, Row, Segmented, Switch, PageHead } from "../components";
import { resolveActiveModel, type DictationLang, type DictationQuality, type EngineStatus } from "../engine";
import { useDictationSettings } from "../useSettings";

const QUALITY_HINTS: Record<DictationQuality, string> = {
  fast: "Greedy decoding — quickest, most typos.",
  balanced: "Beam search, whisper's own default. The best trade-off.",
  accurate: "A wider beam — a little slower, steadier on hard audio.",
};

export function SettingsPage({ hotkeyOk, status }: { hotkeyOk: boolean | null; status: EngineStatus | null }) {
  const [settings, update] = useDictationSettings();
  const parakeet = resolveActiveModel(settings.model, status)?.engine === "parakeet";
  const whisperOnly = parakeet ? " Whisper only — Parakeet is in use for dictation right now." : "";

  return (
    <div className="dt-page">
      <PageHead
        title="settings"
        sub="How whisper listens and what happens to the words afterwards. Everything runs on this computer."
      />

      <Card title="Recognition" flush>
        <Row
          label="Language"
          hint={
            parakeet
              ? "Parakeet detects the language on its own. This choice steers Whisper — files, subtitles, translation."
              : "Naming the language beats auto-detect on short takes — two seconds is often too little to guess from."
          }
        >
          <select
            className="dt-select"
            value={settings.lang}
            onChange={(e) => update({ lang: e.target.value as DictationLang })}
            aria-label="Language"
          >
            <option value="auto">Auto-detect</option>
            <option value="en">English</option>
            <option value="pl">Polski</option>
          </select>
        </Row>
        <Row label="Decoding" hint={`${QUALITY_HINTS[settings.quality]}${whisperOnly}`}>
          <Segmented<DictationQuality>
            label="Decoding"
            value={settings.quality}
            onChange={(quality) => update({ quality })}
            options={[
              { value: "fast", label: "Fast" },
              { value: "balanced", label: "Balanced" },
              { value: "accurate", label: "Accurate" },
            ]}
          />
        </Row>
        <Row
          label="Carry context between takes"
          hint={`The tail of what you just dictated is fed back in, so names, tense and terminology stay consistent across a paragraph.${whisperOnly}`}
        >
          <Switch
            label="Carry context between takes"
            checked={settings.useSessionContext}
            onCheckedChange={(useSessionContext) => update({ useSessionContext })}
          />
        </Row>
        <Row
          label="What you usually dictate about"
          hint={`A plain sentence primes the decoder the way the previous sentence of a paragraph would.${whisperOnly}`}
          stack
        >
          <textarea
            className="dt-textarea"
            rows={2}
            placeholder="Meeting notes and emails about a software project: sprints, customers, invoices."
            value={settings.context}
            onChange={(e) => update({ context: e.target.value })}
          />
        </Row>
      </Card>

      <Card title="Clean-up" desc="Applied to every take before it is typed." flush>
        <Row
          label="Drop what was never said"
          hint={
            <>
              <code>[BLANK_AUDIO]</code>, subtitle boilerplate (“Napisy stworzone przez…”) and the
              repeated-word loops whisper invents out of silence.
            </>
          }
        >
          <Switch label="Drop non-speech" checked={settings.cleanup} onCheckedChange={(cleanup) => update({ cleanup })} />
        </Row>
        <Row
          label="Remove filler sounds"
          hint="“um”, “uh”, “hmm”, “yyy”, “eee” go; the sentence closes up around them. Words that are only sometimes fillers (“no”, “like”, “well”) are left alone."
        >
          <Switch
            label="Remove filler sounds"
            checked={settings.removeFillers}
            onCheckedChange={(removeFillers) => update({ removeFillers })}
          />
        </Row>
        <Row
          label="Keep a history of takes"
          hint="The last 100 takes, on this machine only — handy for grabbing a sentence again or spotting a word to add to the vocabulary."
        >
          <Switch
            label="Keep a history of takes"
            checked={settings.keepHistory}
            onCheckedChange={(keepHistory) => update({ keepHistory })}
          />
        </Row>
      </Card>

      <Card title="Shortcut" flush>
        <Row label="Dictate anywhere" hint={DICTATION_HOTKEY_HINT}>
          <Kbd>{DICTATION_HOTKEY_LABEL}</Kbd>
        </Row>
        {hotkeyOk === false ? (
          <div style={{ padding: "0 16px 14px" }}>
            <Alert kind="warn" icon={<Keyboard />}>
              {DICTATION_HOTKEY_LABEL} is taken by another app, so dictation from other apps will not
              start until that app releases it.
            </Alert>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
