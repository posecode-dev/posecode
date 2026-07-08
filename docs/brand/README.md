# Posecode brand kit

The Posecode mark is a **kinematic figure in an open, energetic pose**: bones are
strokes, joints are markers, the same rig the app animates. It hints at the
project (human movement + a technical rig) while staying friendly and legible
down to 16px.

## Palette

| Token | Hex | Use |
| --- | --- | --- |
| Lime | `#c6f24a` | The figure / accent |
| Lime (light) | `#d6ff5e` | Top of the figure gradient |
| Lime (deep) | `#a9e02f` | Bottom of the figure gradient |
| Ink | `#0a0d12` | Dark background / tile |

Type: **Hanken Grotesk** (wordmark), **JetBrains Mono** (code).

## Files

| File | What it is |
| --- | --- |
| `posecode-mark.svg` | Figure only, `currentColor` (inherits text color). For inline logos. |
| `posecode-mark-512.png` | Figure only, lime, transparent background. |
| `posecode-icon.svg` | Rounded dark app-icon tile with glow + joint markers. |
| `posecode-icon-512.png` | The app icon, rendered, transparent corners. Good for avatars. |
| `posecode-icon-360.png` | Full-bleed square (no rounded corners) for iOS / masked contexts. |
| `posecode-social.png` | 1280×640 GitHub social preview (mark + wordmark + tagline). |

The live favicon (`playground/public/favicon.svg`) and iOS icon
(`playground/public/apple-touch-icon.png`) are wired into the site.

## Using them on GitHub

- **Repo social preview:** Settings → General → Social preview → upload
  `posecode-social.png`.
- **Org / project avatar:** upload `posecode-icon-512.png` (square, rounded) or
  `posecode-icon-360.png` (full-bleed).
- **README badge / inline:** reference `posecode-mark-512.png`.
