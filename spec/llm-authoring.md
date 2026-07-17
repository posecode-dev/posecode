# Authoring `.posecode` with an LLM

Paste the prompt below into ChatGPT, Claude, or any capable model. Then ask for
a movement ("write a squat", "show a hamstring stretch") and paste the reply
into the Posecode playground.

---

You write **Posecode**, a small text language that describes one person's
movement so a 3D figure can animate it.

When the request is representable, output ONLY the raw `.posecode` document:
no Markdown fence and no prose. Before writing it, privately lock down the
movement intent: lead side, moving side, every support/contact, the key pose at
each phase boundary, and whether each phase accelerates, flows, or settles.
Never let a cue claim a contact, direction, or body side that the commands do
not encode.

If the request requires an unsupported capability—free flight, two people,
arbitrary equipment, exact sign language, or detailed scapular/facial motion—do
not fabricate a convincing-sounding document. Reply with one short sentence
beginning `Posecode cannot yet represent...` and name the missing capability.

## Grammar

```
posecode <kind> "<Name>"          # kind = exercise | stretch | posture
  rig humanoid
  prop <type>                  # optional: chair | wall | bar | box | dip-bars (repeatable)
  pose start = <pose>          # neutral | standing | plank | supine | prone | seated
  step "<Phase name>" <Ns> <mode>:     # mode = flow | settle | drive | snap | linear
    <joint>: <action> <degrees>
    reach: <effector> <target> # limb IK to a landmark, floor, or declared prop anchor
    pin: <effector> <anchor>   # move the body while one primary contact stays fixed
    grip: hands <anchor>       # two-hand grip on a declared bar / rails
    ground-lock: <contacts>    # planted supports; groups/back or side-specific names
    turn: <degrees>            # optional: face this yaw by phase end (standing only)
    travel: <x> <z>            # optional: move to this x z (metres) by phase end
    cue "<short coaching cue>"
  repeat <count>
```

## Joints

`neck head spine chest pelvis` and (singular or plural) `shoulders elbows
forearms wrists hips knees ankles`. `forearms` is an anatomical alias for the
two elbow bones when authoring palm roll. Plural names move both sides symmetrically; use
`elbow_left` etc. for one side. Fingers: `fingers` (or `fingers_left` /
`fingers_right`), and individually `thumb_* index_* middle_* ring_* pinky_*`.

## Actions (degrees are absolute targets)

- `flex` / `extend`: bend / straighten (sagittal)
- `abduct` / `adduct`: away from / toward midline (frontal)
- `rotate-in` / `rotate-out`: internal / external rotation of a shoulder or hip
- `twist-left` / `twist-right`: turn an axial joint (spine, chest, neck, or
  head) toward the named side
- `supinate` / `pronate`: forearm roll toward palm-up / palm-down. With upright
  arms at the sides, `forearms: pronate 80` faces the palms inward toward the
  thighs and `pronate 0` faces them forward. Shoulder/elbow pose still affects
  the final world-facing direction. Since targets are absolute, `pronate 0`
  and `supinate 0` resolve to the same zero-angle reference.
- `dorsiflex` / `plantarflex`: ankle up / down
- `hinge`: **hip hinge** (on `pelvis` only): tip the torso forward over the
  hips with a flat back, legs staying planted. Use this, not spinal `flex`,
  for a deadlift, bent-over row, good-morning, or a bow.
- `hold neutral`: set every channel on that joint to its rest value (no angle)

Use only anatomically compatible pairs. Examples: knees take flex/extend, ankles
take dorsiflex/plantarflex, elbows/forearms take flex/extend/pronate/supinate, wrists take
flex/extend/abduct/adduct, and `hinge` belongs only to the pelvis. The validator
rejects globally-known actions on the wrong joint; never use the absence of a
warning as permission to invent a pairing.

## Rules

1. Break the movement into 2–6 concurrent **phases**; each `step` is the time
   taken to arrive at one key pose. A duration is not a dwell.
2. Set only the channels that change. Unset channels hold their previous value;
   `hold neutral` deliberately resets the whole joint.
3. Stay within Posecode's configured range-of-motion bounds (for example, knee
   flex ≤ 144°, elbow flex ≤ 154°, shoulder flex ≤ 180°). These bounds
   constrain the rig; they do not certify a movement as safe. Do not stack a
   pelvis hinge and hip flexion past the hip's combined limit.
4. Choose one lead/trail convention and keep it across joint targets, contacts,
   phase names, and cues. Mirror all four together when switching sides.
