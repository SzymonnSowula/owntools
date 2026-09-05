import React, { useMemo } from "react";
import { AbsoluteFill, Sequence, useCurrentFrame } from "remotion";
import { buildBrandKit } from "./brand";
import { useLayout } from "./layout";
import { Watermark } from "./primitives";
import { beatAt, buildScript } from "./script";
import { defaultScenes } from "./scenes";
import { styleById } from "./styles";
import type { LaunchInput } from "./types";

/**
 * The composition. It resolves the style pack, builds the beat sheet from the
 * brief + seed, paints one continuous background that knows which beat is
 * playing, and cuts the scenes over it.
 *
 * Renderer contract (`@remotion/web-renderer`): inline SVG for gradients, DOM
 * order instead of `z-index`, no filters or blend modes.
 */

export interface LaunchVideoProps {
  input: LaunchInput;
}

export const LaunchVideo: React.FC<LaunchVideoProps> = ({ input }) => {
  const frame = useCurrentFrame();
  const layout = useLayout();
  const style = useMemo(() => styleById(input.style), [input.style]);
  const brand = useMemo(() => {
    const base = buildBrandKit(input.accent, style.forceTheme ?? input.theme);
    return style.brand ? style.brand(base) : base;
  }, [input.accent, input.theme, style]);
  const tokens = useMemo(() => style.tokens(brand), [style, brand]);
  const script = useMemo(() => buildScript(input), [input]);
  const { beat: active, progress } = beatAt(script, frame);
  const Background = style.Background;

  return (
    <AbsoluteFill style={{ backgroundColor: brand.paper }}>
      <Background
        input={input}
        brand={brand}
        tokens={tokens}
        layout={layout}
        script={script}
        beat={active}
        beatProgress={progress}
      />
      {script.beats.map((beat, i) => {
        const Scene = style.scenes?.[beat.kind] ?? defaultScenes[beat.kind];
        return (
          <Sequence key={`${beat.kind}-${i}`} from={beat.from} durationInFrames={beat.frames}>
            <Scene
              input={input}
              brand={brand}
              tokens={tokens}
              layout={layout}
              beat={beat}
              frames={beat.frames}
            />
          </Sequence>
        );
      })}
      {input.watermark ? <Watermark brand={brand} layout={layout} /> : null}
    </AbsoluteFill>
  );
};
