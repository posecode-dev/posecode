# posecode-embed

**Embed a live 3D Posecode movement anywhere with one `<script>` tag.**

`posecode-embed` ships a framework-free `<posecode-player>` web component. Drop
it into a blog post, docs page, physio program, or an LLM chat UI, and it renders
the movement as an animated 3D figure, right where a share link would have gone.

## Quick start (CDN, no build step)

```html
<script src="https://unpkg.com/posecode-embed/dist/posecode-embed.js"></script>

<!-- 1. From a share token (what a posecode.org permalink carries) -->
<posecode-player doc="cG9zZWNvZGUgZXhlcmNpc2Ug…"></posecode-player>

<!-- 2. From a URL to a .posecode file -->
<posecode-player src="/movements/squat.posecode"></posecode-player>

<!-- 3. From inline text: reads like the language itself -->
<posecode-player>
posecode exercise "Lateral raise"
  rig humanoid
  pose start = standing
  step "Raise" 1.4s ease-out:
    shoulders: abduct 90
    elbows: flex 10
  step "Lower" 1.6s ease-in:
    shoulders: abduct 0
    elbows: flex 0
  repeat 8
</posecode-player>
```

The script auto-registers the element and boots each player when it scrolls into
view. That's it.

## With a bundler

```bash
npm install posecode-embed
```

```js
import "posecode-embed"; // auto-registers <posecode-player>
```

Or register it yourself for controlled timing:

```js
import { definePosecodePlayer } from "posecode-embed";
definePosecodePlayer(); // idempotent
```

## Attributes

| Attribute | Default | Description |
| --- | --- | --- |
| `doc` | n/a | A `posecode-share` token (highest precedence). |
| `src` | n/a | URL of a `.posecode` file to fetch. |
| *(inline text)* | n/a | The element's text content, used if `doc`/`src` are absent. |
| `autoplay` | `true` | Play as soon as the movement loads. |
| `loop` | `true` | Loop the timeline. |
| `controls` | `true` | Show the play/pause bar. |
| `autorotate` | `true` | Slowly orbit the camera when idle. |
| `speed` | `1` | Playback multiplier (`0.1`–`4`). |
| `character` | *(hosted default)* | Realistic figure: a GLB URL (Mixamo rig), or `off` for the procedural mannequin. Load failures fall back to the mannequin. |
| `playground` | `https://posecode.org/play` | Base URL for the "Edit ↗" link. |

Boolean attributes accept `false` / `0` / `no` / `off` to turn them off, so
`autoplay="false"` works as expected.

## Behaviour

- **Lazy & cheap.** three.js loads only when a player scrolls into view; many
  embeds on one page stay idle until seen.
- **Accessible.** Honors `prefers-reduced-motion` (no autoplay, no camera
  orbit) and exposes a labelled play/pause control.
- **Never blank.** A bad token, a failed fetch, or an unparseable movement
  renders a readable message instead of an empty canvas, and fires a
  `posecode:error` event.
- **Isolated.** Markup and styles live in a shadow root; nothing leaks into or
  out of the host page.

## Events & API

```js
const player = document.querySelector("posecode-player");
player.addEventListener("posecode:ready", () => player.viewer.pause());
player.addEventListener("posecode:error", (e) => console.warn(e.detail.error));

player.toggle();       // play / pause
player.viewer;         // the underlying render Viewer (null until booted)
```

MIT-licensed, part of [Posecode](https://github.com/posecode-dev/posecode).
