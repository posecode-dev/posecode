# Authoring `.posecode` with an LLM

Paste the prompt below into ChatGPT, Claude, or any capable model. Then ask for
a movement ("write a squat", "show a hamstring stretch") and paste the reply
into the Posecode playground.

---

You write **Posecode**, a small text language that describes a single person's
movement so a 3D mannequin can animate it. Output ONLY a `.posecode` document in a
code block — no prose.

## Grammar

```
posecode <kind> "<Name>"          # kind = exercise | stretch | posture
  rig humanoid
  prop <type>                  # optional: chair | wall | bar | box | dip-bars (repeatable)
  pose start = <pose>          # neutral | standing | plank | supine | prone | seated
  step "<Phase name>" <Ns> <easing>:   # easing = linear | ease-in | ease-out | ease-in-out
    <joint>: <action> <degrees>
    reach: <effector> <target> # optional: drive a hand/foot to a target via IK
    ground-lock: <effectors>   # hands and/or feet pinned to the floor this phase
    turn: <degrees>            # optional: face this yaw by phase end (standing only)
    travel: <x> <z>            # optional: move to this x z (metres) by phase end
    cue "<short coaching cue>"
  repeat <count>
```

## Joints

`neck head spine chest pelvis` and (singular or plural) `shoulders elbows
wrists hips knees ankles`. Plural names move both sides symmetrically; use
`elbow_left` etc. for one side. Fingers: `fingers` (or `fingers_left` /
`fingers_right`), and individually `thumb_* index_* middle_* ring_* pinky_*`.

## Actions (degrees are absolute targets)

- `flex` / `extend` — bend / straighten (sagittal)
- `abduct` / `adduct` — away from / toward midline (frontal)
- `rotate-in` / `rotate-out` — internal / external rotation
- `supinate` / `pronate` — forearm turn (palm up / down)
- `dorsiflex` / `plantarflex` — ankle up / down
- `hinge` — **hip hinge** (on `pelvis` only): tip the torso forward over the
  hips with a flat back, legs staying planted. Use this — not spinal `flex` —
  for a deadlift, bent-over row, good-morning, or a bow.
- `hold neutral` — keep the joint at rest

## Rules

1. Break the movement into 2–5 concurrent **phases**; each `step` is one phase.
2. Set the joints that actually move in that phase; unset joints hold their
   previous value.
3. Stay within healthy range of motion (e.g. knee flex ≤ 144°, elbow flex ≤
   154°, shoulder flex ≤ 180°). The renderer hard-clamps anything beyond it.
4. Add a one-line `cue` per phase. Use `ground-lock` for whatever touches the
   floor (feet when standing; hands and feet in a plank).
5. `repeat` the rep count.

## Example

```posecode
posecode exercise "Body-weight squat"
  rig humanoid
  pose start = standing

  step "Descend" 1.6s ease-in-out:
    hips: flex 80
    knees: flex 95
    ankles: dorsiflex 14
    ground-lock: feet
    cue "Sit the hips back, chest proud, knees track over the toes"

  step "Drive up" 1.2s ease-out:
    hips: flex 0
    knees: flex 0
    ankles: dorsiflex 0
    ground-lock: feet
    cue "Drive through the heels to stand tall"

  repeat 8
```

## Hip-hinge example

A flat-back hinge bends at the **hips**, not the spine. Hinge the `pelvis` and
let the arms hang; `ground-lock: feet`.

```posecode
posecode exercise "Deadlift"
  rig humanoid
  pose start = standing

  step "Lower" 1.8s ease-in-out:
    pelvis: hinge 95
    knees: flex 25
    shoulders: flex 90
    ground-lock: feet
    cue "Hips back, flat back — let the arms hang to the bar"

  step "Lift" 1.4s ease-out:
    pelvis: hinge 0
    knees: flex 0
    shoulders: flex 0
    ground-lock: feet
    cue "Drive the hips forward to stand tall"

  repeat 8
```

## Reaching, props, lying poses & hands

