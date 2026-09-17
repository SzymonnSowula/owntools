import { useSyncExternalStore } from "react";
import { getBarSettings, setBarSettings, subscribeBarSettings } from "@core/bar";
import { CAPTURE_HOTKEY_LABEL, DICTATION_HOTKEY_LABEL } from "@core/hotkeys";
import { isMac } from "@core/env";
import { isTauri } from "../../../lib/env";
import { useAppStore } from "../../../store/useAppStore";
import { Button, Card, Kbd, Row, Segmented, Switch } from "../ui";

const MOD = isMac() ? "⌘" : "Ctrl";

export function GeneralPage() {
  const autostart = useAppStore((s) => s.settings.autostart);
  const closeToTray = useAppStore((s) => s.settings.closeToTray !== false);
  const update = useAppStore((s) => s.updateSettings);
  const bar = useSyncExternalStore(subscribeBarSettings, getBarSettings, getBarSettings);

  const toggleAutostart = async (on: boolean) => {
    update({ autostart: on });
    if (!isTauri()) return;
    try {
      const plugin = await import("@tauri-apps/plugin-autostart");
      if (on) await plugin.enable();
      else await plugin.disable();
    } catch {
      /* plugin unavailable in the browser preview */
    }
  };

  const quit = async () => {
    if (!isTauri()) return;
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("quit_app");
  };

  return (
    <>
      <Card
        id="bar"
        title="The bar"
        desc="A small bar at the bottom of the screen: dictate, record, a focus session and meeting notes from any app."
      >
        <Row
          id="bar-show"
          label="Show the bar"
          hint={
            bar.enabled
              ? "It rests as a small capsule and opens when the pointer stays on it. It steps aside in full screen and when this window covers it."
              : `Off. Dictation still works with ${DICTATION_HOTKEY_LABEL}, in a pill of its own.`
          }
        >
          <Switch label="Show the bar" checked={bar.enabled} onCheckedChange={(on) => setBarSettings({ enabled: on })} />
        </Row>
        <Row
          id="bar-position"
          label="Position"
          hint={bar.anchor ? "Where you dragged it." : "Bottom centre of the main screen. Drag the bar to move it."}
        >
          <Button onClick={() => setBarSettings({ anchor: null })} disabled={!bar.anchor}>
            Reset
          </Button>
        </Row>
      </Card>

      <Card title="Startup and closing">
        <Row
          id="autostart"
          label="Start with the system"
          hint={
            isTauri()
              ? "owntools opens when you sign in, so the hotkeys and scheduled posts work from the start."
              : "Remembered here; it takes effect in the desktop app."
          }
        >
          <Switch label="Start with the system" checked={autostart} onCheckedChange={(on) => void toggleAutostart(on)} />
        </Row>
        <Row
          id="close-window"
          label="When I close the window"
          hint={
            closeToTray
              ? "The window hides in the tray; the timer, the hotkeys and scheduled posts keep running."
              : "Closing quits. Nothing runs in the background - hotkeys and scheduled posts stop too."
          }
        >
          <Segmented<"tray" | "quit">
            label="When I close the window"
            value={closeToTray ? "tray" : "quit"}
            onChange={(v) => update({ closeToTray: v === "tray" })}
            options={[
              { value: "tray", label: "Keep in tray" },
              { value: "quit", label: "Quit" },
            ]}
          />
        </Row>
        <Row id="quit" label="Quit owntools" hint="Stops everything now, including what runs from the tray.">
          <Button onClick={() => void quit()} disabled={!isTauri()}>
            Quit
          </Button>
        </Row>
      </Card>

      <Card id="shortcuts" title="Keyboard shortcuts" desc="The first two work in any app, even with owntools hidden.">
        <Row label="Dictate" hint="Press to start talking, press again to type what you said.">
          <Kbd>{DICTATION_HOTKEY_LABEL}</Kbd>
        </Row>
        <Row label="Capture part of the screen" hint="Freezes the screen under the pointer.">
          <Kbd>{CAPTURE_HOTKEY_LABEL}</Kbd>
        </Row>
        <Row label="Open settings">
          <Kbd>{MOD} ,</Kbd>
        </Row>
        <Row label="Switch tools" hint="In the order of the bar on the left; 0 is the hub.">
          <Kbd>Alt 1-9</Kbd>
        </Row>
        <Row label="Quick note or task" hint="In focus.">
          <Kbd>{MOD} K</Kbd>
        </Row>
        <Row label="Start or pause the timer" hint="In focus, when you are not typing.">
          <Kbd>Space</Kbd>
        </Row>
      </Card>
    </>
  );
}
