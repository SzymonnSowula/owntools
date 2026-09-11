import { Card, PageHead, Row, Segmented, Switch } from "../components";
import { useMeetSettings } from "../settings";
import { useMeetStore } from "../store";
import { SENSITIVITY_DB, type MeetLang, type Sensitivity } from "../types";

const SENSITIVITY: { value: Sensitivity; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
];

const LANGS: { value: MeetLang; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "en", label: "English" },
  { value: "pl", label: "Polski" },
];

export function SettingsPage() {
  const [settings, update] = useMeetSettings();
  const devices = useMeetStore((s) => s.devices);
  const engine = useMeetStore((s) => s.engine);
  const phase = useMeetStore((s) => s.phase);
  const locked = phase === "recording" || phase === "paused" || phase === "starting" || phase === "stopping";

  return (
    <div className="mt-page">
      <PageHead title="settings" sub="What a new recording starts with. Everything here is stored on this device only." />

      <Card title="Sources" desc="Which sides of the call are recorded by default." flush>
        <Row label="Microphone" hint="Your side - shows up as “you” in the transcript.">
          <Switch checked={settings.mic} onCheckedChange={(v) => update({ mic: v })} label="Record the microphone" disabled={locked} />
        </Row>
        <Row label="System audio" hint="Everything that plays through the speakers or headphones - the other side, shown as “them”.">
          <Switch checked={settings.system} onCheckedChange={(v) => update({ system: v })} label="Record the system audio" disabled={locked} />
        </Row>
        <Row label="Microphone device" hint={devices ? `${devices.inputs.length} input${devices.inputs.length === 1 ? "" : "s"} found.` : "The default input unless you pick one."}>
          <select className="mt-select" value={settings.micDevice} onChange={(e) => update({ micDevice: e.target.value })} disabled={locked} aria-label="Microphone device">
            <option value="">Default microphone</option>
            {(devices?.inputs ?? [])
              .filter((d) => !d.default || settings.micDevice === d.id)
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
          </select>
        </Row>
      </Card>

      <Card title="Transcript" flush>
        <Row
          label="Sensitivity"
          hint={
            <>
              How quiet a voice still counts as speech. Currently <code>{SENSITIVITY_DB[settings.sensitivity]} dBFS</code>; raise it in a noisy room, lower it for a soft speaker.
            </>
          }
        >
          <Segmented value={settings.sensitivity} options={SENSITIVITY} onChange={(v) => update({ sensitivity: v })} label="Sensitivity" disabled={locked} />
        </Row>
        <Row label="Language" hint={engine?.parakeet && !engine.whisper ? "A hint for whisper; Parakeet detects the language itself." : "A hint for whisper. Auto detects it per line."}>
          <Segmented value={settings.lang} options={LANGS} onChange={(v) => update({ lang: v })} label="Language" />
        </Row>
      </Card>

      <Card title="Storage" desc="Each meeting is a folder under the app's data: audio.wav, segments, meeting.json, transcript.md, notes.md." flush>
        <Row label="Keep the audio" hint="Off deletes audio.wav and the segments once the transcript is written - the meeting keeps its text. About 11 MB per minute when kept.">
          <Switch checked={settings.keepAudio} onCheckedChange={(v) => update({ keepAudio: v })} label="Keep the audio after the meeting" />
        </Row>
      </Card>
    </div>
  );
}
