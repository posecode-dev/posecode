# L2 — Spline-Quaternion Interpolation (Design)

**Date:** 2026-07-11
**Status:** Approved (design), pending implementation plan
**Sub-project:** Layer 2 of the 5-layer animation-naturalness program
**Program order:** **L2** → L3 (post-IK) → L4 (secondary motion) → L1 (mocap clips) → L5 (library upgrade)

---

## 1. Context and motivation

Posecode is a text-to-motion system: an LLM writes a `.posecode` document of phases
and joint angles, the parser produces a `PosecodeIR`, and `posecode-render` plays it
on a mannequin. Unlike Mixamo (dense recorded motion capture), posecode has roughly
**one keyframe per phase** and interpolates between them.

Today's interpolation (`packages/posecode-render/src/timeline.ts`, `sample()`) finds the
two bracketing keyframes and runs an **independent** per-segment slerp:

```ts
const eased = EASE[b.easing](local);
node.quaternion.slerpQuaternions(a.quats.get(bone)!, b.quats.get(bone)!, eased);
```

Because every segment eases independently, **angular velocity resets to ~zero at every
interior keyframe**: each phase accelerates from rest and decelerates back to rest. The
figure visibly *hits a sequence of mannequin poses* instead of moving through them. This
is the textbook "robotic" case:

