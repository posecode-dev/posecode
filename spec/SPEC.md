# Posecode Protocol Specification v0.1

Posecode is a small text language for describing a single person's **kinematic
movement** so it can be rendered as an animated 3D figure in a web browser.

It is to human movement what Mermaid is to diagrams: an LLM (or a human) writes
a compact, readable document; a client-side parser + renderer turns it into a
moving mannequin. The model never produces 3D matrices: it expresses the
*semantic phases* of a movement, which it already understands.

- **Version keyword:** documents declare nothing; this is `posecode 0.1`.
- **File extension:** `.posecode`
- **Compute model:** generation is pure text (server-cheap); all 3D math runs
  on the client (Three.js). See the project research §6.

---

## 1. Grammar

Posecode is line- and indentation-oriented. Comments start with `#` or `//`.

```ebnf
document   = header { directive } ;
header     = "posecode" kind STRING ;
kind       = "exercise" | "stretch" | "posture" ;       (* free-form word *)
directive  = rig | prop | pose | clip | step | repeat ;
rig        = "rig" WORD ;
prop       = "prop" WORD ;                              (* chair|wall|bar|box|dip-bars, repeatable *)
pose       = "pose" "start" "=" WORD ;                  (* neutral|standing|plank|supine|prone|seated *)
clip       = "clip" STRING ;                            (* optional mocap clip; renderer may retarget & blend *)
repeat     = "repeat" NUMBER ;
step       = "step" STRING DURATION easing ":" { child } ;
easing     = "linear" | "ease-in" | "ease-out" | "ease-in-out" ;
child      = jointTarget | groundLock | reach | pin | turn | travel | cue ;
jointTarget= joint ":" action [ NUMBER ] ;
groundLock = "ground-lock" ":" effector { "," effector } ;
reach      = "reach" ":" effector target ;             (* effector → world target via ROM-constrained IK *)
pin        = "pin" ":" effector anchor ;               (* move the BODY so effector sits on anchor *)
turn       = "turn" ":" NUMBER ;                       (* face this yaw (deg) by phase end *)
travel     = "travel" ":" NUMBER NUMBER ;              (* move to this x z (metres) by phase end *)
cue        = "cue" STRING ;
DURATION   = NUMBER "s" ;                                (* e.g. 2s, 1.5s *)
```

A `step` is one **phase** of the movement. Phases run in sequence; within a
phase, all joint targets apply concurrently.

---

## 2. Joints

| Group (plural) | Bones | Singular forms |
| --- | --- | --- |
| `shoulders` | `shoulder_left`, `shoulder_right` | yes |
| `elbows` | `elbow_left`, `elbow_right` | yes |
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
| `supinate` / `pronate` | Y | forearm turn |
| `dorsiflex` / `plantarflex` | X | ankle up / down |
| `hinge` | X | tip the torso forward over the hips (`pelvis` only) |
| `hold neutral` | n/a | keep at rest |

`hinge` is a **hip hinge**: applied to the `pelvis`, it pivots the torso forward
over the hip line while the legs stay planted and vertical (the renderer
counter-rotates the hips). Use it, not spinal `flex`, for a flat-back forward
bend: deadlift, bent-over row, good-morning, or a bow.

**Coordinate convention:** rest pose is standing, arms at sides, facing +Z. The
renderer's mannequin is built in this same convention so the parser's resolved
Euler angles apply directly.

---

## 4. Range of Motion (safety)

Every angle is **hard-clamped** to a healthy Range of Motion before rendering;
a clamp emits a warning (it does not fail the parse). Limits follow the
research §5.1 normative tables. Selected ceilings (degrees):

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

>  These are general literature values, not medical advice. Consult a
> qualified professional for physiotherapy or exercise prescription.

---

## 5. Rendering model

1. **Forward kinematics**: each phase sets joint angles; the renderer slerps
   bone rotations between phases with the phase's easing.
2. **Grounding**: the figure is dropped so its lowest point rests on the floor
   (a bounding-box drop), which grounds standing, plank, and the lying/seated
   poses alike.
3. **Ground-lock IK**: effectors listed in `ground-lock` (`hands`, `feet`) are
   pinned to their planted floor position so they stay put while the body moves.
