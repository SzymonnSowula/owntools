import { FolderOpen } from "lucide-react";
import { useMemo } from "react";
import { isMac, isTauri } from "@core/env";
import { CAPTURE_HOTKEY_LABEL } from "@core/hotkeys";
import { getCaptureBackend } from "../api";
import { Button, Card, Kbd, PageHead, Row, Switch } from "../components";
import { COLORS, useCaptureSettings } from "../settings";

export function SettingsPage({ hotkeyOk }: { hotkeyOk: boolean | null }) {
  const backend = useMemo(() => getCaptureBackend(), []);
  const [settings, update] = useCaptureSettings();

  return (
    <div className="cp-page">
      <PageHead title="settings" sub="What happens when a capture is saved. Everything here runs on this computer." />

      <Card title="Shortcut" flush>
        <Row
          label="Freeze the screen"
          hint={
            hotkeyOk === false
              ? "Another application owns this shortcut, so pressing it does nothing here. Close that app or change its binding, then restart owntools."
              : "Works in any app. Press it again while the overlay is up to dismiss it."
          }
        >
          <Kbd>{CAPTURE_HOTKEY_LABEL}</Kbd>
          {hotkeyOk === false ? <span className="cp-badge warn">taken</span> : null}
        </Row>
      </Card>

      <Card title="Saving" flush>
        <Row label="Also save to Pictures" hint="A copy of every capture in Pictures › owntools, named by date and time.">
          <Switch checked={settings.saveToPictures} onCheckedChange={(v) => update({ saveToPictures: v })} label="Also save to Pictures" />
        </Row>
        <Row
          label="Recognise text automatically"
          hint={
            isMac()
              ? "Not available on macOS yet."
              : "Runs on-device when a capture is saved, so the library can be searched by what was on screen."
          }
        >
          <Switch
            checked={settings.autoOcr && !isMac()}
            onCheckedChange={(v) => update({ autoOcr: v })}
            label="Recognise text automatically"
            disabled={isMac()}
          />
        </Row>
        <Row label="Library folder" hint="Every capture as a PNG, plus index.json — nothing else, nowhere else.">
          {isTauri() ? (
            <Button onClick={() => void backend.openFolder()}>
              <FolderOpen />
              Show folder
            </Button>
          ) : (
            <span className="cp-row-note">browser preview</span>
          )}
        </Row>
      </Card>

      <Card title="Mark-up" flush>
        <Row label="Default colour" hint="The chip that is active when the overlay opens. Keys 1–5 switch it while marking up.">
          <div className="cp-swatches" role="radiogroup" aria-label="Default colour">
            {COLORS.map((c) => (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={settings.defaultColor === c.id}
                aria-label={c.label}
                title={c.label}
                className={`cp-swatch${settings.defaultColor === c.id ? " active" : ""}`}
                style={{ ["--c" as string]: c.id }}
                onClick={() => update({ defaultColor: c.id })}
              />
            ))}
          </div>
        </Row>
      </Card>

      <Card title="Text recognition">
        <p className="cp-prose">
          {isMac()
            ? "Text recognition is not available on macOS yet; it will use Apple's Vision framework, on-device, when it lands."
            : "Uses the engine built into Windows and the languages installed under Settings › Time & Language. If “Copy text” says no language is installed, add one there with the optical character recognition feature. Nothing is sent anywhere."}
        </p>
      </Card>
    </div>
  );
}
