# Posecode brand kit

The Posecode logo is a **kinematic figure in an open, energetic pose**: bones as
strokes, joints connected, the same rig the app animates. It hints at the
project (human movement) while staying friendly and legible down to 16px. It is
the exact mark used in the site's nav, favicon, and app icon: one logo,
everywhere, no separate "tiled" variant.

## Palette

| Token | Hex | Use |
| --- | --- | --- |
| Lime | `#c6f24a` | The figure / accent |
| Ink | `#0a0d12` | Dark background |

Type: **Hanken Grotesk** (wordmark), **JetBrains Mono** (code).

## Files

| File | What it is |
| --- | --- |
| `posecode-mark.svg` | The logo, `currentColor` so it inherits the surrounding text color. Source of truth for inline use. |
| `posecode-icon-512.png` | The logo as a flat-lime PNG on a transparent background. Use for READMEs, avatars, anywhere. |
| `posecode-social.png` | 1280×640 GitHub social preview (logo + wordmark + tagline). |

The live favicon (`playground/public/favicon.svg`, plus `favicon-16/32/48/192/512.png`)
and the iOS icon (`playground/public/apple-touch-icon.png`) use this same figure.
The SVG favicon adapts to the tab color (lime on dark UI, ink on light) so it
stays legible without a background tile.

## Using them on GitHub

- **Repo social preview:** Settings → General → Social preview → upload
  `posecode-social.png`.
- **Org / project avatar:** upload `posecode-icon-512.png`. (It's transparent, so
  on a light avatar background the lime figure will read light; if you want more
  contrast there, place it on an `#0a0d12` square first.)
- **README / inline:** reference `posecode-icon-512.png` or `posecode-mark.svg`.
