# L3.2 — Bar-Grip System (Design)

**Date:** 2026-07-11
**Status:** Approved (design)
**Sub-project:** Layer 3, slice 2 of the animation-naturalness program
**Branch:** `feat/l3-post-ik` (isolated worktree `/Users/aaaa/Developer/posecode-l3`)

---

## 1. Context and motivation

Pull-up / dead-hang / hanging-knee-raise look broken today (diagnosed earlier):

1. The `bar` prop exposes a **single centre anchor** `(0, barH, 0)` (`props.ts`). `pin: hands bar`
   expands to two hand pins that `applyPins` **averages** into one body translation, so both
   hands are driven toward bar-centre — they converge instead of gripping shoulder-width apart.
2. `applyPins` only **translates the whole body**; it never bends the arm, so the hands sit
   wherever the authored shoulder/elbow angles put them relative to the body — not on the bar.
3. **Fingers never wrap** the bar; the flat open palm floats at it.

**Goal:** a `grip` contact that makes each hand actually hold the bar — two shoulder-width grip
points, per-hand arm IK so each wrist lands on its point while the body hangs/pulls, and a
procedural finger wrap around the bar. Both sides improve: new `grip` DSL directive + editor
support; render solvers; updated library moves.

### Non-goals

- Foot-flat (shipped in L3.1). Look-at (L4). Mocap clips (L1).

---

## 2. Approach

### 2.1 Two-point bar anchors (`props.ts`)

The `bar` prop gains `bar_left` and `bar_right` anchors at `(±GRIP_HALF, barH, 0)` with
`GRIP_HALF ≈ 0.18` (shoulder-width grip). The existing centre `bar` anchor stays for
back-compat. `dip-bars` already has per-rail geometry; its `bars` anchor is unchanged here.

### 2.2 The `grip` DSL directive

New step-child `grip: <effector> <anchor>`, parsed exactly like `pin` (`parser.ts`), producing
`GripTarget { effector, anchor }`. Resolution (`clamp.ts`) expands `hands` → `hand_left`,
`hand_right` **and rewrites the anchor per side**: a bare anchor `bar` becomes `bar_left` for
the left hand and `bar_right` for the right (if those side anchors are declared by the prop);
a side-specific anchor is used verbatim. So `grip: hands bar` → `[{hand_left,bar_left},
{hand_right,bar_right}]`. Stored on `Phase.grips`.

### 2.3 The grip solve (render)

`applyGrips(grips)` in `index.ts`, run in the frame loop where pins run (after ground-lock,
before the floor clamp), does three things per the diagnosed fix:

1. **Body translate (vertical pull):** like `applyPins`, translate the root by the average
   (anchor − wrist) delta. Authored elbow flex raises the wrists toward the shoulders, so the
   body rises to keep them at the bar — this is what produces the pull-up motion, and it is
   preserved.