- Research: spherical **spline** quaternion interpolation is perceived as *significantly
  more natural* than linear-Euler or plain slerp
  ([Perceived Naturalness of Interpolation Methods, Springer](https://link.springer.com/chapter/10.1007/978-3-030-90439-5_9)).
- Animation principle: natural movement follows arcs and carries momentum; ignoring this
  reads as mechanical ([12 Principles of Animation](https://pixune.com/blog/12-principles-of-animation/)).

**Goal:** make motion *flow* through interior keyframes (C1-continuous velocity) while
still allowing deliberate pauses, and expose that control in the DSL and editor. This is a
vertical slice: render engine **and** `.posecode` language **and** editor tooling.

### Non-goals (deferred)

- Arced *translational* effector paths beyond what joint-space splines already produce
  (YAGNI for L2; joint-space squad already arcs the limbs).
- Contact correction / foot-lock / grip (that is **L3**).
- Additive secondary motion — arm swing, follow-through (that is **L4**).
- Bulk rewrite of the 73 library documents to exploit `flow` (that is **L5**).

---

## 2. Approach

### 2.1 Interpolation method: squad (spherical quadratic)

Adopt **squad** (Shoemake's spherical-and-quadrangle quaternion spline). For each interior
keyframe it derives an intermediate control quaternion from the keyframe's two neighbors,
then interpolates each segment as a quadrangle blend of the two endpoints and their two
controls. The result is **C1-continuous** across interior keyframes — velocity carries
through — and passes **exactly through every keyframe** (so authored poses are unchanged at
keyframe times).

Rejected alternatives:
- *Three.js cubic `QuaternionKeyframeTrack`* — couples the timeline to THREE's mixer, and
  cubic interpolation on raw quaternion components is not truly spherical (needs
  renormalization, can shorten/overshoot).
- *Log-quaternion Catmull-Rom* — equivalent result to squad with more moving parts.

Squad is the exact method the naturalness research validates, is self-contained, and
composes with the existing per-keyframe `Map<boneId, Quaternion>` representation.

**Root motion:** root yaw and travel (`timeline.ts:203`, currently linear) receive the same
C1 smoothing (scalar Catmull-Rom on the yaw and x/z tracks) so the whole body moves as one.
Yaw keeps its existing "sweep the long way for large turns" property (interpolate raw values,
not shortest arc).

### 2.2 Timing modes (DSL + editor)

Replace the `linear | ease-in | ease-out | ease-in-out` easing enum with **timing modes**
that express *boundary velocity* (through-point vs rest-point), not merely curve shape.
This is what lets the spline flow *or* pause per phase. Mode names avoid the existing `hold`
joint-action keyword (`vocab.ts:47`, "keep the joint at its neutral / rest angle").

| Mode | Meaning | Boundary velocity at this keyframe |
|------|---------|-------------------------------------|
| `flow` | Pass through this pose continuously (spline through-point). **Default for flowing sequences.** | Carried (C1) |
| `settle` | Decelerate to a genuine rest — the deliberate pause (squat bottom, plank hold, rep top). | Zero (ease to rest) |
| `drive` | Accelerate from rest — the concentric effort ("drive up"). | Zero on entry, carried on exit |
| `snap` | Fast, near-immediate arrival — an accent / pop. | Fast arrival, then rest |
| `linear` | Constant velocity — intentionally mechanical. | Constant |

A phase's mode governs the **arrival** at that phase's keyframe; the squad tangents combine a
keyframe's own mode with its neighbors' so that, e.g., `flow → flow` carries velocity while
`… → settle → drive …` produces a clean rest-then-push (a rep).

### 2.3 Migration — zero breakage

`EASINGS` is a zod enum (`schema.ts:14`) validated at parse time, and all 73 library
documents plus the spec examples use the old four names. Therefore:

- The old four names remain **accepted as deprecated aliases**, resolved at parse time to a
  mode:
  - `linear` → `linear`
  - `ease-in` → `drive`
  - `ease-out` → `settle`
  - `ease-in-out` → `settle`
- Aliased docs keep their **current stop-at-each-pose feel** (a `settle`/`drive` mapping
  reproduces the existing independent-ease behavior at boundaries), so L2 is a
  **non-regression** for every existing move.
- The editor surfaces a **deprecation diagnostic** (hint severity) nudging authors to the
  new modes, with a suggested replacement.
- The intentional per-move switch to `flow` (the actual naturalness win for existing moves)
  is done deliberately in **L5**, not as a risky bulk rewrite in L2.

---

## 3. Components and boundaries

Each unit has one purpose, a clear interface, and is independently testable.

### 3.1 `packages/posecode-render/src/squad.ts` (new)

- **Purpose:** pure quaternion-spline math, no timeline/DSL knowledge.
- **Interface (proposed):**
  - `squad(q0, qa, qb, q1, t): Quaternion` — quadrangle blend for one segment given the two
    endpoints (`q0`,`q1`) and their control quaternions (`qa`,`qb`).
  - `control(prev, cur, next): Quaternion` — Shoemake intermediate control for a keyframe.
  - Helpers `slerpUnit`, `logMap`/`expMap` as needed, kept private.
- **Depends on:** `three` only.
- **Boundary test:** given three keyframes, the angular velocity sampled just before and
  just after the middle keyframe is continuous (equal within tolerance); the current slerp
  path fails this test.

### 3.2 `packages/posecode-render/src/timeline.ts` (modified)

- **Purpose:** build the keyframe list (unchanged) and sample it with squad + mode-derived
  boundary velocities; smooth root yaw/travel.
- **Change:** `sample()` selects the segment as today, but computes the pose from
  `squad(...)` using the neighbor keyframes for controls, honoring each keyframe's timing
  mode for boundary velocity. The `EASE` table is replaced by a mode→tangent policy.
- **Invariant preserved:** at exact keyframe times, the sampled pose equals the authored
  keyframe pose (so `render.test.ts` keyframe-time assertions stay green).

### 3.3 `packages/posecode-parser` (modified)

- `schema.ts`: `EASINGS` → `MODES = ["flow","settle","drive","snap","linear"]`; accept
  legacy names via a preprocessing alias map before the enum (or a superset enum + a
  normalization step) so old docs validate and normalize to a canonical mode.
- `types.ts`: rename `Easing` → `TimingMode` (keep a deprecated `Easing` type alias exported
  for one release to avoid breaking downstream imports), update `Phase`.
- `parser.ts`: resolve the mode token, emit the canonical mode, and flag legacy tokens for a
  deprecation diagnostic.

### 3.4 `packages/posecode-language` + `packages/posecode-lsp` (modified)

- `vocab.ts`: export `MODES`; add `KEYWORD_DOCS` for each mode.
- completion / hover: offer modes with docs; still offer legacy names but marked deprecated.
- `diagnostics.ts`: deprecation warning for legacy mode tokens with a suggested replacement;
  unknown mode → error with "did you mean" suggestion.
- `tmLanguage` (syntax highlight) and LSP `convert.ts` kind: recognize the new mode tokens.

### 3.5 Documents

- Update **2–3 flagship moves** to the new modes as live demonstrations of `flow` (e.g. a
  multi-phase flowing move like a dance phrase or jumping-jacks, plus one that legitimately
  `settle`s like squat). The remaining 70 stay on aliases until L5.

---

## 4. Data flow

```
.posecode text
  → tokenizer → parser (resolves mode token, records legacy→canonical + deprecation flag)
  → PosecodeIR (Phase.mode: TimingMode)
  → buildTimeline() (keyframes carry mode)
  → sample(t): pick segment → squad(prev,a,b,next; mode-derived tangents) → bone quats
                              → Catmull-Rom root yaw / travel
  → viewer applies contact solving (unchanged in L2) → render
```

Editor path: parser diagnostics + vocab feed completion/hover/highlight; deprecation hints
render inline.

---

## 5. Error handling

- **Unknown mode token:** parse error, message lists valid modes and a "did you mean"
  nearest match (existing diagnostics style).
- **Legacy mode token:** parses successfully, normalizes to canonical mode, emits a
  deprecation diagnostic (hint) with the recommended replacement.
- **Degenerate keyframe sequences:** squad needs neighbors for tangents. Endpoints (first/
  last keyframe) use one-sided tangents; a lone segment (2 keyframes) falls back to slerp.
  Identical adjacent quaternions produce zero-length tangents → fall back to slerp for that
  segment (no NaNs).
- **Numerical safety:** all control/log/exp results renormalized; guard `acos`/`sin` domain
  as in the existing IK/slerp code.

---

## 6. Testing (TDD)

Write tests first (they should fail against the current slerp), then implement squad.

1. **Velocity continuity (new, RED first):** three keyframes `flow`; sample angular velocity
   (finite-difference) just before and after the interior keyframe; assert continuity within
   tolerance. Current slerp fails; squad passes.
2. **Keyframe pass-through:** at each keyframe time the sampled pose equals the authored pose
   (protects existing `render.test.ts` assertions and the eval harness).
3. **Settle = rest:** a `settle` keyframe has ~zero angular velocity at its boundary.
4. **Alias mapping:** `ease-in→drive`, `ease-out→settle`, `ease-in-out→settle`,
   `linear→linear`; aliased docs parse and render without regression.
5. **Deprecation diagnostic:** legacy token yields a hint with the correct suggested mode;
   unknown token yields an error.
6. **Existing suites stay green:** parser, render, eval, language, lsp.
7. **Coverage:** maintain the project's ≥80% bar for changed packages.

Manual verification: load a flowing multi-phase move in the playground before/after and
confirm the stop-start cadence is gone (browser preview + screenshot).

---

## 7. Risks

- **Overshoot:** squad can overshoot on sharp direction reversals. Mitigation: mode-derived
  tangents damp velocity at `settle`/`snap`; add a tangent-magnitude clamp if a move visibly
  overshoots past its authored ROM (the ROM clamp is authored-time, not sample-time, so a
  spline could momentarily exceed it — clamp sampled quats back into ROM if needed, decided
  during implementation with a test).
- **Downstream `Easing` import breakage:** mitigated by keeping a deprecated exported type
  alias for one release.
- **Scope creep into L3/L4:** contact/secondary motion explicitly out of scope here.

---

## 8. Definition of done

- Squad sampler implemented; velocity-continuity and pass-through tests pass.
- New timing modes in schema/types/parser; legacy aliases + deprecation diagnostics.
- Editor completion/hover/highlight/LSP updated for modes.
- 2–3 flagship moves updated as `flow`/`settle` demos.
- All existing test suites green; coverage ≥80% on changed packages.
- Before/after playground verification captured.
