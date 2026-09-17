/**
 * The 30-second cut. One world (the backdrop and the camera), eleven scenes
 * from the cut table, each in its own Sequence with the shell applying the
 * transition, the brand chip over everything but the end card, the flash
 * layer over that, and the soundtrack rendered by scripts/make-audio.ts.
 */
import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { sceneFrames } from "./cut";
import { SCENES } from "./scenes";
import { Backdrop } from "./ui/Backdrop";
import { BrandChip } from "./ui/BrandChip";
import { FlashLayer, SceneShell, useCameraTransform } from "./ui/Shell";
import { ramp } from "./lib/anim";

// A type alias, not an interface: Remotion's Composition wants props that
// satisfy Record<string, unknown>, which only aliases do implicitly.
export type LaunchProps = {
  /** The price line on the end card — a prop, because the launch ladder moves. */
  priceLine: string;
  site: string;
  withAudio: boolean;
};

export const Launch = ({ priceLine, site, withAudio }: LaunchProps) => {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const scenes = sceneFrames(fps);
  const camera = useCameraTransform(scenes);
  const end = scenes[scenes.length - 1];
  const endP = ramp(frame, end.from, end.from + Math.round(0.6 * fps));

  return (
    <AbsoluteFill style={{ background: "#08192f", overflow: "hidden" }}>
      <Backdrop scenes={scenes} bright={endP} />
      <AbsoluteFill style={{ transform: camera, transformOrigin: "50% 50%" }}>
        {scenes.map((scene) => {
          const Scene = SCENES[scene.id];
          return (
            <Sequence key={scene.id} from={scene.from} durationInFrames={scene.duration} name={scene.id}>
              <SceneShell scene={scene}>
                <Scene scene={scene} priceLine={priceLine} site={site} />
              </SceneShell>
            </Sequence>
          );
        })}
      </AbsoluteFill>
      <BrandChip opacity={1 - endP} />
      <FlashLayer scenes={scenes} />
      {withAudio ? <Audio src={staticFile("audio/soundtrack.wav")} /> : null}
    </AbsoluteFill>
  );
};
