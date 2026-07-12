# L3.1 — Foot-Flat (Plantigrade) Correction (Design)

**Date:** 2026-07-11
**Status:** Approved (design)
**Sub-project:** Layer 3, slice 1 of the 5-layer animation-naturalness program
**Branch:** `feat/l3-post-ik` (stacked on `feat/l2-spline-interpolation`)

---

## 1. Context and motivation

Posecode builds a base pose from procedural FK (soon also mocap clips), then a stack of
contact solvers in the viewer frame loop makes it touch the world
(`packages/posecode-render/src/index.ts`, `frame()`): `depenetrate → applyGroundLock →
applyPins → applyReaches → alignFloorPalms → floor clamp`.

Ground-lock (`groundlock.ts`) plants feet by resting the **lowest mesh point** on `y=0`.
When knee/hip flex tilts the rigidly-attached foot toe-down (a squat, lunge, sit-to-stand,
deadlift), the ball of the foot becomes the lowest point, so the figure **balances on its
toes** — the reported squat-on-toes bug. Nothing keeps the sole plane parallel to the floor.

Real feet stay plantigrade (flat) while the shin travels over them; in mocap this is baked in.
Posecode needs a procedural equivalent.

**Goal:** keep planted soles level with the floor regardless of shin angle, so grounded
lower-body movements rest flat — without disturbing authored leg angles, tiptoe moves, or
swing feet.

### Non-goals (deferred)

- Bar grip / two-point anchors / finger wrap — that is **L3.2**.
- Look-at — folds into **L4**.
- Full leg re-IK (ground-lock deliberately never CCD-solves legs; we keep that).

---

## 2. Approach

### 2.1 Mechanism — an ankle-orientation correction (analog of `alignFloorPalms`)

`contacts.ts` already has `alignFloorPalms`, which rotates a floor-contacting wrist so the
palm normal points into the floor (`DOWN`). Foot-flat is the direct analog for feet: a new
`levelPlantedFeet` that rotates each planted ankle so the **sole normal points world-down**,
which lays the whole sole flat. It preserves the foot's yaw (toe direction) and the leg's
authored hip/knee flex — it only removes the pitch/roll the leg chain induced in the foot.

The sole sits at ankle local `-Y` (see `addShoe` in `mannequin.ts`: shoe box at local
`(0,-0.036,0.05)`), so the sole-down direction is the ankle's local `-Y`. Leveling aligns
that local `-Y` to world `DOWN` with the minimal rotation (`setFromUnitVectors`), exactly as
`alignFloorPalms` aligns the palm normal — the minimal rotation leaves yaw intact.

### 2.2 Planted-ness soft blend (the natural, better-rendering variant)

A hard snap would force-level a foot that is legitimately lifting (swing foot in a lunge,
marching knee raise, the airborne leg of a kick). Instead the correction is **weighted by how
planted the foot is**, mirroring the research's distance-based IK blending:

- Compute each foot's mesh-bottom height `y` (bbox min, as ground-lock does).
- `weight = clamp01((PLANT_FADE - y) / PLANT_FADE)` — `1` when the sole is on the floor,
  fading to `0` as it rises past `PLANT_FADE` (a swing foot is left alone).
- Apply the leveling rotation `slerp`ed by `weight`, so a lifting foot smoothly relaxes back
  to its authored orientation.

### 2.3 Tiptoe opt-out

Some moves are deliberately on the toes: relevé, calf-raise, demi-plié, plantarflex dance
phases. Foot-flat must not flatten those. Rule: **skip leveling when the ankle carries a
meaningful authored plantarflex angle.** Plantarflexion rotates the ankle about local X in the
toe-down direction; at frame time we read the ankle bone's local Euler X and, if it exceeds
`PLANTARFLEX_SKIP` (toe-down beyond a small threshold), leave the foot as authored. So
`ankles: plantarflex 30` opts out naturally, a squat that never plantarflexes gets leveled —
**no new DSL keyword, no library rewrite required.**

### 2.4 Frame-loop placement

`levelPlantedFeet` runs **after** `applyGroundLock`/`applyPins`/`applyReaches` (so the foot is
in its final planted spot and the legs hold their solved pose) and **before** the final
vertical floor clamp (so the now-level sole is what gets rested on `y=0`). It sits next to the
existing `alignFloorPalms` call in `frame()`, and is also invoked once in `load()` so the
initial captured pose is already flat.