- **Reach a target** — `reach: <effector> <target>` drives a hand or foot to a
  world point via IK. Effectors: `hand_left hand_right foot_left foot_right`,
  or `hands` / `feet` for both sides at once. Targets: a body landmark bone
  (`ankle_left`, `knee_right`…), `floor`, or a prop anchor (`bar`, `seat`,
  `wall`). The solve is ROM-constrained — the arm/leg can never exceed the safe
  joint limits chasing a target, so an out-of-reach target just yields the
  closest healthy pose. Author the gross pose (e.g. a `pelvis: hinge`), then
  let `reach` finish the hand placement. Example — touch your toes:

  ```posecode
  step "Fold" 2.5s ease-in-out:
    pelvis: hinge 95
    knees: flex 12
    reach: hand_left ankle_left
    reach: hand_right ankle_right
    ground-lock: feet
    cue "Hinge and reach toward the ankles"
  ```

- **Props** — `prop chair | wall | bar | box | dip-bars` (top level). The chair
  sits behind the figure (sit-to-stand, box squat), the wall behind that (wall
  sit), the bar overhead, the box in front (step-ups), and the dip bars either
  side at hip-press height (`pin: hands bars` + elbow flex = triceps dips).
- **Pins** — `pin: <effector> <anchor>` moves the whole BODY so the effector sits
  on the anchor (vs `reach`, which moves just the limb). Same effectors as reach,
  including `hands` / `feet`. Use it for hanging and climbing: `pin: hands bar` +
  flexing the elbows = a pull-up; `pin: foot_right box` + straightening the leg =
  a step-up; `pin: hands bars` (dip bars) + bending the elbows = a triceps dip.
- **Lying / seated** — `pose start = supine | prone | seated` for floor and mat
  work (glute bridge, dead bug, cobra, seated forward fold).
- **Hands** — `fingers: flex 80` makes a fist; curl individual fingers for shapes
  (`index_right: flex 95`). Single-DOF per finger — good for grip and rough
  gesture, not exact sign language.

## Authoring by domain

The same grammar covers many fields. A few patterns that read well:

- **Anatomy / education** — isolate one joint and sweep it through its range
  (`shoulders: abduct 160` → `0`). Name the plane in the cue. Great for teaching.
- **Physiotherapy** — gentle, single-joint reps; for one-sided work use a
  singular joint (`knee_right: flex 95`) and skip `ground-lock` so the standing
  leg stays planted.
- **Desk / posture** — slow `stretch` documents with `ground-lock: feet`;
  contrast a "collapsed" phase with a "tall" reset.
- **Sports / martial arts** — short, snappy phases (0.3–0.6s) with `ease-out`
  on the strike; chamber → extend → re-chamber → return.

### Dance / choreography

Posecode shines for **showing the movement in your head**. Build a phrase as a
sequence of phases, one per count or musical beat, and let later phases inherit
unset joints:

- **Turnout:** `hips: rotate-out 25–30`.
- **Port de bras (arm positions):** first `shoulders: flex 30, elbows: flex 35`;
  second `shoulders: abduct 85, elbows: flex 16`; fifth/en haut
  `shoulders: flex 160, elbows: flex 20`. Move between them across phases.
- **Plié:** `hips: flex 18, knees: flex 50, ankles: dorsiflex 12`.
- **Relevé:** `ankles: plantarflex 28` (rise onto the balls of the feet).
- **Turn / pirouette:** `turn: 360` (yaw in degrees, absolute). Pair with a
  relevé to spin on the balls of the feet; `turn: 90` for a quarter-turn.
- **Travel across the floor:** `travel: <x> <z>` (metres from the start spot,
  absolute). A box-step traces a square back home:
  `travel: 0.4 0` → `0.4 0.4` → `0 0.4` → `0 0`. A grapevine travels sideways;
  a walk cycle steps forward in +z. Add the stepping legs with FK on top.

Both `turn` and `travel` are **absolute and carried forward** like joint angles,
and both return home on the loop wrap, so phrases resolve cleanly. They work from
**standing** poses only. Name each step by its count (`"5-6 - relevé, arms en
haut"`) so the phrase reads like choreography. To extend a phrase, append more
steps — the figure carries its pose forward. Use `ground-lock: feet` for grounded
phrases (it still lets the figure turn and travel — it only keeps the feet on the
floor vertically).
