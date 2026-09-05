/**
 * Store screenshot targets.
 *
 * Every store asks for a different canvas, a different number of images and a
 * different amount of chrome, and getting one of those wrong is a rejected
 * build. The specs live here so the prompt, the copy plan and the "what the
 * store actually wants" note all come from one place.
 */

export type StoreId = "appstore" | "playstore" | "macstore" | "web";

/** How the app screenshot should be presented inside the shot. */
export type FrameKind = "phone" | "tablet" | "desktop" | "flat";

export interface ShotTarget {
  id: string;
  store: StoreId;
  label: string;
  width: number;
  height: number;
  frame: FrameKind;
  /** What the store asks for — shown next to the picker, not invented copy. */
  requirement: string;
  /** Safe-area guidance that goes into the prompt. */
  safe: string;
  /** Sensible number of shots to plan for this surface. */
  suggested: number;
}

export interface StoreGroup {
  id: StoreId;
  label: string;
  note: string;
}

export const STORE_GROUPS: StoreGroup[] = [
  {
    id: "appstore",
    label: "App Store",
    note: "Up to 10 per device size. The first three are the ones people see in search.",
  },
  {
    id: "playstore",
    label: "Google Play",
    note: "2–8 phone shots plus a feature graphic. Tablet shots unlock tablet placement.",
  },
  {
    id: "macstore",
    label: "Mac App Store",
    note: "Up to 10, always landscape — show the window, not a device frame.",
  },
  {
    id: "web",
    label: "Web & social",
    note: "The images that get scraped when someone pastes your link.",
  },
];

export const SHOT_TARGETS: ShotTarget[] = [
  {
    id: "ios-6-9",
    store: "appstore",
    label: 'iPhone 6.9"',
    width: 1290,
    height: 2796,
    frame: "phone",
    requirement: "Required size — Apple scales it down for every smaller iPhone.",
    safe: "keep 100 px clear on every edge and the top 8% free of copy",
    suggested: 5,
  },
  {
    id: "ios-6-5",
    store: "appstore",
    label: 'iPhone 6.5"',
    width: 1242,
    height: 2688,
    frame: "phone",
    requirement: "The older required size — still asked for on some listings.",
    safe: "keep 96 px clear on every edge",
    suggested: 5,
  },
  {
    id: "ipad-13",
    store: "appstore",
    label: 'iPad 13"',
    width: 2064,
    height: 2752,
    frame: "tablet",
    requirement: "Only needed if the app ships for iPad.",
    safe: "keep 120 px clear on every edge",
    suggested: 4,
  },
  {
    id: "play-phone",
    store: "playstore",
    label: "Phone",
    width: 1080,
    height: 1920,
    frame: "phone",
    requirement: "2–8 images. Play crops the preview, so keep copy off the edges.",
    safe: "keep 80 px clear on every edge",
    suggested: 5,
  },
  {
    id: "play-tablet",
    store: "playstore",
    label: 'Tablet 7"',
    width: 1200,
    height: 1920,
    frame: "tablet",
    requirement: "Without these, Play warns the listing isn't tablet-ready.",
    safe: "keep 90 px clear on every edge",
    suggested: 4,
  },
  {
    id: "play-feature",
    store: "playstore",
    label: "Feature graphic",
    width: 1024,
    height: 500,
    frame: "flat",
    requirement: "Required. Sits above the listing — no device frame, no small text.",
    safe: "keep the middle 60% clear of anything Play might crop",
    suggested: 1,
  },
  {
    id: "mac",
    store: "macstore",
    label: "Mac",
    width: 2880,
    height: 1800,
    frame: "desktop",
    requirement: "Up to 10. Show the real window with its title bar.",
    safe: "keep 140 px clear on every edge",
    suggested: 4,
  },
  {
    id: "og",
    store: "web",
    label: "OG image",
    width: 1200,
    height: 630,
    frame: "flat",
    requirement: "The card that renders in Slack, iMessage, X and LinkedIn.",
    safe: "keep 64 px clear on every edge; assume the corners get rounded",
    suggested: 1,
  },
  {
    id: "producthunt",
    store: "web",
    label: "Product Hunt",
    width: 1270,
    height: 760,
    frame: "flat",
    requirement: "Gallery images. The first one is the thumbnail.",
    safe: "keep 70 px clear on every edge",
    suggested: 3,
  },
  {
    id: "github",
    store: "web",
    label: "GitHub social",
    width: 1280,
    height: 640,
    frame: "flat",
    requirement: "Repository social preview — one image, heavy on the name.",
    safe: "keep 72 px clear on every edge",
    suggested: 1,
  },
];

export function targetById(id: string): ShotTarget {
  return SHOT_TARGETS.find((t) => t.id === id) ?? SHOT_TARGETS[0];
}

export function targetsFor(store: StoreId): ShotTarget[] {
  return SHOT_TARGETS.filter((t) => t.store === store);
}

/** "1290 × 2796" — the way a designer reads it. */
export function targetSize(target: ShotTarget): string {
  return `${target.width} × ${target.height}`;
}

/** Aspect label used in the prompt so the model doesn't drift off-canvas. */
export function targetRatio(target: ShotTarget): string {
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const g = gcd(target.width, target.height);
  const w = target.width / g;
  const h = target.height / g;
  // Ugly ratios (19.5:9 and friends) read better as a decimal.
  if (w > 40 || h > 40) {
    // 19.5:9 phone ratios never simplify to anything readable — normalise the
    // short side to 1 instead of printing "0.46:1".
    return target.width > target.height
      ? `${(target.width / target.height).toFixed(2)}:1`
      : `1:${(target.height / target.width).toFixed(2)}`;
  }
  return `${w}:${h}`;
}
