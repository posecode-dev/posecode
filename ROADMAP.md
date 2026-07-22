# Posecode: domains & roadmap

Posecode's vision is broad: **describe single-person movement as text and render it
as inspectable 3D motion.** The *protocol* is general; the *current renderer* is deliberately
scoped to one simplified figure with forward kinematics, constrained contacts,
starter props, and no rigid-body dynamics. This
doc maps the domains Posecode can serve, what already works, and what each remaining
domain needs, so contributions land where they unlock the most.

## Where Posecode fits

| Domain | Example uses | Status |
| --- | --- | --- |
| **Physiotherapy / rehab** | Range-of-motion demos, home-exercise programs, post-op protocols, cervical/shoulder mobility |  Useful for reviewed visualization: ROM constraints and diagnostics are explicit. Clinical use still requires qualified review; bands and balls are future. |
| **Ergonomics / desk & posture** | Posture resets, seated/standing stretch breaks, "do this every hour" prompts |  Standing and floor-seated variants work; chair-seated motion needs a dedicated base pose. |
| **Yoga & mobility** | Standing poses (chair, side bend, twist), flows, mobility drills |  Standing and basic supine/prone/long-seated poses work; inversions and detailed mat contacts remain limited. |
| **Movement education / anatomy** | Demonstrate joint actions ("what is shoulder abduction?"), biomechanics teaching |  Excellent fit: single-joint demos are exactly what the rig does. |
| **Fitness / strength** | Body-weight and free-form movement coaching |  Core today (squat, curl, raise). Barbell/dumbbell/machine work needs props + grip. |
| **Functional / elderly care** | Sit-to-stand, balance, gentle ROM, fall-prevention drills |  Partial: sit-to-stand works; reaching/balance need reach-IK + props. |
| **Sports technique** | Golf swing, tennis serve, throwing, kicking |  Partial: needs trunk rotation fidelity, weight shift, and implements (club/racket/ball). |
| **Dance / choreography** | Notating sequences, port de bras, phrases that turn & travel |  `turn` / `travel` and several experimental examples exist. Ballet terminology, technique fidelity, spotting, and floor-pattern readability still need expert review; partner work is future. |
| **Martial arts** | Stances, strikes, basic forms |  Stances/strikes partly work; contact and weapons are future. |
| **Sign language / gesture** | Finger-spelling, signs, expressive gesture |  Partial: single-DOF finger curls render visibly (fist, pinch, wave, rough finger-spelling); exact sign language needs multi-joint fingers + wrist orientation. |

## Engine capabilities that widen the scope

These are the unlocks, roughly in order of leverage:

1. ~~**Hip / waist hinge primitive**~~:  **shipped (v0.1).** `pelvis: hinge <deg>`
   tips the torso forward over the hips while the legs stay planted (the renderer
   counter-rotates the hips). Powers `deadlift`, `bent-over-row`, `good-morning`,
   and `bow`. Next: hinge with a loaded-bar prop.
2. ~~**Reach-IK (reach a world target)**~~:  **shipped, now ROM-constrained.**
   `reach: <effector> <target>` drives a hand/foot to a body landmark, the
   `floor`, or a prop anchor via CCD. Powers `touch-toes`, `cross-body-reach`,
   `seated-forward-fold`, and prop grips. The solve clamps every chain joint
   into its Range-of-Motion box each iteration; solved angles obey the same
   hard limits as authored ones, and `hands` / `feet` reach or pin both sides
   in one line. Next: two-bone analytic solve for straighter elbows/knees.
3. ~~**Scene props with contact anchors**~~:  **shipped (starter set).** `prop
   chair|wall|bar` adds a scene object with named anchors (`seat`, `wall`, `bar`).
   Powers `sit-to-stand`, `box-squat`, `wall-sit`, `dead-hang`, `hanging-knee-raise`.
   Bar and dip-bar contacts now resolve to independent left/right anchors with
   terminal wrist orientation; mocap is contact-corrected after blending.
   Props are now **solid**: declared blocking faces (wall surface, chair
   backrest + seat edge, box edge) physically stop the body — a wall-sit
   slides down the wall instead of through it, a sit lands against the
   backrest, a swing leg steps over the box edge — guarded by a `solid-props`
   eval invariant on every prop movement.
   Next: more props (bench, rings, bands), load cues, arbitrary surface shapes.