4. **Reach-IK**: a `reach:` line drives an effector (`hand_left|hand_right|
   foot_left|foot_right`, or the groups `hands`/`feet` for both sides) to a
   world **target** via Cyclic Coordinate Descent (CCD) over the arm/leg chain.
   A target is a body landmark bone (e.g. `ankle_left`), the keyword `floor`,
   or a prop anchor (`bar`, `seat`, `wall`). The solve is **ROM-constrained**:
   each iteration clamps every chain joint into its §4 Range-of-Motion limits
   (expressed as a per-axis box in the bone's local Euler frame), so a reach
   toward an unsafe or unreachable target settles on the closest *healthy*
   pose; solved angles obey the same hard limits as authored ones.
5. **Props**: `prop chair|wall|bar|box|dip-bars` adds a scene object at a
   fixed default placement (chair/wall behind, bar overhead, box in front,
   dip bars either side); its named anchors (`seat`, `wall`, `bar`, `box`,
   `bars`) become reach/pin targets. Props are **solid**: each prop declares
   blocking faces (the wall's surface, the chair's backrest and seat edge,
   the box's near face) and a contact pass removes any body overlap — either
   by translating the whole figure out along the face normal (a wall-sit
   slides down the wall's *surface*, feet walking forward, instead of the
   torso hinging through the slab) or by bending the offending limb's hip
   clear, ROM-clamped like every other solve. Limbs pinned, gripped, or
   reached to a prop anchor are that phase's declared support and are exempt
   (a foot standing on the box top is not "inside" the box).
6. **Pins**: `pin: <effector> <anchor>` translates the whole figure so the
   effector sits on the anchor (effectors accept the same `hands`/`feet` groups
   as reach: `pin: hands bar` pins both). Where ground-lock keeps a foot on
   the floor and reach moves a limb to a target, a **pin moves the body** while
   the contact stays put, so the figure hangs from a bar, pulls up toward it,
   rises onto a box, or lowers into a dip as the joints work.
   Symmetric bar contacts resolve to side-specific anchors automatically
   (`bar.left` / `bar.right`, `bars.left` / `bars.right`). Contact post-processing
   also keeps floor-contacting soles level and gives bar-contacting wrists a
   stable overhand orientation; existing Posecode syntax remains unchanged.
7. **Spatial choreography**: `turn: <deg>` rotates the figure's facing (yaw
   about vertical) and `travel: <x> <z>` moves it across the floor (world metres
   from the load spot). Both are **absolute targets carried across phases** (like
   joint angles) and both return home on the loop wrap, so a box-step traces a
   square back to start and a pirouette spins a full turn. They layer under
   grounding (feet still rest on the floor) and power pirouettes, grapevines,
   traveling combos, and walk cycles. **Standing poses only**: combining with
   lying/seated bases (whose root is already tilted) is out of scope.
8. **Looping**: the timeline loops base → phases → base; `repeat` is the rep
   count surfaced to the UI.

When a mocap clip is active, the renderer selects the take containing the most
actual bone motion (rather than blindly choosing the longest embedded take),
retargets and blends it, then restores solved terminal contacts on the visible
character. Mocap therefore cannot overwrite a planted sole or pinned grip.

**Start poses:** `neutral`, `standing`, `plank`, `supine` (face-up), `prone`
(face-down), `seated` (long-sit on the floor).

**IK note:** Three.js's bundled `CCDIKSolver` targets `SkinnedMesh`; the Posecode
mannequin is rigid capsule segments, so Posecode implements CCD directly over the
Object3D bone hierarchy (`posecode-render/ik.ts`) for both ground-lock and reach.
Self-collision (limb-vs-body) and body-vs-prop contact are solved; two-person/
dual-IK and figure-vs-figure collision remain deferred (research §5.2, §6.2).

---

## 6. Intermediate Representation (IR)

`parse(source)` returns `{ ir, warnings, errors }`. The IR is renderer-agnostic;
angles are in **degrees**.

```ts
interface PosecodeIR {
  version: string;          // "0.1"
  kind: string;             // "exercise" | "stretch" | "posture"
  name: string;
  rig: string;              // "humanoid"
  startPose?: string;       // "plank" | "standing" | ...
  repeat: number;
  phases: {
    name: string;
    durationSec: number;
    easing: "linear" | "ease-in" | "ease-out" | "ease-in-out";
    targets: { boneId: string; euler: { x: number; y: number; z: number } }[];
    groundLock: string[];   // ["hands","feet"]
    cue?: string;
  }[];
}
```

See [`llm-authoring.md`](./llm-authoring.md) for the prompt that teaches an LLM
to write Posecode, and [`examples/`](./examples) for complete documents.
