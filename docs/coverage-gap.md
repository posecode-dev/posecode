# Movement coverage — gap analysis

> Benchmarks Movit's curated library against a standard fitness taxonomy
> (body-part × equipment × target muscle), the structure popularised by public
> exercise datasets. **We use those datasets only as a yardstick for *coverage and
> taxonomy* — never their copyrighted media, instructions, or records.** Every
> Movit movement is authored from scratch and ROM-validated.

The point of this doc: find the holes in our library that the **current engine can
already render**, so we author exactly the right movements next.

## What the engine can render today

Renderable: **body-weight** movements, plus our props **chair / wall / bar**, on a
single FK figure with ground-lock, reach-IK, hip-hinge, lying/seated poses, and a
single-DOF hand rig.

Not yet renderable (so *not* counted as gaps — they're roadmap items): dumbbell /
barbell / cable / machine / band work (needs load + grip-to-implement), and
anything needing a second person. In a typical exercise dataset these are the
majority; the **body-weight subset (~25%)** is our addressable universe.

## Movit library today, by body part (51 movements)

| Body part | Have | Count | Verdict |
| --- | --- | --- | --- |
| Upper legs (quads/hams/glutes) | squat, deadlift, good-morning, hamstring-curl, hip-abduction, glute-bridge, box-squat, wall-sit, sit-to-stand, demi-plié, hip/knee ROM | ~12 | Strong, but **no lunges or step-ups** |
| Core / waist | dead-bug, glute-bridge, hanging-knee-raise, spinal-twist, side-bend, cross-body-reach | ~6 | **No crunch / plank / leg-raise / climber** |
| Shoulders | lateral-raise, shoulder-flexion, shoulder-abduction, shoulder-rolls, overhead-reach, arm-circles, port-de-bras | ~7 | Good |
| Back | bent-over-row, deadlift, good-morning, cobra, dead-hang | ~5 | **No superman / extension holds** |
| Chest | chest-opener (stretch only) | 1 | **Weak — push-up not even registered** |
| Upper arms | biceps-curl, elbow-forearm | 2 | **No triceps work** |
| Lower legs | heel-raises, relevé | 2 | Thin |
| Neck | neck-rotation, neck-side-stretch | 2 | Fine for scope |
| Hands | make-a-fist, pinch-grip, finger-spell, hand-wave | 4 | Fine for scope |
| Full body / conditioning | front-kick, jab-cross, horse-stance, dance-phrase | ~4 | **No jacks / climbers / burpee-family** |

## Biggest renderable gaps → the authoring queue

Ordered by gap size × how cleanly the engine renders it:

1. **Core** — `plank-hold`, `mountain-climber` (plank pose), `crunch`,
   `bicycle-crunch`, `supine-leg-raise` (supine pose). Highest-value, cleanest.
2. **Chest** — register the existing `push-up`.
3. **Back** — `superman` (prone pose).
4. **Upper legs** — `forward-lunge` (FK split stance, feet leveled).
5. **Lower legs** — `single-leg-calf-raise`.
6. **Conditioning / mobility** — `jumping-jacks`, `standing-quad-stretch`
   (single-leg + reach-IK).

These ~10 movements roughly **double our chest/core/back coverage** — all on
today's engine, no new primitives required.

**Front box prop (added):** a `prop box` placed in front of the figure now powers
`box-step-taps` (the lead foot taps the box top — verified landing on the anchor).

**Still deferred:** a true `step-up` and `triceps-dips`. Beyond prop placement,
both need the figure's whole body to **translate vertically** (rise onto the box /
lower into the dip), and the rig has no authorable root-height channel yet — the
pelvis is fixed and only ground-lock nudges it. So a step-up reads as a step-*tap*
and a dip can't lower. These return with a root-translation primitive (a `lift` /
body-height channel) — a clean roadmap item, not a forced low-fidelity render.

## Metadata gap (drives the catalogue work)

A real exercise record carries `body-part, equipment, primary target, secondary
muscles, difficulty`. Movit presets carried only `id, label, domain`. We now add
`bodyPart / target / equipment / difficulty` to every preset and a **filterable
gallery**, so the library is searchable like a proper exercise explorer — see
`playground/src/presets.ts` and the filter row in the playground.
