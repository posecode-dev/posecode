# Posecode: domains & roadmap

Posecode's vision is broad: **describe any single-person movement as text and render it
safely in 3D.** The *protocol* is general; the *current renderer* is deliberately
scoped (one figure, forward kinematics, ground-locked hands/feet, no props). This
doc maps the domains Posecode can serve, what already works, and what each remaining
domain needs, so contributions land where they unlock the most.

## Where Posecode fits

| Domain | Example uses | Status |
| --- | --- | --- |
| **Physiotherapy / rehab** | Range-of-motion demos, home-exercise programs, post-op protocols, cervical/shoulder mobility |  Strong fit today: the ROM safety clamp is a clinical feature. Many moves render now; equipment (bands, balls) is future. |
| **Ergonomics / desk & posture** | Posture resets, seated/standing stretch breaks, "do this every hour" prompts |  Works today for standing variants; true *seated* needs a chair prop (below). |
| **Yoga & mobility** | Standing poses (chair, side bend, twist), flows, mobility drills |  Standing poses work; floor/inversion/lying poses need lying base poses + a mat. |
| **Movement education / anatomy** | Demonstrate joint actions ("what is shoulder abduction?"), biomechanics teaching |  Excellent fit: single-joint demos are exactly what the rig does. |
| **Fitness / strength** | Body-weight and free-form movement coaching |  Core today (squat, curl, raise). Barbell/dumbbell/machine work needs props + grip. |
| **Functional / elderly care** | Sit-to-stand, balance, gentle ROM, fall-prevention drills |  Partial: sit-to-stand works; reaching/balance need reach-IK + props. |
| **Sports technique** | Golf swing, tennis serve, throwing, kicking |  Partial: needs trunk rotation fidelity, weight shift, and implements (club/racket/ball). |
| **Dance / choreography** | Notating sequences, port de bras, phrases that turn & travel |  Phrases, port de bras, pirouettes, and traveling combos (box-step, grapevine, chassé) work via `turn`/`travel`; partner work is future. |
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

- One figure only; partner work and collision are still deferred.
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