4. ~~**Lying & seated base poses**~~:  **shipped.** `supine | prone | seated`
   start poses (grounded by a bounding-box drop). Powers `glute-bridge`,
   `dead-bug`, `cobra`, `seated-forward-fold`. Next: quadruped + chair-seated.
5. ~~**Hand / finger articulation**~~:  **shipped (single-DOF).** Per-finger
   curl bones + `fingers` group. Powers `make-a-fist`, `pinch-grip`, `hand-wave`,
   `finger-spell-demo`. Next: multi-joint fingers for accurate sign language.
6. ~~**Spatial choreography (turn & travel)**~~:  **shipped.** `turn: <deg>`
   rotates the figure's facing and `travel: <x> <z>` moves it across the floor,
   both absolute + carried across phases and returning home on the loop wrap.
   Powers `pirouette`, `box-step`, `grapevine`, `waltz-box`, `chasse`,
   `walk-cycle`, `quarter-turns`: pirouettes, traveling combos, and gait.
   Standing poses only. Floor-contacting soles are orientation-locked and the
   visible mocap rig is re-planted after blending. Next: a larger curated clip
   library, explicit gait phase metadata, and motion matching/inertialization.
7. **Two-person + collision**: partner stretches, assisted rehab, contact sports
   (still deferred in the spec).

## Feedback-driven implementation order (July 2026)