---

## 3. Components and boundaries

### 3.1 `packages/posecode-render/src/contacts.ts` (modified)

New exported function, no new file (it is the same concern as `alignFloorPalms`, ~40 lines):

```ts
export function levelPlantedFeet(
  m: Mannequin,
  activeGroundLock: readonly string[],
): void
```

- **Purpose:** for each ground-locked foot, rotate the ankle so the sole is horizontal,
  weighted by planted-ness, skipped on authored plantarflex.
- **Depends on:** `three`, `Mannequin`. Reuses module constants.
- **Constants (named, exported for tests):** `PLANT_FADE = 0.06` (m), `PLANTARFLEX_SKIP`
  (radians, ~`15°`), sole-normal local axis `(0,-1,0)`.

### 3.2 `packages/posecode-render/src/index.ts` (modified)

- Import `levelPlantedFeet`; call it in `frame()` after `alignFloorPalms(...)` and before the
  final bbox floor clamp, passing `info.groundLock`.
- Call it once in `load()` after `groundFigureOf(mannequin)` so the captured base is flat.

### 3.3 Editor discoverability (DSL side, no new syntax)

- `packages/posecode-language/src/vocab.ts`: extend the `ground-lock` `KEYWORD_DOCS` entry to
  note that planted feet auto-level to the floor unless the ankle is plantarflexed (so the
  behavior is discoverable on hover/completion).

### 3.4 Documents

- Fix `spec/examples/squat.posecode`: the authored `ankles: plantarflex 50` forces tiptoe and
  is biomechanically wrong for a squat (the shin dorsiflexes over a flat foot). Remove it /
  set to a small dorsiflexion so foot-flat lands the sole. Keep it as the demo.
- Verify relevé / calf-raise still tiptoe (their authored plantarflex opts out).

---

## 4. Data flow

```
frame():
  base pose (squad FK)  → depenetrate → applyGroundLock (plant feet)
    → applyPins → applyReaches → alignFloorPalms
    → levelPlantedFeet(m, info.groundLock)   ← NEW: level each planted sole (weighted, opt-out)
    → floor clamp (rest the flat sole on y=0)
```

## 5. Error handling

- Missing ankle bone / no ground-locked feet → no-op.
- Degenerate rotation (sole already vertical, cross ~0) → `setFromUnitVectors` handles
  antiparallel; guard NaN and fall back to identity (no correction) as `alignFloorPalms` does.
- Swing foot (weight ~0) → correction ~identity, foot keeps authored orientation.

## 6. Testing (TDD)

Write first, watch fail, implement:

1. **Levels a tilted planted foot:** author a squat-like pose (knee/hip flex, foot tilted);
   after `levelPlantedFeet`, the sole normal is within tolerance of world-up (`0,1,0`).
2. **Plantarflex opt-out:** a foot with authored `ankles: plantarflex 30` is left unchanged.
3. **Swing foot unaffected:** a foot lifted above `PLANT_FADE` keeps its authored orientation.
4. **Squat rests flat end-to-end:** load the squat IR, sample the descend keyframe, run the
   frame solve; the foot mesh bbox min.y ≈ 0 and the sole is level (not ball-only contact).
5. **Relevé still on toes:** the relevé example keeps a plantarflexed, non-level foot.
6. **Existing suites stay green** (render, eval invariants, parser, language).

Manual: browser-verify squat rests flat, relevé stays on toes, no console errors.

## 7. Risks

- **Ankle over-rotation past ROM:** leveling could push the ankle beyond healthy ROM on an
  extreme knee bend. Mitigation: clamp the corrected ankle Euler to the ankle ROM
  (`eulerRomFor("ankle_*")`) after leveling, widened to admit the authored angle (same pattern
  as reach-IK's `jointLimitsFor`).
- **Interaction with `alignFloorPalms` ordering:** feet and palms are independent bones; no
  conflict. Both run before the clamp.
- **Plantarflex threshold tuning:** `PLANTARFLEX_SKIP` chosen so relevé/calf-raise opt out but
  a near-zero incidental ankle angle in a squat still levels; verified against the library.

## 8. Definition of done

- `levelPlantedFeet` implemented + wired into `frame()` and `load()`.
- Tests 1–5 pass; all existing suites green; typecheck clean.
- Squat demo rests flat; relevé/calf-raise still tiptoe; browser-verified, no console errors.
