import * as icons from "simple-icons";
import { networkById } from "../networks";

/**
 * Brand glyph for a network: simple-icons where the brand allows it, our
 * own single-colour paths for the three that left the set (LinkedIn, Slack,
 * Nostr). Always `currentColor`, viewBox 0 0 24 24.
 */

const OWN: Record<string, string> = {
  // LinkedIn "in"
  linkedin:
    "M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.13 1.45-2.13 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.55V9h3.57v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.22 0z",
  "linkedin-page":
    "M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.13 1.45-2.13 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.55V9h3.57v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.22 0z",
  // Slack: four rounded bars in a pinwheel, single colour
  slack:
    "M5.04 15.16a2.52 2.52 0 1 1-2.52-2.52h2.52v2.52zm1.27 0a2.52 2.52 0 0 1 5.04 0v6.32a2.52 2.52 0 0 1-5.04 0v-6.32zM8.83 5.04a2.52 2.52 0 1 1 2.52-2.52v2.52H8.83zm0 1.27a2.52 2.52 0 0 1 0 5.04H2.52a2.52 2.52 0 0 1 0-5.04h6.31zm10.13 2.52a2.52 2.52 0 1 1 2.52 2.52h-2.52V8.83zm-1.27 0a2.52 2.52 0 0 1-5.04 0V2.52a2.52 2.52 0 0 1 5.04 0v6.31zm-2.52 10.13a2.52 2.52 0 1 1-2.52 2.52v-2.52h2.52zm0-1.27a2.52 2.52 0 0 1 0-5.04h6.31a2.52 2.52 0 0 1 0 5.04h-6.31z",
  // Nostr: an ostrich head stylised as a simple shape
  nostr:
    "M18.5 3.5c-2.6 0-4.5 1.6-5.4 3.6l-1.8 4.4c-.5 1.2-1.6 2-2.9 2H5.5c-1.4 0-2.5 1.1-2.5 2.5v4.5h4v-3h2.4c2.9 0 5.4-1.8 6.5-4.4l1.4-3.4c.3-.8 1-1.2 1.8-1.2h1.4c1.1 0 2-.9 2-2s-.9-2-2-2h-2z",
};

export function networkGlyph(id: string): { path: string; color: string; title: string } {
  const net = networkById(id);
  const own = OWN[net.id];
  if (own) return { path: own, color: net.color, title: net.name };
  const icon = net.icon ? (icons as unknown as Record<string, { path: string; hex: string; title: string } | undefined>)[net.icon] : undefined;
  if (icon) return { path: icon.path, color: `#${icon.hex}`, title: net.name };
  return { path: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 4a6 6 0 1 1 0 12 6 6 0 0 1 0-12z", color: net.color, title: net.name };
}

export function NetworkIcon({ id, size = 16, className }: { id: string; size?: number; className?: string }) {
  const g = networkGlyph(id);
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} aria-label={g.title} role="img">
      <path d={g.path} fill="currentColor" />
    </svg>
  );
}

/** Brand colour that reads on both themes — pure black/white brands get a neutral dark chip. */
export function badgeColor(id: string): string {
  const net = networkById(id);
  const c = net.color.toLowerCase();
  if (c === "#000000" || c === "#0a0a0a" || c === "#15171a") return "#1d1d1f";
  if (c === "#fffc00" || c === "#53fc18" || c === "#8ed500") return "#5b5b60";
  return net.color;
}