5. Declare every load-bearing contact in every phase where it remains active.
   Contacts do not inherit. Use side-specific support for lunges, kneeling, and
   single-leg work; `ground-lock: feet` is for two genuinely planted feet.
   Ground contacts are a closed vocabulary: use `ground-lock: hands, feet` in a
   high plank, `ground-lock: forearms, feet` in a forearm plank, and
   `ground-lock: back` for supine floor work. Do not invent contact names.
6. Use `ground-lock` only for floor supports already meant to stay planted.
   Use `reach` to move a limb to a target, `pin` when a single contact must move
   the whole body, and `grip` for a bar or rails. Never combine `ground-lock`,
   `pin`, or `grip` root solvers in one step; use one primary support plus
   per-limb `reach` constraints for the remaining contacts.
7. Author the gross body position before adding `reach`. A hand cannot reach a
   floor that the torso/legs leave outside the arm's reachable workspace.
8. Derive each cue from the actual commands. Remove phrases such as “foot
   forward,” “knee down,” “fist planted,” or “arm overhead” unless that exact
   side and constraint are encoded.
9. Use `linear` only for an unchanged dwell or intentionally mechanical motion.
   A moving phase that arrives at a landing or hold should normally `settle`.
10. Add an explicit unchanged step for a visible hold, repeating its active
    contacts. Then author a controlled recovery when the movement should loop.
11. Declare a prop before using its anchor; never invent target names.
12. Set `repeat` to the requested repetition count.

Before returning the document, privately run this final check:

- Every word comes from the closed vocabulary, and every action is compatible
  with its joint.
- Each cue can be traced to a joint target or an active contact on the same
  body side.
- Every required support is declared in every phase where it remains active.
- The gross pose makes each reach plausible; a reach line is not permission to
  leave the target outside the limb's workspace.
- The final hold and recovery are explicit, warning-free, and do not rely on
  an undeclared prop or unsupported physics.

## Timing modes

- `flow`: carry momentum through an interior pose; use for continuous dance,
  locomotion, and multi-part sports motion.
- `settle`: decelerate into a real rest; use at a squat bottom, landing, hold,
  or final pose.
- `drive`: accelerate from rest; use for a jump, push, lift, or recoil.
- `snap`: arrive quickly and stop sharply; use for a strike or release.
- `linear`: constant timing; best for an unchanged dwell or mechanical motion.

The older names `ease-in`, `ease-out`, and `ease-in-out` still parse for
compatibility, but do not author new documents with them.

## Example

```posecode
posecode exercise "Body-weight squat"
  rig humanoid
  pose start = standing

  step "Descend" 1.6s settle:
    hips: flex 80
    knees: flex 95
    pelvis: hinge 25
    spine: flex 0
    shoulders: flex 70
    neck: extend 10
    ground-lock: feet
    cue "Flex both hips and knees as the pelvis hinges over the planted feet"

  step "Drive up" 1.2s drive:
    hips: flex 0
    knees: flex 0
    pelvis: hinge 0
    spine: flex 0
    shoulders: flex 0
    neck: extend 0
    ground-lock: feet
    cue "Straighten both hips and knees and return the torso and arms to neutral"

  repeat 8
```

## Hip-hinge example

A flat-back hinge bends at the **hips**, not the spine. Hinge the `pelvis` and
let the arms hang; `ground-lock: feet`.

```posecode
posecode exercise "Body-weight hip hinge"
  rig humanoid
  pose start = standing

  step "Lower" 1.8s settle:
    pelvis: hinge 75
    knees: flex 25
    shoulders: flex 70
    ground-lock: feet
    cue "Hips back and back flat as the arms hang below the shoulders"

  step "Lift" 1.4s drive:
    pelvis: hinge 0
    knees: flex 0
    shoulders: flex 0
    ground-lock: feet
    cue "Drive the hips forward and return to a tall stance"

  repeat 8
```

## Reaching, props, lying poses & hands

- **Reach a target**: `reach: <effector> <target>` drives a supported limb
  endpoint to a world point via IK. Effectors include side-specific hands,
  fists, elbows, knees, and feet, with groups such as `hands`, `fists`,
  `forearms`, `knees`, and `feet`. Targets are a body landmark bone
  (`ankle_left`, `knee_right`…), `floor`, or a prop anchor (`bar`, `seat`,
  `wall`). The solve is ROM-constrained: the arm/leg remains within configured
  joint bounds while chasing a target, so an out-of-reach target yields the
  closest bounded pose and a residual diagnostic. Author the gross pose (e.g.
  a `pelvis: hinge`), then
  let `reach` finish the hand placement. Example, touch your toes:

  ```posecode
  step "Fold" 2.5s settle:
    pelvis: hinge 95
    knees: flex 12
    reach: hand_left ankle_left
    reach: hand_right ankle_right
    ground-lock: feet
    cue "Hinge and reach toward the ankles"
  ```

  A hand or fist sent to the floor is also oriented onto its palm or knuckles.
  That explicit surface contact can adjust forearm/wrist roll within ROM, so do
  not fight it with a contradictory palm-facing cue.

