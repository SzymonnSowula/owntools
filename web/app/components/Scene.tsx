/**
 * Layered scenes — the piece of the brand that makes a card feel built rather
 * than filled in.
 *
 * A scene is a framed stage: a procedural nature ground (see `.ground` in
 * globals.css), one or more panes floating on it with real shadow depth, and
 * a glass rim on top. Cards across the landing are assembled from these three
 * primitives instead of each growing its own gradient, so a new card is
 * markup — never new CSS.
 *
 * Placement lives in the markup on purpose: `.pane` sets no `position`,
 * because an un-layered rule would beat Tailwind's `absolute`.
 */

import type { CSSProperties, ReactNode } from "react";

/** The moods a ground can take. Each is six CSS variables, nothing more. */
export type Ground = "meadow" | "dawn" | "tide" | "dusk" | "mist";

/** Brand hues a scene card can be tinted with. */
export const TINTS = {
  blue: "#0a84ff",
  indigo: "#5e5ce6",
  cyan: "#32ade6",
} as const;

export type Tint = keyof typeof TINTS;

export function Scene({
  ground = "meadow",
  className = "",
  style,
  children,
}: {
  ground?: Ground;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div className={`scene ground ground--${ground} ${className}`} style={style}>
      {children}
    </div>
  );
}

/**
 * A feature card: a scene on top, the words underneath. The second sentence
 * carries the point, so it renders in ink while the setup stays muted — the
 * two-weight pattern that keeps a wall of cards scannable.
 */
export function SceneCard({
  ground,
  tint = "blue",
  icon,
  title,
  lead,
  point,
  sceneClassName = "h-52",
  className = "",
  children,
}: {
  ground?: Ground;
  tint?: Tint;
  icon: ReactNode;
  title: string;
  lead: string;
  point: string;
  sceneClassName?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`glow-card flex h-full flex-col overflow-hidden ${className}`}
      style={{ ["--tint" as string]: TINTS[tint] }}
    >
      <Scene ground={ground} className={`shrink-0 rounded-none ${sceneClassName}`}>
        {children}
      </Scene>
      <div className="flex flex-1 flex-col gap-1.5 p-5">
        <p className="flex items-center gap-2 text-[15px] font-semibold" style={{ color: TINTS[tint] }}>
          <span className="glow-icon !h-7 !w-7 !rounded-lg">{icon}</span>
          {title}
        </p>
        <p className="text-[13.5px] leading-6 text-muted">
          {lead} <span className="font-semibold text-ink">{point}</span>
        </p>
      </div>
    </div>
  );
}

/** Floating paper on a scene. Give it placement (`absolute …`) from outside. */
export function Pane({
  className = "",
  style,
  children,
}: {
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div className={`pane ${className}`} style={style}>
      {children}
    </div>
  );
}

/** The dark recording/listening pill the app actually shows. */
export function ListeningPill({
  label = "listening…",
  hint = "ctrl+shift+space",
  meter = false,
  className = "",
}: {
  label?: string;
  hint?: string;
  /** show the live level bars the pill actually carries while it listens */
  meter?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`layer flex w-fit items-center gap-2 !rounded-full bg-[#0b0b0d]/92 px-3.5 py-2 text-[11.5px] font-semibold text-white backdrop-blur ${className}`}
    >
      <span className="rec-dot h-1.5 w-1.5 rounded-full bg-[#ff453a]" />
      {label}
      {meter ? <LevelMeter className="ml-0.5" bars={9} /> : null}
      {hint ? <span className="font-normal text-white/45">{hint}</span> : null}
    </div>
  );
}

/**
 * A live-looking level meter. Bars are deterministic (seeded by index) so the
 * server and the client agree — a random one would hydrate-mismatch.
 */
export function LevelMeter({ bars = 11, className = "" }: { bars?: number; className?: string }) {
  return (
    <span className={`flex items-end gap-[3px] ${className}`} aria-hidden>
      {Array.from({ length: bars }, (_, i) => {
        const h = 5 + Math.round(11 * Math.abs(Math.sin((i + 1) * 1.7)));
        return <span key={i} className="w-[3px] rounded-full bg-current" style={{ height: h }} />;
      })}
    </span>
  );
}
