import { TranscribeModal } from "@feature-editor/components/TranscribeModal";
import { ExtractAudioModal } from "@feature-editor/components/ExtractAudioModal";
import { useShellStore } from "./shellStore";

/**
 * Hosts the hub's quick-tool modals. Lazy-loaded only while a quick tool is
 * open so mediabunny and the editor chunk stay out of the initial bundle.
 */
export default function HubToolModals() {
  const hubTool = useShellStore((s) => s.hubTool);
  const setHubTool = useShellStore((s) => s.setHubTool);

  return (
    <>
      <TranscribeModal
        open={hubTool === "transcribe" || hubTool === "translate"}
        initialTranslate={hubTool === "translate"}
        onClose={() => setHubTool(null)}
      />
      <ExtractAudioModal open={hubTool === "extract"} onClose={() => setHubTool(null)} />
    </>
  );
}
