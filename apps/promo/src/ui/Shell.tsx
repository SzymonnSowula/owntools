/**
 * The scene shell: applies the scene's entry and exit transition from the
 * cut table. Both scenes render during the overlap; the shell only moves
 * them. Every transition is 0.15 s — the cut has to read as *cuts*, with a
 * streak of motion, not as dissolves.
 */
import type { CSSProperties, ReactNode } from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import type { SceneFrames } from "../cut";
import { transitionFrames } from "../cut";
import { ease, ramp, spr } from "../lib/anim";

export function SceneShell({ scene, children }: { scene: SceneFrames; children: ReactNode }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const T = transitionFrames(fps);

  const enterP = scene.enter === "none" ? 1 : ramp(frame, 0, T);
  const exitP = scene.exit === "none" ? 0 : ramp(frame, scene.nominal, scene.nominal + T);

  const style: CSSProperties = { position: "absolute", inset: 0, overflow: "hidden" };
  let transform = "";
  let filter = "";
  let opacity = 1;
  let zIndex = 1;

  if (enterP < 1) {
    switch (scene.enter) {
      case "whip": {
        const e = ease.outExpo(enterP);
        transform = `translateX(${(1 - e) * 100}%) scale(${1 + (1 - e) * 0.06})`;
        filter = `blur(${Math.sin(enterP * Math.PI) * 9}px)`;
        break;
      }
      case "zoom": {
        const e = ease.outQuint(enterP);
        transform = `scale(${0.84 + e * 0.16})`;
        opacity = ease.outCubic(enterP);
        break;
      }
      case "slam": {
        const y = spr({ frame, fps, at: 0, from: -110, to: 0, kind: "slam", durationInFrames: T * 2 });
        transform = `translateY(${y}%)`;
        zIndex = 3;
        break;
      }
      case "flash":
      default:
        break;
    }
  }

  if (exitP > 0) {
    switch (scene.exit) {
      case "whip": {
        const e = ease.outExpo(exitP);
        transform = `translateX(${-e * 100}%) scale(${1 + e * 0.06})`;
        filter = `blur(${Math.sin(exitP * Math.PI) * 9}px)`;
        break;
      }
      case "zoom": {
        const e = ease.inCubic(exitP);
        transform = `scale(${1 + e * 0.6})`;
        opacity = 1 - ease.inQuad(exitP);
        zIndex = 5;
        break;
      }
      case "slam": {
        const e = ease.outCubic(exitP);
        transform = `scale(${1 - e * 0.05}) translateY(${e * 3}%)`;
        filter = `brightness(${1 - e * 0.5})`;
        break;
      }
      case "flash":
        opacity = 0;
        break;
      default:
        break;
    }
  }

  return (
    <div style={{ ...style, transform: transform || undefined, filter: filter || undefined, opacity, zIndex }}>
      {children}
    </div>
  );
}

/** A one-frame white pop on every `flash` cut, drawn over everything. */
export function FlashLayer({ scenes }: { scenes: SceneFrames[] }) {
  const frame = useCurrentFrame();
  let opacity = 0;
  for (const s of scenes) {
    if (s.enter !== "flash") continue;
    const f = frame - s.from;
    if (f >= 0 && f < 6) opacity = Math.max(opacity, 1 - ease.outCubic(f / 6));
  }
  if (opacity <= 0) return null;
  return <div style={{ position: "absolute", inset: 0, background: "#fff", opacity, zIndex: 50, pointerEvents: "none" }} />;
}

/**
 * The camera: a slow push-in over each scene and a short shake on every cut,
 * so a static UI still reads as filmed. Applied to the whole world.
 */
export function useCameraTransform(scenes: SceneFrames[]): string {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  let scale = 1;
  let dx = 0;
  let dy = 0;
  for (const s of scenes) {
    const f = frame - s.from;
    if (f < 0 || f >= s.duration + 4) continue;
    // Push in ~3% over the scene.
    if (f >= 0 && f < s.nominal) scale = 1 + 0.035 * ease.outCubic(f / s.nominal);
    // Impact on the cut: a damped wobble, 8 frames, up to 7 px at 1080p.
    if (f >= 0 && f < 9 && s.enter !== "none") {
      const k = Math.exp(-f * 0.55);
      dx += Math.sin(f * 2.6) * 7 * k * (1080 / 1080);
      dy += Math.cos(f * 2.1) * 5 * k;
    }
  }
  void fps;
  return `translate(${dx}px, ${dy}px) scale(${scale})`;
}