2. **Per-hand arm IK (exact placement + natural angle):** for each grip, `solveCCD` on the arm
   chain `[shoulder, elbow]` (ROM-clamped, reusing the viewer's `reachChain`/`jointLimitsFor`)
   drives that wrist onto its bar anchor. This fixes the shoulder-width placement and angles the
   arms naturally toward the grips instead of straight up. Limits are widened to admit the
   authored angle, so IK closes the residual gap without fighting the pose.
3. **Finger wrap** (see 2.4).

### 2.4 Procedural finger wrap (`contacts.ts`)

`wrapGrip(m, grips)` curls the fingers of each gripping hand around the bar. For each of the
four fingers, rotate the knuckle bone about its flex axis by a curl angle derived from the bar
radius and finger length so the fingertip closes onto the cylinder surface; the thumb opposes
(curls from the other side). A single tunable `GRIP_CURL` base with per-finger scaling gives a
believable wrap. This replaces the manual `fingers: flex …` / `thumb: …` lines the current
pull-up hand-authored. Runs after the arm IK so the hand is already at the bar.

### 2.5 `grip` vs `pin`

`pin` stays for contacts that only translate the body (box step-up, chair dip, dip-bars
support). `grip` is the bar/rail hold: two-point anchor + arm IK + finger wrap. Keeping them
separate keeps each directive single-purpose and the editor guidance clear.

---

## 3. Components and boundaries

- **`packages/posecode-parser`:** `types.ts` (`GripTarget`, `Phase.grips`); `parser.ts`
  (`AstStep.grips`, parse `grip:` like `pin:`); `schema.ts` (grip array schema); `clamp.ts`
  (expand effector + per-side anchor rewrite); `index.ts` (export `GripTarget`).
- **`packages/posecode-render`:** `props.ts` (`bar_left`/`bar_right`); `contacts.ts`
  (`wrapGrip`, `GRIP_CURL`); `index.ts` (`applyGrips`, wire into `frame()` + pass `info.grips`;
  `timeline.ts` carries `grips` on keyframes / sample output).
- **`packages/posecode-language` + `lsp`:** `vocab.ts` (`grip` in `CHILD_KEYWORDS`,
  `KEYWORD_DOCS`); completion already offers child keywords; hover via `KEYWORD_DOCS`;
  tmLanguage keyword; `REACH_EFFECTORS` reused for the effector completion after `grip:`.
- **Docs:** `pull-up.posecode`, `dead-hang.posecode`, `hanging-knee-raise.posecode` switch
  `pin: hands bar` → `grip: hands bar` and drop the manual finger lines.

### Data flow

```
grip: hands bar
  → parser AstStep.grips
  → clamp: expand → [{hand_left,bar_left},{hand_right,bar_right}]
  → Phase.grips → timeline keyframe → sample().grips
  → frame(): applyGrips → body translate (pull) + per-hand arm IK (place) + wrapGrip (fingers)
```

## 4. Error handling

- Unknown grip effector / anchor: line-anchored parse error (mirror pin/reach).
- A `bar` anchor with no `bar_left`/`bar_right` declared (prop absent): fall back to the centre
  `bar` anchor so a malformed doc still resolves rather than crashing.
- Missing arm bones or unreachable target: `solveCCD` returns the closest ROM-safe pose (existing
  behavior); the body translate still hangs the figure.

## 5. Testing (TDD)

Parser:
1. `grip: hands bar` resolves to two per-side grips with `bar_left`/`bar_right` anchors.
2. `grip: hand_left bar_left` verbatim; unknown effector errors with its line.

Render:
3. `props` bar exposes `bar_left`/`bar_right` at ±GRIP_HALF.
4. After `applyGrips`, each wrist is within tolerance of its bar anchor (hands land shoulder-width
   on the bar, not at centre).
5. `wrapGrip` curls the finger bones (finger flex increases from rest) for a gripping hand.
6. Existing pin/reach/foot-flat tests stay green.

Editor:
7. `grip` completes as a child keyword and hovers with its doc.

Manual: browser-verify pull-up — hands grip the bar shoulder-width with wrapped fingers, body
hangs below and rises on the pull; no console errors.

## 6. Risks

- **Arm IK vs authored pull:** IK could over-correct and flatten the pull motion. Mitigation: run
  the body translate first (drives the rise), then IK ROM-clamped+widened to the authored angle,
  so IK only closes the residual placement gap.
- **Finger wrap tuning:** a fixed curl may over/under-close for the bar radius. Mitigation: derive
  curl from bar radius; keep `GRIP_CURL` a named constant tuned against the live pull-up.
- **`grips` plumbed through timeline:** mirror exactly how `pins` already flow so no sampling path
  is missed.

## 7. Definition of done

- `grip` parses/resolves to two-point side anchors; render places both hands on the bar with arm
  IK and wraps the fingers; editor supports `grip`.
- pull-up / dead-hang / hanging-knee-raise use `grip`; browser-verified hands grip the bar.
- All suites green; typecheck clean.
