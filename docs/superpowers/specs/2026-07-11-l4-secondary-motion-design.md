# L4 — Additive Secondary Motion (Design)

**Date:** 2026-07-11
**Status:** Approved (design)
**Sub-project:** Layer 4 of the animation-naturalness program
**Branch:** `feat/l3-post-ik` (isolated worktree `/Users/aaaa/Developer/posecode-l3`)

---

## 1. Context and motivation

L2 (spline flow) and L3 (foot-flat, bar grip) fixed the base pose and its contacts. What still
reads as "not alive" is the absence of **secondary motion** — the reactive/idle detail real
bodies always have. The most glaring, universal instance: the procedural hands are **flat open
palms** everywhere except when gripping a bar. A relaxed human hand always carries a slight
finger curl. This is the biggest cheap win and it's the "hands acting weird" the user flagged.

L4 is a family of additive layers applied on top of the base pose:

- **L4.1 — Relaxed resting hand pose** (this slice): a natural finger curl on any hand that
  isn't gripping and whose fingers aren't explicitly authored.
- **L4.2 — Locomotion arm swing** (later): arms counter-swing to leg motion during travel.
- **L4.3 — Follow-through & weight shift** (later): spine lag / overshoot-settle, idle weight
  shift, plus head look-at (folded in from L3).

Slices are independent and shippable; build L4.1 first.

### Non-goals for L4.1

- Arm swing, spine follow-through, weight shift, look-at (L4.2 / L4.3).

---

## 2. Approach — L4.1 relaxed hand pose

A new `relaxHands(m, gripSides, authoredFingers)` in `contacts.ts` applies a gentle rest curl to
finger bones, so idle hands read as relaxed rather than splayed flat.

Rules (so it never fights intent):
- **Skip gripping hands** — those are wrapped by `wrapGrip` (a full grip curl).
- **Skip authored fingers** — a move that explicitly poses fingers (make-a-fist, finger-spell,
  hand-wave) is respected; `relaxHands` only touches finger bones NOT in the timeline's
  `bonesUsed` (i.e., left at rest).
- For each remaining hand, curl the four fingers to `REST_CURL` (~18°) at the knuckle and give
  the thumb a light inward rest, turning the flat palm into a natural relaxed hand.

Applied each frame after `wrapGrip` (grip wins) and once on `load()`. Because it only writes
finger-bone local rotations that nothing else drives, it can't disturb the solved body pose or
contacts (same safety property as the breathing mesh layer).

### Wiring

- `index.ts frame()`: after `wrapGrip` (inside `applyGrips`) has run, call `relaxHands`, passing
  the grip sides for this phase and the authored finger set (`timeline.bonesUsed ∩ fingers`).
- `index.ts load()`: call once after the base solve so the initial frame shows relaxed hands.
- The authored finger set is derived once per load from `timeline.bonesUsed`.

---

## 3. Components and boundaries

- **`packages/posecode-render/src/contacts.ts`:** new `relaxHands(m, gripSides, authoredFingers)`
  + `REST_CURL` constant. Reuses the `FINGERS` list already there for `wrapGrip`.
- **`packages/posecode-render/src/index.ts`:** compute `authoredFingers` at load; call
  `relaxHands` in `frame()` and `load()`; derive `gripSides` from `info.grips`.
- No parser/DSL change (this is automatic aliveness, not an authored feature). No editor change.
- **Tests:** `relaxHands` curls a rest hand's fingers; leaves a gripping side to `wrapGrip`;
  never overrides an authored finger; existing suites stay green.

### Data flow

```
frame(): base pose → contacts → applyGrips (wrapGrip on gripping hands)
  → relaxHands(m, gripSides, authoredFingers)   ← NEW: rest curl on idle, un-authored hands
  → floor clamp
```

## 4. Error handling

- Missing finger bones → no-op per bone.
- A hand both gripping and (somehow) authored → grip/authored win; `relaxHands` skips it.
- `REST_CURL` is small and within finger ROM (no clamp needed; fingers are cosmetic 1-DOF).

## 5. Testing (TDD)

1. `relaxHands` curls `index_left` etc. from flat toward a rest curl for a non-gripping hand.
2. A gripping side (passed in `gripSides`) is left untouched by `relaxHands` (wrapGrip owns it).
3. An authored finger (in `authoredFingers`) is not overridden.
4. Existing render/eval/parser/language suites stay green.

Manual: browser-verify a plain move (e.g. biceps curl / squat) shows relaxed hands, not flat
splayed palms; a gripping move still shows the full bar wrap; make-a-fist still makes a fist.

## 6. Risks

- **Double-curl with grip:** avoided by skipping grip sides.
- **Overriding expressive hands:** avoided by skipping authored fingers.
- **Reset each frame:** `relaxHands` sets absolute finger rotations, so it must run every frame
  after sampling (sampling leaves un-authored fingers at identity); idempotent.

## 7. Definition of done

- `relaxHands` implemented + wired; tests 1-4 pass; suites green; typecheck clean.
- Browser: idle hands relaxed, grips still wrap, authored hands respected.
