# Mixamo Hero Hook — Design

**Date:** 2026-07-12
**Status:** Approved

## Goal

Use one Mixamo mocap clip (**jumping jacks**) as the "eye-candy hook" on the
three primary marketing surfaces, while the procedural DSL stays the source of
truth everywhere a visitor actually engages.

Role of Mixamo = **pure attention-grabber**, not a claim about tool output. It
is delivered through the real `clip "<name>"` DSL directive (clip-back), so the
document honestly declares what it plays; deleting that one line drops it to
procedural.

## Scope — three surfaces, one directive

All three read the same `spec/examples/jumping-jacks.posecode` document and the
same `SHOWCASE_CLIPS` map, so a single directive lights up all of them:

1. **Landing hero** (`playground/index.html` + `landing.ts`) — already wired to
   `clips: SHOWCASE_CLIPS`; needs no code change once the directive is present.
2. **Playground default movement** — first thing shown on `/play`.
3. **Main README GIF** (`docs/media/jumping-jacks.gif`) — re-rendered from the
   clip via the existing capture script (it drives the real playground).

**Out of scope / unchanged:** the sub-three README GIFs (`deadlift`, `squat`,
`lateral-raise`) stay **procedural**. No other preset changes.

## Changes

1. **`spec/examples/jumping-jacks.posecode`** — add `clip "jumping-jacks"` so the
   doc plays the retargeted Mixamo motion when the skinned figure is active.
2. **`playground/public/clips/`** — rename the re-uploaded Mixamo file
   `Jumping Jacks.fbx` → `jumping-jacks.fbx` to match the `SHOWCASE_CLIPS` key
   (`jumping-jacks → /clips/jumping-jacks.fbx`). Files remain gitignored /
   CDN-served; this only reconciles local + CDN naming.
3. **`playground/src/main.ts`** — introduce `DEFAULT_PRESET_ID = "jumping-jacks"`
   and boot from it (approach A), leaving the library list order unchanged.
4. **Re-render** `docs/media/jumping-jacks.gif` via
   `node scripts/capture-gifs.mjs jumping-jacks`.

## Honesty / consistency guardrail

Only the jumping-jacks doc declares a clip. Every other preset, and the sub-3
GIFs, render procedurally — so the moment a visitor browses the library or edits
the default doc, they see real DSL output. The default doc visibly contains the
`clip "jumping-jacks"` line, so the mechanism is transparent, not hidden.

## Verification

- Browser preview: confirm the landing hero and the playground default both play
  the Mixamo jumping-jacks loop (not the procedural fallback), and that the loop
  reads cleanly through the neutral standing pose.
- Confirm removing the `clip` line falls back to procedural.
- Inspect the re-rendered GIF before committing.

## Risk / history note

Last session the landing jumping-jack "looked too bad" — that was the
*procedural* fallback after clips were dropped (`26a5e68`). Re-adding the Mixamo
clip is expected to be the fix. If the mocap loop itself reads poorly, adjust
loop/framing before re-rendering the GIF.
