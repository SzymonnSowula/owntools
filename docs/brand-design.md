# owntools brand design — "open desk"

> Design system v2 (2026-08-31). Fusion of two references: **superwhisper**
> (premium, cinematic, big typography, tinted feature cards, mega-footer)
> × **heyclicky** (desktop metaphor, mac windows, sky wallpapers, playful
> stickers, terminal cards) — rebuilt in the owntools Apple-blue family.
> Implemented first on the landing (`web/`); this doc is the spec for
> carrying it into the desktop app (`apps/desktop` + packages).

## 1. Concept

The brand metaphor is a **desk by an open window**. Your tools are little
mac windows floating over a dotted desk; above the desk is the sky — a
bright "bliss" day sky with ASCII code raining through it (local-first,
code-made). Day is the default mood; night is the same desk after dark
(dusk gradient, deep neutrals). Everything is lowercase, friendly, and a
bit playful — but surfaces, spacing and type are premium and precise.

Voice: lowercase headlines, short verbs, honest microcopy ("no cloud.
promise."). Full rules — including who we are allowed to name — in §9.

## 2. Themes

Two first-class themes with **day as default**. One attribute switches
everything: `data-theme="dark"` on `<html>` (absence = day). Preference is
persisted (`localStorage["owntools-theme"]`) and applied pre-paint.

Tailwind 4 emits utilities as `var(--color-*)` references, so redefining
the raw custom properties under `[data-theme="dark"]` re-themes every
utility and component with zero extra classes.

### Tokens

| token             | day                    | night                       |
| ----------------- | ---------------------- | --------------------------- |
| `--color-paper`   | `#f5f5f7`              | `#060608`                   |
| `--color-card`    | `#ffffff`              | `#101014`                   |
| `--color-ink`     | `#1d1d1f`              | `#f5f5f7`                   |
| `--color-muted`   | `#6e6e73`              | `#9a9aa1`                   |
| `--color-line`    | `rgba(29,29,31,.12)`   | `rgba(255,255,255,.09)`     |
| `--color-accent`  | `#0a84ff` (both)       | — hover `#0071e3`           |
| `--color-indigo`  | `#5e5ce6` (both)       |                             |
| `--color-cyan`    | `#32ade6` (both)       |                             |
| `--color-alert`   | `#ff453a` (semantic only: REC, errors) |             |

Surface vars (non-utility): `--dot-color`, `--win-grad-a/b`, `--win-bar`,
`--win-shadow`, `--glow-a/b`, `--glow-mix`, `--nav-bg`, `--dim-color`,
`--stroke-word` — see `web/app/globals.css` for exact values per theme.

Rule: **never** hardcode a hue outside this family. Old teal/violet/coral
names alias into it. Red is exclusively semantic.

## 3. Typography

- **Display**: Outfit 500–800, lowercase, tracking `-0.045em`
  (`.display`). Headlines, window titles in cards, prices, wordmark.
- **Body**: Inter 400–800, tracking `-0.01em`.
- **Mono**: SF Mono / Consolas / Cascadia (`--font-mono`) — terminals,
  keycaps, license keys.
- Scale (landing): hero 92px, section h2 40–48px, giant statement
  56–72px, body 15px/1.75.
- **Giant dimmed statement** pattern (superwhisper): oversized display
  line where secondary words get `.dim` (`--dim-color`), the key phrase
  stays ink. E.g. `dictate works **anywhere** you can **type**`.
- **Outline wordmark** (`.outline-word`): transparent fill,
  `-webkit-text-stroke` in `--stroke-word`; footer-scale only.

## 4. Signature surfaces & patterns

### desk (`.dotted`)
Dotted grid 22px, dot = `--dot-color`. Section backgrounds, hub, footer.

### mac window (`.wincard`)
Radius 14, 1px `--color-line`, vertical gradient `--win-grad-a→b`, themed
shadow; title bar with **WinDots** (traffic lights re-drawn as 3 tinted
mini tool-icons) + lowercase filename title ("focus.app",
"demo-take.mp4", "indie-hacker.you"). Everything is presented as a window
or a file — features, personas, pricing plans, free tools.
`.wincard--light` forces the paper look on media backgrounds (hero, sky
section) in both themes.

### tinted feature card (`.glow-card`)
Superwhisper pattern in our palette: pass `--tint` (accent/indigo/cyan),
card gets a radial tint wash over `--glow-a/b`, tinted border, tinted
icon chip (`.glow-icon`), hover lift + tinted shadow. Icon top-left,
title + 2-line desc pushed to the bottom. Use for "what's inside" grids;
day = white cards with pastel wash, night = near-black with glow.

### sky sections
- `.hero-sky.ascii-sky` — hero. Day: bliss-blue gradient; night: dusk
  navy→indigo→warm horizon. ASCII overlay: tiled
  `/wallpapers/ascii-grid.webp` (white mono chars rendered from the
  procedural `ascii-grid.svg` - the SVG itself was far too slow to paint),
  masked to fade out toward the bottom. Real photos drop into
  `web/public/wallpapers/hero.jpg` / `hero-dark.jpg` (CSS falls back to
  gradients when missing).
- `.sky-day` — the pricing section is **always** daylight (a window to
  outside, in both themes): blue sky + cloud radials, `sky.jpg` slot.
  Content on it uses forced-light windows.

### terminal card (`.terminal`)
Dark in both themes. Mono 12.5px, WinDots bar, `.prompt` cyan, `.cmd`
white, `.ok` green. Used for: agentic-workflow demo (dictate → Claude
Code) and the "< maker discount >" offer (heyclicky pattern).

### stickers & pills
- Yellow sticky note (`#fff8c4`, tilt, shadow) — playful annotations
  ("ship it friday", "no cloud. promise.").
- Dictation pill: near-black rounded-full, pulsing red dot
  (`.rec-dot`), "listening…" + shortcut hint.
- Chips: rounded-full, `--color-line` border, lowercase.

### buttons (`.btn`)
Rounded-full, h-48, weight 600. Variants: `btn-primary` (ink↔paper,
inverts with theme), `btn-light` (always white — on media), `btn-accent`
(Apple blue, the one CTA per view), `btn-ghost` (translucent white +
blur — on media). Active = scale .97.

### navigation
Floating pill nav (superwhisper): fixed, max-w-5xl, rounded-full,
`--nav-bg` + backdrop-blur, brand mark left (sailboat glyph + lowercase
wordmark), lowercase links, ThemeToggle (sun/moon), accent CTA.

## 5. Motion

- `.reveal` — 18px rise over a block's first 120px on screen, a
  scroll-driven animation (`animation-timeline: view()`), neighbours
  staggered by `--reveal-shift`; visible from the first paint, no script
  (`web/app/components/Reveal.tsx`). Studio rows dim away from the middle
  of the screen the same way (`.ts-row`).
- `.floaty` — hero windows bob ±9px / 7s, per-card `--tilt` and
  negative `animation-delay`.
- `.rec-dot` — recording pulse, 1.6s.
- **demo player** (`DemoZoom.tsx` + `.demo-*`): the hero demo-take.mp4
  tile zooms on hover/click to a near-fullscreen window (portal to body —
  the hero is an isolated stacking context) "playing" a CSS-only launch
  video: our own landing inside the frame, ken-burns auto-zooms, a fake
  cursor, launch-style intro card, REC chrome. Swap the SiteShot replica
  for a real `<video>` when we record one.
- Everything honors `prefers-reduced-motion`.

## 6. Landing page composition (implemented)

1. **hero** — sky + ascii, floating tool windows + stickers, display
   headline, `btn-light` (download for windows) + `btn-ghost` (free
   tool), "also for macOS — soon", glass info panel.
2. **01 · one app bento** — numbered mono header with rule line, then a
   bento grid of `.bento` tiles whose visuals are `.nature` panels
   (meadow-sky gradient + ASCII overlay, dusk variant at night): big
   dictation tile, screeni + built-native tiles right, focus/launch small
   pair, and a "0 bytes to the cloud" stat tile with three mono columns
   (on-device · works offline · private) — this absorbs the old proof
   strip.
3. **the toolkit** (`Toolkit.tsx`) — left-aligned header ("every step of
   shipping. one desk.") + "browse by job" tab pill (capture · media ·
   create · focus); tabs switch a row of numbered `.glow-card` capability
   cards that starts at the container's left edge, bleeds to the right
   viewport edge and fades into a `--color-paper` fog (`.toolkit-fog`).
   Every card carries its own tint — Apple system hues extend the palette
   here as washes only: blue/indigo/cyan (tokens) + orange `#ff9f0a`,
   green `#30d158`, pink `#ff375f`. Each card: number + mono tags +
   arrow chip, icon + title, one-line benefit copy, mini product mockup.
   Below: counter + prev/next arrows strip (the featured-capability banner
   repeated the first card and was removed on 2026-09-14).
4. **the loop** — 4 numbered `.wincard`s (01 focus → 04 dictate) with →.
5. **tool deep-dives** — alternating rows, per-tool kicker color
   (screeni cyan · dictate/focus accent · launch indigo), chips.
6. **giant statement** ("dictate works anywhere you can type") +
   agentic terminal two-col.
7. **personas** — 4 `.wincard`s ("developer.you" …).
8. **free tools** — wincards for what the free desktop app already does
   (the `LIVE IN BROWSER` badge left with the web launch video maker,
   2026-09-12).
9. **privacy statement** — centered display type.
10. **pricing** — `.sky-day`, 2 forced-light plan windows ($0 / $49
    once + "popular" tab), maker-discount terminal.
11. **faq** — accordion + "help.app" side window.
12. **footer** — 4 link columns, giant outline wordmark.

## 7. Carrying it into the desktop app

The app (`apps/desktop/src/suite.css`) already shares the palette and
wincard/WinDots language. To align with v2:

- [ ] Port the theme-switch token block (day default + `[data-theme="dark"]`)
      into `suite.css @theme`; add the sun/moon toggle to the hub top bar
      and persist alongside existing settings.
- [ ] Adopt surface vars (`--win-grad-*`, `--glow-*`, `--dot-color`) so
      Hub cards, quick-tool modals and editor chrome re-theme for free.
- [ ] Hub: use `.glow-card` tints for the 4 tool tiles (focus accent,
      screeni cyan, launch indigo, dictate accent).
- [ ] Sky moments: `.hero-sky`-style header strip in the Hub; `.sky-day`
      for celebratory states (export done, launch rendered).
- [ ] Terminal styling for whisper/engine logs and license-key entry.
- [ ] `.rec-dot`, dictation pill and sticker styles shared via
      `packages/ui` (single source; web keeps local copies only where the
      standalone Next app can't import `@ui`).
- [ ] Keep red strictly semantic (REC/alerts) in both themes.

## 8. Assets

- `web/public/wallpapers/` — `hero.jpg`, `hero-dark.jpg`, `sky.jpg`
  drop-in slots (graceful gradient fallbacks), `ascii-grid.webp` (what the
  page draws) rendered from `ascii-grid.svg` (procedural), `README.md` with
  specs.
- Icons: **lucide-react**, 15–17px, stroke, tinted via `currentColor`.
- Brand glyph: sailboat (sail + hull) — see `WinDots.tsx` BRAND_GLYPH.
- Watermark stays "made with owntools".

## 9. Voice & positioning

Reference for tone: **yaps.ai** — "Powerful AI that stays on your device." /
"Dictate first, then transcribe, take notes, read aloud, translate, and work
with media." / "One app, every word you own." Note what is *not* there: no job
title, no attitude, no in-group. The headline is a capability plus a promise;
the sub-line is a plain list of verbs; the section label is about ownership.

**The rule: name what the app does and what it protects — never who the user
is.** Copy that starts with an audience ("for people who ship", "an entire
maker studio", "the loop every maker runs") reads as a members-only sign to
everyone outside it, and the four tools are useful far beyond that room —
lectures, interviews, admin, teaching, support, a quiet hour.

Do:
- lead with a verb list anyone recognises — dictate, transcribe, record, take
  notes, translate;
- pair every capability with the local-first promise (on your device, offline,
  nothing uploaded);
- describe **moments** ("when you'd rather talk than type") instead of
  personas ("indie hackers");
- keep examples mixed: an email and a commit message, a lecture and a demo.

Don't:
- "makers", "founders", "indie hackers", "people who ship", "build in public",
  "ship day" as the frame for a headline or section;
- narrow a shared feature to one trade (dictation is not "for developers"
  because it also works in a terminal — the terminal is *one example*);
- imply a workflow the reader must already have ("the loop you run").

Fixed points (2026-09-01):
- name: **owntools** stays — read it as the idiom ("in good order"), not as
  release-engineering;
- hero: **"your work. your device."** + the verb list beneath it;
- section label: **"one app, everything you own"**;
- tagline (`packages/core/src/branding.ts`): "your voice, your screen, your
  files — all on your device";
- audience section: "four moments, not four job titles";
- the FAQ answers "Who is it for?" with a list that ends in "no job title
  required" — keep that answer first.
