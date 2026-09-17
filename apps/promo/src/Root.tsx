import { Composition } from "remotion";
import "./style.css";
import { Launch, type LaunchProps } from "./Launch";
import { totalFrames } from "./cut";
import { FPS } from "./theme";
import { loadFonts } from "./fonts";

void loadFonts();

const defaultProps: LaunchProps = {
  priceLine: "buy once · yours for life",
  site: "owntools.app",
  // public/audio/soundtrack.wav comes from `pnpm audio` (scripts/make-audio.ts).
  withAudio: true,
};

export const RemotionRoot = () => (
  <>
    <Composition
      id="Launch30"
      component={Launch}
      durationInFrames={totalFrames(FPS)}
      fps={FPS}
      width={1920}
      height={1080}
      defaultProps={defaultProps}
    />
    <Composition
      id="Launch30Vertical"
      component={Launch}
      durationInFrames={totalFrames(FPS)}
      fps={FPS}
      width={1080}
      height={1920}
      defaultProps={defaultProps}
    />
  </>
);
