# wallpapers

| file              | used by                                          | what it is                                               |
| ----------------- | ------------------------------------------------ | -------------------------------------------------------- |
| `ascii-grid.webp` | `.ground::before` - every scene, the hero sky and the pricing sky | the ASCII drizzle, as the page actually draws it          |
| `ascii-grid.svg`  | nothing at runtime                               | the source the WebP is rendered from                     |

The page shows the texture at 520×420 CSS px, 24 % opacity, masked towards the
bottom. It used to reference the SVG directly: 1,916 `<text>` nodes, each with
its own opacity, replayed for every scene on every raster - measured on
2026-09-14 at 24 s of raster work and a third of the frames dropped over one
scroll of the landing. The WebP (780×630, quality 50) draws in no time and is
preloaded with the hero, where it is the largest thing on the first screen.

To change the characters: edit or regenerate the SVG, render it at 780×630 in a
browser (draw it onto a canvas, `toDataURL("image/png")`), then encode with
sharp: `sharp(png).webp({ quality: 50, alphaQuality: 50, effort: 6 })`.