This sequence turns the first external-user review into small, testable slices. It
starts with correctness and observability, then builds one shared motion-export
foundation before adding formats. The detailed dance/UAT list remains in
[issue #91](https://github.com/posecode-dev/posecode/issues/91), glTF in
[issue #90](https://github.com/posecode-dev/posecode/issues/90), and BVH in
[issue #63](https://github.com/posecode-dev/posecode/issues/63).

| Order | Slice | Completion evidence |
| --- | --- | --- |
| 0 | **Clarify the language contract.** Keep the public spec canonical, distinguish it from the LLM guide, define `ground-lock` / `reach` / `pin` / `grip`, and state that cues are display-only. | Implemented in the feedback branch with documentation-contract, playground, and renderer regression tests. |
| 1 | **Make current solver failures visible.** Add heel/toe height, sole-angle, foot-drift, and residual-collision diagnostics over whole clips. Reproduce the deadlift, demi-plié, and arms-lowering reports as fixtures. | **Implemented in the feedback branch.** Live viewer warnings and 12Hz clip diagnostics now name the grounding/ROM conflict or residual collision; strict known failures remain non-gating until their solver fixes land. |
| 2 | **Add small authoring controls.** Support a built-in start pose plus sparse joint overrides; improve floor origin, facing, and metre-scale markers. | **Implemented in the feedback branch.** Parser, LSP, share-link, loop-reset, floor-guide, travel/reset-path, accessibility, and responsive UI tests cover the new behavior. |
| 3 | **Separate shape from motion limits.** Introduce explicit, named ROM profiles and contact-aware ankle limits. Do not infer movement limits from a `male` / `female` label; body proportions, rig topology, and an individual's mobility are separate inputs. | General and expert-reviewed dance profiles produce deterministic clamp diagnostics; old documents retain today's default. |
| 4 | **Run expert dance UAT.** Mark unreviewed ballet examples experimental; record the school/convention and reviewer; then fix demi-plié, rise terminology, pirouette/spotting, and chassé mechanics. | Each promoted example has a reviewer/reference and pose/contact/orientation regression checks. |
| 5 | **Extract a solved-motion sampler.** Move the final post-grounding, post-IK, post-collision pose sampling out of the viewer so evaluation and exporters consume identical transforms. | Configurable-FPS samples round-trip through the viewer with matching root and local joint transforms. |
| 6 | **Ship glTF/GLB export.** First export one compatible skinned rig plus one baked animation clip; then add multiple clips on the same rig and minimal editable materials. | Three.js `GLTFLoader` round-trip plus a Godot smoke test; no retargeting required for the first version. |
| 7 | **Ship BVH export from the same sampler.** Specify hierarchy, axes, units, Euler order, frame time, and end sites before serializing. | `BVHLoader` round-trip plus documented Blender import/export validation. |
| 8 | **Broaden the pipeline.** Add configurable rig adapters/retargeting, then a visual authoring layer and optional natural-language front end. Explore Labanotation only as a bounded translator with an explicit unsupported-feature report. | Additional rigs pass adapter fixtures; non-code edits remain deterministic and export the same motion as text-authored documents. |

Natural-language animation is best treated as an input surface, not the competing
core. Posecode's role is the deterministic, inspectable, editable constraint and
interchange layer underneath a prompt UI, visual editor, cache, or generated clip.
The comparison should be measured on repeatability, targeted edits, contact
correctness, diagnostics, and export—not only first-draft generation speed.

## Prop / equipment library (future)

Each prop is a small scene object + an anchor type; movements then reference it
(e.g. `ground-lock: bar` or a future `reach: bar`). Candidates, and what they unlock:

| Prop | Unlocks |
| --- | --- |
| **Chair / stool / bench** | Seated desk & rehab work, sit-to-stand, step-ups, bench press, box squats |
| **Pull-up bar** | Pull-ups, dead hangs, hanging knee raises (needs grip + reach-IK) |
| **Gymnastic rings** | Rows, dips, support holds, skin-the-cat (grip + reach-IK + two-anchor) |
| **Yoga mat + blocks / strap / bolster** | Floor poses, supported stretches, props-assisted mobility |
| **Bed / table** | Bed-based rehab, supine exercises, clinical assessments |
| **Wall** | Wall sits, wall push-ups, calf/shoulder stretches against a surface |
| **Resistance band** | Band pull-aparts, banded rehab, mobility with tension |
| **Dumbbell / barbell / kettlebell** | Loaded strength patterns (needs grip + load cues) |
| **Ball (stability / medicine)** | Core work, balance, throws |
| **Parallettes / dip station** |  Dip bars shipped (`prop dip-bars`, triceps dips). Still future: L-sits, push-up variations at height |
| **Foam roller** | Self-myofascial release, mobility drills |

## Current limitations (honest)

- One figure only; partner work and inter-person collision are still deferred.
- The character adapter currently expects a Mixamo-compatible bone set. Body
  proportions can vary, but arbitrary naming/topology and distributing motion
  across extra spine or shoulder bones are not supported yet.
- Range-of-motion uses one general profile. It is not individualized by body,
  training background, task, or weight-bearing context.
- Self-collision is a bounded corrective pass over selected body pairs, not a
  comprehensive physics system. It exposes residuals for those sampled pairs,
  but does not detect every possible body-body collision.
- BVH motion export bakes the **authored** joint motion and root choreography
  (travel/turn); it does not yet re-run the renderer's contact/IK solve, so
  IK-dependent movements export their authored pose rather than the solved one.
  There is no glTF/GLB export yet.
- A **starter** prop set (chair / wall / bar / box / dip bars): no bench,
  rings, bands, or loaded implements yet, and props sit at fixed default
  placements.
- Prop solidity is face-based: each built-in prop declares its blocking
  surfaces (wall face, backrest, seat edge, box edge). Arbitrary-shape
  collision and load/pressure simulation are future.
- Fingers are **single-DOF** curls, good for grip and rough gesture, not exact
  sign language. The head has no facial articulation.

> Range-of-motion values are general literature data, not medical advice.

---

See [`docs/market-research.md`](docs/market-research.md) for where Posecode spreads
fastest, the per-domain go-to-market briefs, and which engine unlock opens which
locked domain.