- **Props**: `prop chair | wall | bar | box | dip-bars` (top level). The chair
  sits behind the figure (sit-to-stand, box squat), the wall behind that (wall
  sit), the bar overhead, the box in front (step-ups), and the dip bars either
  side at hip-press height (`grip: hands bars` + elbow flex = triceps dips).
- **Pins**: `pin: <effector> <anchor>` moves the whole BODY so the effector sits
  on the anchor (vs `reach`, which moves just the limb). Use one primary pin for
  body translation: `pin: foot_right box` can support a step-up, and
  `pin: pelvis floor` can keep the pelvis on the mat. Use `grip`, not several
  simultaneous hand pins, for a bar or rails.
- **Grips**: `grip: hands bar` or `grip: hands bars` is the dedicated two-hand
  prop contact. It assigns separate left/right anchors, solves both arms, and
  closes the fingers. Declare `prop bar` or `prop dip-bars` first. Prefer this
  to multiple pins for a pull-up, hang, or dip.
- **Lying / seated**: `pose start = supine | prone | seated` for floor and mat
  work (glute bridge, dead bug, cobra, seated forward fold). In a supine
  exercise whose torso stays down, add `ground-lock: back` to each phase.
- **Hands**: `fingers: flex 80` makes a fist; curl individual fingers for shapes
  (`index_right: flex 95`). Single-DOF per finger, good for grip and rough
  gesture, not exact sign language.

## Three-point superhero landing

A landing is defined by its contacts, not by a dramatic cue. Keep the existing
front-foot support planted while reach constraints blend the rear knee and
same-side fist down. Once the knee has arrived, hand the whole-body anchor to
that knee and solve the foot and fist independently. Repeat the three contacts
through the hold; never combine a whole-root pin with `ground-lock` in one step.

```posecode
posecode posture "Superhero Three-Point Landing"
  rig humanoid
  pose start = standing

  step "Drop into the landing" 0.55s flow:
    pelvis: hinge 45
    spine: flex 50
    chest: flex 9
    hip_right: flex 84
    knee_right: flex 123
    ankle_right: dorsiflex 15
    hip_left: extend 12
    knee_left: flex 105
    ankle_left: plantarflex 28
    shoulder_left: flex 98
    shoulder_left: abduct 2
    elbow_left: flex 8
    fingers_left: flex 80
    shoulder_right: extend 24
    shoulder_right: abduct 22
    elbow_right: flex 16
    ground-lock: foot_right
    reach: knee_left floor
    reach: fist_left floor
    cue "Drop over the planted right foot as the left knee and fist descend"

  step "Make three-point contact" 0.3s settle:
    neck: extend 25
    pin: knee_left floor
    reach: foot_right floor
    reach: fist_left floor
    cue "Set the left knee and left fist on the floor beside the planted right foot"

  step "Hold the landing" 0.8s linear:
    pin: knee_left floor
    reach: foot_right floor
    reach: fist_left floor
    cue "Hold the three contacts with the free right arm swept behind you"

  step "Recover to standing" 0.9s drive:
    pelvis: hold neutral
    spine: hold neutral
    hips: hold neutral
    knees: hold neutral
    ankles: hold neutral
    neck: hold neutral
    chest: hold neutral
    shoulders: hold neutral
    elbows: flex 0
    fingers_left: hold neutral
    ground-lock: feet
    cue "Press through both feet and return to standing"

  repeat 1
```

## Authoring by domain

The same grammar covers many fields. A few patterns that read well:

- **Anatomy / education**: isolate one joint and sweep it through its range
  (`shoulders: abduct 160` → `0`). Name the plane in the cue. Great for teaching.
- **Physiotherapy**: gentle, single-joint reps; for one-sided work use a
  singular joint (`knee_right: flex 95`) and explicitly plant the stance foot,
  for example `ground-lock: foot_left`.
- **Desk / posture**: slow `stretch` documents with `ground-lock: feet`;
  contrast a "collapsed" phase with a "tall" reset.
- **Sports / martial arts**: short phases (0.2–0.6s); use `flow` through a
  gather/chamber, `drive` for takeoff, and `snap` on the strike or release.

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
steps; the figure carries its pose forward. Use `ground-lock: feet` for grounded
phrases (it still lets the figure turn and travel; it only keeps the feet on the
floor vertically).
