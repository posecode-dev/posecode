# Movit Protocol Specification — v0.1

Movit is a small text language for describing a single person's **kinematic
movement** so it can be rendered as an animated 3D figure in a web browser.

It is to human movement what Mermaid is to diagrams: an LLM (or a human) writes
a compact, readable document; a client-side parser + renderer turns it into a
moving mannequin. The model never produces 3D matrices — it expresses the
*semantic phases* of a movement, which it already understands.

- **Version keyword:** documents declare nothing; this is `movit 0.1`.
- **File extension:** `.movit`
- **Compute model:** generation is pure text (server-cheap); all 3D math runs
  on the client (Three.js). See the project research §6.

---

## 1. Grammar

Movit is line- and indentation-oriented. Comments start with `#` or `//`.

```ebnf
document   = header { directive } ;
header     = "movit" kind STRING ;
kind       = "exercise" | "stretch" | "posture" ;       (* free-form word *)
directive  = rig | pose | step | repeat ;
rig        = "rig" WORD ;
pose       = "pose" "start" "=" WORD ;                  (* neutral|standing|plank *)
repeat     = "repeat" NUMBER ;
step       = "step" STRING DURATION easing ":" { child } ;
easing     = "linear" | "ease-in" | "ease-out" | "ease-in-out" ;
child      = jointTarget | groundLock | cue ;
jointTarget= joint ":" action [ NUMBER ] ;
groundLock = "ground-lock" ":" effector { "," effector } ;
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
| axial | `pelvis`, `spine`, `chest`, `neck`, `head` | — |

Plural names move both sides symmetrically (left-side bones mirror the Y and Z
axes). Use a singular `*_left` / `*_right` name to move one side.

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
| `hold neutral` | — | keep at rest |

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
| elbow | 154 | 10 | — | supinate 92 / pronate 84 |
| hip | 135 | 20 | 45 | — |
| knee | 144 | 5 | — | — |
| ankle | — | — | — | dorsiflex 15 / plantarflex 50 |
| spine | 90 | 30 | 35 | rotate 45 |
| neck | 50 | 60 | 45 | rotate 80 |

> ⚠️ These are general literature values, not medical advice. Consult a
> qualified professional for physiotherapy or exercise prescription.

---

## 5. Rendering model

1. **Forward kinematics** — each phase sets joint angles; the renderer slerps
   bone rotations between phases with the phase's easing.
2. **Ground-lock IK** — effectors listed in `ground-lock` (`hands`, `feet`) are
   pinned to their planted floor position via Cyclic Coordinate Descent (CCD)
   so they stay put while the body moves.
3. **Looping** — the timeline loops base → phases → base; `repeat` is the rep
   count surfaced to the UI.

**v0.1 IK note:** Three.js's bundled `CCDIKSolver` targets `SkinnedMesh`; the
Movit mannequin is rigid capsule segments, so Movit implements the same CCD
algorithm directly over the Object3D bone hierarchy (`movit-render/ik.ts`).
Reach-IK, two-person/dual-IK, and collision detection are deferred (research
§5.2, §6.2).

---

## 6. Intermediate Representation (IR)

`parse(source)` returns `{ ir, warnings, errors }`. The IR is renderer-agnostic;
angles are in **degrees**.

```ts
interface MovitIR {
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
to write Movit, and [`examples/`](./examples) for complete documents.
