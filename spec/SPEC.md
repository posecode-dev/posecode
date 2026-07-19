# Posecode Protocol Specification v0.3

Posecode is a small text language for describing a single person's **kinematic
movement** so it can be rendered as an animated 3D figure in a web browser.

This document is the **normative language and IR contract**. The
[LLM authoring guide](https://posecode.org/llm-guide.html) is task-oriented and
pasteable; it is intentionally self-contained, but it must not define syntax or
behavior that differs from this specification.

It is to human movement what Mermaid is to diagrams: an LLM (or a human) writes
a compact, readable document; a client-side parser + renderer turns it into a
moving mannequin. The model never produces 3D matrices: it expresses the
*semantic phases* of a movement, which it already understands.

- **Version keyword:** documents declare nothing; this is `posecode 0.3`.
- **Compatibility:** v0.3 parsers continue to accept v0.2 documents and the
  v0.1 easing aliases.
- **File extension:** `.posecode`
- **Compute model:** generation is pure text (server-cheap); all 3D math runs
  on the client (Three.js). See the project research §6.

---

## 1. Grammar

Posecode is line- and indentation-oriented. Comments start with `#` or `//`.

```ebnf
document   = header { directive } ;
header     = "posecode" kind STRING ;
kind       = "exercise" | "stretch" | "posture" ;
directive  = rig | prop | pose | clip | step | repeat ;
rig        = "rig" "humanoid" ;
prop       = "prop" ("chair"|"wall"|"bar"|"box"|"dip-bars") ;
pose       = "pose" "start" "=" startPose [ ":" { startOverride } ] ;
startOverride = jointTarget ;                         (* indented; sparse overlay, not a phase *)
startPose  = "neutral"|"standing"|"first-position"|"plank"|"supine"|"prone"|"seated" ;
clip       = "clip" STRING ;                            (* optional mocap clip; renderer may retarget & blend *)
repeat     = "repeat" NUMBER ;
step       = "step" STRING DURATION timingMode ":" { child } ;
timingMode = "flow" | "settle" | "drive" | "snap" | "linear" ;
child      = jointTarget | groundLock | reach | pin | grip | turn | travel | cue ;
jointTarget= joint ":" action [ NUMBER ] ;
groundLock = "ground-lock" ":" floorContact { "," floorContact } ;
floorContact = "hands" | "forearms" | "feet" | "back"
             | ( "hand" | "elbow" | "foot" ) "_" ( "left" | "right" )
             | ( "left" | "right" ) ( "hand" | "forearm" | "elbow" | "foot" ) ;
reach      = "reach" ":" effector target ;             (* effector → world target via ROM-constrained IK *)
pin        = "pin" ":" effector anchor ;               (* move the BODY to one primary contact *)
grip       = "grip" ":" handEffector gripAnchor ;      (* hand contact on a bar or rails *)
handEffector = "hands" | "hand_left" | "hand_right" ;
gripAnchor = "bar" | "bars" ;
turn       = "turn" ":" NUMBER ;                       (* face this yaw (deg) by phase end *)
travel     = "travel" ":" NUMBER NUMBER ;              (* move to this x z (metres) by phase end *)
cue        = "cue" STRING ;                              (* display-only coaching text *)
DURATION   = NUMBER "s" ;                                (* e.g. 2s, 1.5s *)
```

A `step` is one **phase** of the movement. Phases run in sequence; within a
phase, all joint targets apply concurrently.

A built-in start pose can be customized with an indented override block:

```posecode
  pose start = standing:
    shoulders: flex 20
    elbow_left: flex 35
```

The existing one-line form remains valid. Start-pose targets use the same
joint/action vocabulary, channel mirroring, compatibility checks, and ROM
clamping as phase targets, but they do not create a phase or consume time.
They sparsely overlay the selected built-in pose: omitted channels keep the
built-in value, while `hold neutral` resets all three channels on that joint.
The composed start pose is the deterministic animation start and loop-reset
pose. Contacts, root travel/turn, cues, and other step-only directives are not
valid inside this block.

A document may contain at most one `pose start` declaration. A second
declaration is an error rather than a replacement, so an earlier scoped block
cannot be bypassed before its joint/action vocabulary is validated.

The header kind, rig, props, start poses, joints, actions, effectors, targets,
and timing modes are closed vocabularies. Unknown values are errors; the parser
does not accept a plausible-looking word and leave it for the renderer to ignore.

Contact target vocabularies are capability-specific. `reach` accepts `floor`, a
rig body landmark, or an anchor from a declared prop. `pin` accepts only fixed
world anchors (`floor` or a declared prop anchor), because translating the root
cannot pin one body landmark to another landmark that moves with that same root.
`grip` accepts only anchors supplied by a declared `bar` or `dip-bars` prop.
Grouped `grip: hands ...` uses the bare `bar` / `bars` anchor and expands to
separate left/right anchors; an explicitly sided grip anchor is valid only with
the matching single-hand effector.

### Contact mechanisms

| Directive | What the solver does | Use it when |
| --- | --- | --- |
| `ground-lock` | Preserves an existing floor support while the rest of the body moves. | A foot, hand, forearm, or the back is already planted. |
| `reach` | Moves a limb endpoint toward a target through ROM-constrained IK; it does not translate the body root. | An additional hand, fist, elbow, knee, or foot must meet a floor, landmark, or prop target. |
| `pin` | Translates the whole body so one primary effector stays on a fixed anchor. | One contact should carry or reposition the body, such as a knee on the floor or foot on a box. |
| `grip` | Translates the body, solves each gripping arm to a bar or rail, and closes the fingers. | One or both hands support the body on a declared `bar` or `dip-bars` prop. |

`ground-lock`, `pin`, and `grip` are mutually exclusive root-solving families
within one phase. Choose one primary support family, then express compatible
additional contacts with independent `reach` constraints. The parser rejects
conflicting combinations instead of silently choosing a solver order.

`cue` is display-only coaching metadata. The parser stores it in the IR and a
viewer may show it alongside the current phase, but it does not alter joint
targets, contacts, timing, range validation, or rendering solves. A cue should
describe only motion that the phase's executable directives actually encode.

Ground locks accept the groups `hands`, `forearms`, and `feet`, the axial
surface contact `back`, plus the single-side forms `hand_left|hand_right`,
`elbow_left|elbow_right`, and `foot_left|foot_right`. Human-readable `left foot`,
`right foot`, `left hand`, and related forms normalize to the canonical
side-specific names.

Timing modes describe how motion crosses the phase boundary:

| Mode | Use |
| --- | --- |
| `flow` | Carry velocity smoothly through the pose. |
| `settle` | Decelerate into a deliberate rest. |
| `drive` | Accelerate out of rest. |
| `snap` | Arrive quickly and stop sharply. |
| `linear` | Even timing without a shaped acceleration curve. |

Legacy v0.1 spellings remain valid and normalize to canonical modes:
`ease-in` → `drive`, `ease-out` → `settle`, and `ease-in-out` → `settle`.
New documents should use the canonical v0.2 names.

---

## 2. Joints

| Group (plural) | Bones | Singular forms |
| --- | --- | --- |
| `shoulders` | `shoulder_left`, `shoulder_right` | yes |
| `elbows` | `elbow_left`, `elbow_right` | yes |
| `forearms` (alias) | `elbow_left`, `elbow_right` | use `elbow_left` / `elbow_right` |
| `wrists` | `wrist_left`, `wrist_right` | yes |
| `hips` | `hip_left`, `hip_right` | yes |
| `knees` | `knee_left`, `knee_right` | yes |
| `ankles` | `ankle_left`, `ankle_right` | yes |
| axial | `pelvis`, `spine`, `chest`, `neck`, `head` | n/a |
| `fingers` (or `fingers_left` / `fingers_right`) | `thumb_*`, `index_*`, `middle_*`, `ring_*`, `pinky_*` | yes |

Plural names move both sides symmetrically (left-side bones mirror the Y and Z
axes). Use a singular `*_left` / `*_right` name to move one side. Each finger is a
single curl (`flex`) joint; the thumb also takes `abduct`/`adduct`.

---

## 3. Actions

Each action maps to a rotation about one local axis. Degrees are **absolute
targets** for that direction (a phase that doesn't mention a joint leaves it
where the previous phase left it).

| Action | Axis | Meaning |
| --- | --- | --- |
| `flex` / `extend` | X (sagittal) | bend / straighten |
| `abduct` / `adduct` | Z (frontal) | away from / toward midline |
| `rotate-in` / `rotate-out` | Y (longitudinal) | internal / external rotation |
| `twist-left` / `twist-right` | Y (longitudinal) | unambiguous axial turn for spine, chest, neck, or head |
| `supinate` / `pronate` | Y | forearm roll toward palm-up / palm-down |
| `dorsiflex` / `plantarflex` | X | ankle up / down |
| `hinge` | X | tip the torso forward over the hips (`pelvis` only) |
| `hold neutral` | all | reset every channel on the named joint to rest |

`hinge` is a **hip hinge**: applied to the `pelvis`, it pivots the torso forward
over the hip line while the legs stay planted and vertical (the renderer
counter-rotates the hips). Use it, not spinal `flex`, for a flat-back forward
bend: deadlift, bent-over row, good-morning, or a bow.

`rotate-in` / `rotate-out` describe internal and external rotation only on a
shoulder or hip. Use `twist-left` / `twist-right` for axial bones; older axial
uses of rotate-in/out remain readable during the compatibility window but emit
an authoring hint.

Each authored action changes one Euler channel. Other channels on that joint
carry forward from the prior phase. `hold neutral` is the deliberate exception:
it resets all three channels, so it is suitable for an explicit recovery.

Forearm roll is authored on `elbows` or its anatomical alias `forearms` because
the wrist itself does not pronate. With upright arms at the sides,
`forearms: pronate 80` faces the palms inward toward the thighs; `pronate 0`
faces them forward. The final world-facing direction also depends on shoulder
and elbow pose, so use `supinate` / `pronate` as anatomical rotation rather than
as an absolute world-space palm constraint. Because targets are absolute,
`pronate 0` and `supinate 0` name the same zero-angle reference; the action name
selects the direction only when the authored magnitude is greater than zero.

**Coordinate convention:** rest pose is standing, arms at sides, facing +Z. The
renderer's mannequin is built in this same convention so the parser's resolved
Euler angles apply directly.

---

## 4. Configured range-of-motion limits

Every authored angle is clamped to the rig's configured per-axis limits before
rendering; a clamp emits a warning (it does not fail the parse). Reach IK and
contact orientation are constrained against the same per-axis boxes. These are
simplified reference limits for visualization, not a medical or whole-movement
safety guarantee. Selected ceilings (degrees):

| Joint | flex | extend | abduct | other |
| --- | --- | --- | --- | --- |
| shoulder | 180 | 60 | 180 | rot-in 70 / rot-out 90 |
| elbow | 154 | 10 | n/a | supinate 92 / pronate 84 |
| hip | 135 | 20 | 45 | n/a |
| knee | 144 | 5 | n/a | n/a |
| ankle | n/a | n/a | n/a | dorsiflex 15 / plantarflex 50 |
| pelvis | n/a | n/a | n/a | hinge 120 |
| finger | 100 | 20 | n/a | n/a |
| thumb | 80 | 20 | 50 | adduct 30 |
| spine | 90 | 30 | 35 | rotate 45 |
| neck | 50 | 60 | 45 | rotate 80 |

**Note:** These are general literature values, not medical advice. Consult a
qualified professional for physiotherapy or exercise prescription.

A pelvis hinge counter-rotates the hips in the renderer. The validator therefore
also checks the **combined** hinge + carried hip-flexion result and clamps the
newly authored channel when their composed local hip angle would exceed 135°.

---

## 5. Rendering model

1. **Forward kinematics**: each phase sets joint angles; the renderer uses
   C1-continuous quaternion splines between keyframes, shaped by the destination
   phase's timing mode.
2. **Grounding**: the figure is dropped so its lowest point rests on the floor
   (a bounding-box drop), which grounds standing, plank, and the lying/seated
   poses alike.
3. **Ground-lock**: contacts listed in `ground-lock` (`hands`, `forearms`,
   `feet`, or the per-side aliases `hand_left|hand_right`,
   `elbow_left|elbow_right`, `foot_left|foot_right`) stay planted while the body
   moves. `back` holds the pelvis-to-ribcage surface on the floor for supine
   work such as dead bugs. Unsupported contact names are line-anchored
   validation errors.
4. **Reach-IK**: a `reach:` line drives an effector (`hand_*`, `fist_*`,
   `elbow_*`, `knee_*`, or `foot_*`, plus their supported groups) to a
   world **target** via Cyclic Coordinate Descent (CCD) over the arm/leg chain.
   A target is a body landmark bone (e.g. `ankle_left`), the keyword `floor`,
   or a prop anchor (`bar`, `seat`, `wall`). The solve is **ROM-constrained**:
   each iteration clamps every chain joint into its §4 configured
   range-of-motion limits (expressed as a per-axis box in the bone's local
   Euler frame), so a reach
   toward an unreachable target settles on the closest pose available within
   that configured joint-angle box; solved angles obey the same limits as
   authored ones. The viewer records a post-solve residual for every active
   reach. A reach target is not reported as reached merely because its syntax
   parsed: missing, unsupported, and geometrically unreachable reach targets
   remain explicit diagnostics. A palm or fist declared against the floor also
   presents its matching contact surface to the floor. For a palm, the solver
   may redistribute incompatible authored roll into a legal forearm/wrist frame;
   the explicit floor contact takes priority, and every adjusted joint remains
   inside the same configured ROM.
5. **Props**: `prop chair|wall|bar|box|dip-bars` adds a scene object at a
   fixed default placement (chair/wall behind, bar overhead, box in front,
   dip bars either side); its named anchors (`seat`, `wall`, `bar`, `box`,
   `bars`) become reach, pin, or grip targets. Selected prop surfaces declare
   sampled blocking faces (the wall's surface, the chair's backrest and seat
   edge, the box's near face). A bounded contact pass reduces penetration,
   either by translating the whole figure out along the face normal (a wall-sit
   slides down the wall's *surface*, feet walking forward, instead of the
   torso hinging through the slab) or by bending the offending limb's hip
   clear, ROM-clamped like every other solve. Limbs pinned, gripped, or
   reached to a prop anchor are that phase's declared support and are exempt
   (a foot standing on the box top is not "inside" the box).
6. **Pins**: `pin: <effector> <anchor>` translates the whole figure so one
   primary effector sits on the anchor. Where ground-lock preserves an already
   planted floor support and reach moves a limb to a target, a **pin moves the
   body**. Typical uses include `pin: knee_left floor`, `pin: foot_right box`,
   and `pin: pelvis floor`. A phase accepts one pin because each pin translates
   the same floating root; express additional simultaneous contacts with
   independent `reach` constraints. Use `grip` instead of hand pins for a
   two-handed bar or rail contact.
7. **Grips**: `grip: hands bar|bars` is the dedicated two-hand contact for an
   overhead bar or dip rails; side-specific `hand_left` / `hand_right` forms are
   also available. A grip resolves independent left/right anchors, uses arm IK
   for each hand, orients the terminal contact, and closes the fingers. The
   matching prop must be declared. Use grips, rather than hand pins, for hangs,
   pull-ups, and dips.
8. **Spatial choreography**: `turn: <deg>` rotates the figure's facing (yaw
   about vertical) and `travel: <x> <z>` moves it across the floor (world metres
   from the load spot). Both are **absolute targets carried across phases** (like
   joint angles) and both return home on the loop wrap, so a box-step traces a
   square back to start and a pirouette spins a full turn. They layer under
   grounding (feet still rest on the floor) and power pirouettes, grapevines,
   traveling combos, and walk cycles. **Standing poses only**: combining with
   lying/seated bases (whose root is already tilted) is out of scope.
9. **Looping**: the timeline loops base → phases → base; `repeat` is the rep
   count surfaced to the UI.

When a mocap clip is active, the renderer selects the take containing the most
actual bone motion (rather than blindly choosing the longest embedded take),
retargets and blends it, then restores solved terminal contacts on the visible
character. Mocap therefore cannot overwrite a planted sole or active grip.

**Start poses:** `neutral`, `standing`, `first-position` (ballet turnout),
`plank`, `supine` (face-up), `prone` (face-down), `seated` (long-sit on the
floor). Append `:` and indented joint targets to define a custom start pose as
a sparse overlay on any of these built-ins.

**IK note:** Three.js's bundled `CCDIKSolver` targets `SkinnedMesh`; the Posecode
mannequin is rigid capsule segments, so Posecode implements CCD directly over the
Object3D bone hierarchy (`posecode-render/ik.ts`) for both ground-lock and reach.
Selected limb-vs-body and body-vs-prop penetrations are reduced with sampled,
bounded correction passes; this is not comprehensive collision detection or a
physics simulation. Two-person/dual-IK and figure-vs-figure collision remain
deferred (research §5.2, §6.2).

---

## 6. Intermediate Representation (IR)

`parse(source)` returns `{ ir, warnings, errors }`. The IR is renderer-agnostic;
angles are in **degrees**.

```ts
interface PosecodeIR {
  version: string;          // "0.3"
  kind: string;             // "exercise" | "stretch" | "posture"
  name: string;
  rig: string;              // "humanoid"
  startPose?: string;       // "plank" | "standing" | ...
  startPoseOverrides?: {    // sparse, ROM-clamped overlay on startPose
    boneId: string;
    euler: { x: number; y: number; z: number };
    axes?: ("x" | "y" | "z")[];
  }[];
  repeat: number;
  phases: {
    name: string;
    durationSec: number;
    easing: "flow" | "settle" | "drive" | "snap" | "linear";
    targets: {
      boneId: string;
      euler: { x: number; y: number; z: number };
      axes?: ("x" | "y" | "z")[]; // channels explicitly authored this phase
    }[];
    groundLock: string[];   // ["hands","feet"], ["foot_right"], or ["back"]
    reaches: { effector: string; target: string }[];
    pins: { effector: string; anchor: string }[];
    grips: { effector: string; anchor: string }[];
    turnDeg?: number;
    travel?: { x: number; z: number };
    cue?: string;
  }[];
}
```

See [`llm-authoring.md`](./llm-authoring.md) for the prompt that teaches an LLM
to write Posecode, and [`examples/`](./examples) for complete documents.
