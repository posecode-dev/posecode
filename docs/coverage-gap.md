# Movement coverage: gap analysis

> Benchmarks Posecode's curated library against a standard fitness taxonomy
> (body-part × equipment × target muscle), the structure popularised by public
> exercise datasets. **We use those datasets only as a yardstick for *coverage and
> taxonomy*, never their copyrighted media, instructions, or records.** Every
> Posecode movement is authored from scratch and ROM-validated.

The point of this doc: find the holes in our library that the **current engine can
already render**, so we author exactly the right movements next.

## What the engine can render today

Renderable: **body-weight** movements, plus our props **chair / wall / bar**, on a
single FK figure with ground-lock, reach-IK, hip-hinge, lying/seated poses, and a
single-DOF hand rig.

Not yet renderable (so *not* counted as gaps: they're roadmap items): dumbbell /
barbell / cable / machine / band work (needs load + grip-to-implement), and
anything needing a second person. In a typical exercise dataset these are the
majority; the **body-weight subset (~25%)** is our addressable universe.

## Posecode library today, by body part (51 movements)

| Body part | Have | Count | Verdict |
| --- | --- | --- | --- |
| Upper legs (quads/hams/glutes) | squat, deadlift, good-morning, hamstring-curl, hip-abduction, glute-bridge, box-squat, wall-sit, sit-to-stand, demi-plié, hip/knee ROM | ~12 | Strong, but **no lunges or step-ups** |
| Core / waist | dead-bug, glute-bridge, hanging-knee-raise, spinal-twist, side-bend, cross-body-reach | ~6 | **No crunch / plank / leg-raise / climber** |
| Shoulders | lateral-raise, shoulder-flexion, shoulder-abduction, shoulder-rolls, overhead-reach, arm-circles, port-de-bras | ~7 | Good |
| Back | bent-over-row, deadlift, good-morning, cobra, dead-hang | ~5 | **No superman / extension holds** |
| Chest | chest-opener (stretch only) | 1 | **Weak: push-up was pulled from the catalogue; still the obvious gap-filler once chest coverage is revisited** |
| Upper arms | biceps-curl, elbow-forearm | 2 | **No triceps work** |
| Lower legs | heel-raises, relevé | 2 | Thin |
| Neck | neck-rotation, neck-side-stretch | 2 | Fine for scope |
| Hands | make-a-fist, pinch-grip, finger-spell, hand-wave | 4 | Fine for scope |
| Full body / conditioning | front-kick, jab-cross, horse-stance, dance-phrase | ~4 | **No jacks / climbers / burpee-family** |

## Biggest renderable gaps → the authoring queue

Ordered by gap size × how cleanly the engine renders it:

1. **Core**: `plank-hold`, `mountain-climber` (plank pose), `crunch`,
   `bicycle-crunch`, `supine-leg-raise` (supine pose). Highest-value, cleanest.
2. **Chest**: still open; `push-up` was authored and then pulled from the
   catalogue (see note above), so this gap remains.
3. **Back**: `superman` (prone pose).
4. **Upper legs**: `forward-lunge` (FK split stance, feet leveled).
5. **Lower legs**: `single-leg-calf-raise`.
6. **Conditioning / mobility**: `jumping-jacks`, `standing-quad-stretch`
   (single-leg + reach-IK).

These ~10 movements roughly **double our chest/core/back coverage**: all on
today's engine, no new primitives required.

**Front box prop (added):** a `prop box` placed in front of the figure powers
`box-step-taps` (the lead foot taps the box top, verified landing on the anchor).

**Contact pins (added): the root-translation primitive.** `pin: <effector>
<anchor>` translates the whole body so a pinned hand/foot stays on its anchor
while the limbs work, which is exactly the vertical body motion that was missing.
This unlocked, all verified through the real rig:

- `pull-up`: hang from the bar (feet ~0.38 m off the floor), elbows flex → pelvis
  climbs ~0.34 m toward the bar.
- `step-up`: lead foot pinned to the box top; the leg straightens → the body
  rises ~0.32 m onto the box, trailing foot lifting off.
- `triceps-dips`: hands pinned to the chair seat; elbows bend → hips lower.
- `dead-hang` / `hanging-knee-raise`: now genuinely suspended from the bar.

**Still deferred:** free-flight moves (jumps, burpees) where the body leaves *all*
contacts, those want an authored whole-body `lift` channel (no anchor), a small
follow-on to the pin work.

## Metadata gap (drives the catalogue work)

A real exercise record carries `body-part, equipment, primary target, secondary
muscles, difficulty`. Posecode presets carried only `id, label, domain`. We now add
`bodyPart / target / equipment / difficulty` to every preset and a **filterable
gallery**, so the library is searchable like a proper exercise explorer, see
`playground/src/presets.ts` and the filter row in the playground.
