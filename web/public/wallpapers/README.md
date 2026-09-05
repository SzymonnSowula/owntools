# wallpapers

Drop-in slots for real photo wallpapers. The CSS references these files with
procedural gradient fallbacks underneath — if a file is missing, the gradient
renders instead, nothing breaks.

| file            | used by                                        | what to drop here                                      |
| --------------- | ---------------------------------------------- | ------------------------------------------------------ |
| `hero.jpg`      | `.hero-sky` (day hero) + `.sky-day` (pricing, cropped to its bottom/meadow; dark theme adds a dark wash) | grass field + blue sky with ASCII code (the "bliss × matrix" shot) |
| `hero-dark.jpg` | `.hero-sky` (night theme hero)                 | dusk/dawn sky, deep navy → warm horizon                |
| `ascii-grid.svg`| `.ascii-sky::before` overlay                   | generated — regenerate only if you want new characters |

Recommended: ≥1920px wide, JPEG quality ~75, keep each under ~400 KB.
`ascii-grid.svg` is procedural (white monospace chars, tiled 640×520,
masked to fade toward the bottom of the section).
