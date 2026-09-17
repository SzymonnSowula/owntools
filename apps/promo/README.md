# promo — the 30-second launch cut

A Remotion project, separate from the app and from the launch tool's engine.
One composition, `Launch30` (1920 × 1080, 60 fps, 1800 frames), plus
`Launch30Vertical` (1080 × 1920) from the same scenes.

```bash
pnpm --filter promo audio            # public/audio/soundtrack.wav (generated, no licence)
pnpm --filter promo render           # out/owntools-launch-30s.mp4
pnpm --filter promo render:vertical  # out/owntools-launch-30s-9x16.mp4
pnpm --filter promo studio           # Remotion Studio to scrub it
node scripts/stills.ts Launch30 30 90 176 --scale 0.5   # check frames → out/stills/
```

The first render downloads Remotion's headless Chrome (~110 MB) once.

## The cut

`src/cut.ts` is the whole edit: eleven scenes on a 128 BPM grid, 64 beats =
30.0 s exactly, each with the transition it comes in on (whip / zoom / slam /
flash). Every scene starts on a beat; the soundtrack script reads the same
table, so the whooshes land where the pictures cut.

| scene   | beats | what happens |
|---------|-------|--------------|
| dictate | 7 | ctrl+shift+space, the pill, 27 words land in an e-mail in bursts, "send it" |
| screeni | 9 | the real take (`web/public/shots/screeni.mp4`, the auto-zoom) under the recorder bar, Stop, the editor, Export |
| focus   | 6 | the bar, the focus widget, the timer owns the screen, three tasks ticked |
| meet    | 6 | a call written down live, then summary / decision / to-do |
| board   | 5 | ctrl+v a screenshot, a hand-drawn box, an arrow, two words, a ring |
| social  | 6 | the week's posts, one dragged, one an agent queued gets approved |
| disk    | 6 | the treemap builds, quick wins ticked, 15.5 GB into the Recycle Bin |
| capture | 3 | ctrl+shift+4, a region, the shutter, the text copied |
| quick   | 4 | the twelve quick tools cascade in |
| promise | 3 | no account. no cloud. nothing to cancel. |
| end     | 9 | the sky goes to day: icon, wordmark, tagline, the lifetime line, site |

The price line and the site are composition props (`priceLine`, `site` in
`src/Root.tsx`) because the launch ladder moves.

## How it is built

- **App pixels.** The mocks are drawn at the app's own sizes (13 px body,
  the bar's 42 px row, the pill's 999 px radius) and blown up with CSS `zoom`
  by `ui/Stage.tsx` (`Place`), 1.72× in landscape. `zoom` sits on an inner
  wrapper, never on the positioned element — it scales that element's own
  `left`/`top` too.
- **The app's own marks.** `@ui/ToolMark`, `@ui/BrandMark` and `@ui/WinDots`
  are imported from `packages/ui` through a webpack alias in
  `remotion.config.ts` (and `scripts/stills.ts`), so a redrawn glyph shows up
  here on the next render.
- **Every scene is a pure function of the frame** (`lib/anim.ts`: springs,
  ramps, deterministic noise, the streaming-words helper). A still at frame N
  is exactly what the video shows at frame N, which is what the stills script
  is for.
- **The stamp** (`ui/Stamp.tsx`): the one word a scene gets, on a frosted
  dark plate with the tool's tile, slammed in on the cut, held a third of a
  second, flown into the top-left corner where it stays as a chip. One
  element, one transform; the origin slides with the move.
- **Transitions** (`ui/Shell.tsx`) are 0.15 s, both scenes rendered during the
  overlap, the outgoing one moved by the next scene's `enter` kind. `zoom`
  raises the outgoing scene's z-index so it flies into the camera; `flash` is
  a hard cut under a one-frame white pop drawn over everything.
- **The world never cuts** (`ui/Backdrop.tsx`): the icon's sky, deep, with
  the sun jumping to a new place on every cut, brightening to daylight under
  the end card.
- **Sound** (`scripts/make-audio.ts`): kick, hats, shaker, a ducked sub and a
  soft pad on a four-chord loop, generated in plain TypeScript and written as
  a 48 kHz WAV — recipes, like the editor's SFX and the focus records, so
  nothing to license. UI sounds sit where the picture has them (keys, clicks,
  words landing, the shutter). Re-run `pnpm audio` after changing the cut.

## Checking a change

Render stills, not the video: `node scripts/stills.ts Launch30 <frames…>`
bundles once and renders each frame in about a second. For motion, render a
low-res preview (`--scale 0.3333`) and pull frames out of it in a browser.
