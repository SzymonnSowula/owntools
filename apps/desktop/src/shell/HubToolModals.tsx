import { TranscribeModal } from "@feature-editor/components/TranscribeModal";
import { ExtractAudioModal } from "@feature-editor/components/ExtractAudioModal";
import { ConvertAudioModal } from "@feature-tools/components/ConvertAudioModal";
import { ConvertVideoModal } from "@feature-tools/components/ConvertVideoModal";
import { GifModal } from "@feature-tools/components/GifModal";
import { ImageConvertModal } from "@feature-tools/components/ImageConvertModal";
import { MakePdfModal } from "@feature-tools/components/MakePdfModal";
import { PdfConvertModal } from "@feature-tools/components/PdfConvertModal";
import { SubtitlesModal } from "@feature-tools/components/SubtitlesModal";
import { YouTubeModal } from "@feature-tools/components/YouTubeModal";
import { useShellStore } from "./shellStore";

/**
 * Hosts the hub's quick-tool modals. Lazy-loaded only while a quick tool is
 * open so mediabunny and the editor chunk stay out of the initial bundle;
 * the heavier libraries (pdf.js, pdf-lib, docx, gifenc, the MP3 encoder)
 * load on first use inside `@feature-tools/lib`.
 */
export default function HubToolModals() {
  const hubTool = useShellStore((s) => s.hubTool);
  const setHubTool = useShellStore((s) => s.setHubTool);
  const close = () => setHubTool(null);

  return (
    <>
      <TranscribeModal
        open={hubTool === "transcribe" || hubTool === "translate"}
        initialTranslate={hubTool === "translate"}
        onClose={close}
      />
      <ExtractAudioModal open={hubTool === "extract"} onClose={close} />
      <YouTubeModal open={hubTool === "youtube"} onClose={close} />
      <SubtitlesModal open={hubTool === "subtitles"} onClose={close} />
      <PdfConvertModal open={hubTool === "pdf"} onClose={close} />
      <MakePdfModal open={hubTool === "makepdf"} onClose={close} />
      <ImageConvertModal open={hubTool === "images"} onClose={close} />
      <ConvertAudioModal open={hubTool === "audio"} onClose={close} />
      <ConvertVideoModal open={hubTool === "video"} onClose={close} />
      <GifModal open={hubTool === "gif"} onClose={close} />
    </>
  );
}
