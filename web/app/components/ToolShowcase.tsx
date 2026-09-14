import { getImageProps } from "next/image";
import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { WinDots, ToolIcons } from "./WinDots";
import { ShowcaseVideo } from "./ShowcaseVideo";
import type { Ground } from "./Scene";

/**
 * The studio section: one tall row per tool, each led by a big media panel
 * (a clip of the tool doing its job, or a screenshot, or the hand-built mock
 * as a fallback). Rows dim with their distance from the middle of the
 * viewport, so a scroll lands on one tool at a time - a scroll-driven CSS
 * animation on .ts-row (globals.css), so this renders on the server and only
 * a clip, if there is one, ships any script.
 */

export type ShowcaseTool = {
  /** tool name — also the kicker over the headline */
  name: string;
  /** which traffic-light glyph the window bar wears */
  icon: keyof typeof ToolIcons;
  /** window-bar title, e.g. "demo-take.mp4" */
  file: string;
  /** hue for the frame, bubble and glow — blue → indigo → cyan arc */
  tint: string;
  /** the one gesture that starts this tool, shown as a bubble */
  trigger: string;
  headline: string;
  desc: string;
  chips: string[];
  link?: { href: string; label: string };
  /** dropped into web/public/shots — see docs/launch-video.md */
  media?: { video?: string; poster?: string; width?: number; height?: number };
  /** weather behind the drawn stand-in or a screenshot; ignored once a real clip exists */
  ground?: Ground;
  /** drawn stand-in, used until a real clip or shot exists */
  mock: ReactNode;
};

export function ToolShowcase({ tools }: { tools: ShowcaseTool[] }) {
  return (
    <div className="ts-rows">
      {tools.map((tool, i) => {
        const { video, poster, width, height } = tool.media ?? {};
        const still = !video && poster && width && height;
        return (
          <article
            key={tool.name}
            className={`ts-row ${i % 2 ? "ts-row--flip" : ""}`}
            style={{ ["--tint" as string]: tool.tint }}
          >
            <div className="ts-media">
              <div className="ts-frame">
                <div className="wincard wincard--light ts-window">
                  <div className="wincard-bar">
                    <WinDots icon={ToolIcons[tool.icon]} />
                    <span className="wincard-title">{tool.file}</span>
                  </div>
                  <div
                    className={
                      video
                        ? "ts-stage"
                        : still
                          ? `ts-stage ts-stage--shot ground ground--${tool.ground ?? "meadow"}`
                          : `ts-stage ground ground--${tool.ground ?? "meadow"}`
                    }
                  >
                    {video ? (
                      <ShowcaseVideo src={video} poster={poster} label={`${tool.name} in use`} />
                    ) : still ? (
                      /* the optimizer's srcset and WebP, rendered here - the <Image>
                         component would ship its client code for a static picture */
                      /* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */
                      <img
                        {...getImageProps({
                          src: poster,
                          width,
                          height,
                          sizes: "(min-width: 1280px) 760px, (min-width: 1024px) 60vw, 92vw",
                          alt: `${tool.name} in use`,
                        }).props}
                      />
                    ) : (
                      <div className="ts-mock">{tool.mock}</div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="ts-copy">
              <p className="ts-bubble">{tool.trigger}</p>
              <p className="ts-name">{tool.name}</p>
              <h3 className="display mt-1 text-3xl leading-[1.1] md:text-[38px]">{tool.headline}</h3>
              <p className="mt-4 max-w-md text-[15px] leading-7 text-muted">{tool.desc}</p>
              <div className="mt-5 flex flex-wrap gap-2">
                {tool.chips.map((chip) => (
                  <span key={chip} className="ts-chip">
                    {chip}
                  </span>
                ))}
              </div>
              {tool.link ? (
                <a href={tool.link.href} className="ts-link">
                  {tool.link.label} <ArrowRight size={14} />
                </a>
              ) : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}
