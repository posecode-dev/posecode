# Capability Probe: Complex-Teaching Use Case (540 Movement)

**Status:** Completed research & capability audit (Issue #106 / Workstream 7 of #91)  
**Reference Video:** [Tutorial / Performance Reference: 540 Kick](https://www.youtube.com/watch?v=aBy_qAqRaxo)  
**Scope:** Kinematic breakdown, expressibility audit, capability gap analysis, and runtime recommendations for teaching complex rotational aerial movements in Posecode.

---

## 1. Executive Summary & Objective

The **540 Kick** (cheat 540 / inside crescent to landing on the kicking leg) is an iconic movement in martial arts tricking, wushu, and contemporary performance. It combines:
1. High-velocity rotational momentum (540° body rotation).
2. Vertical ballistic launch and free flight.
3. Asymmetric aerial leg shapes (chambering the non-kicking leg while whipping the kicking leg).
4. A single-leg landing *on the kicking leg itself* (the same leg that executed the kick), requiring an airborne scissor switch.

### Primary Question
> *Can Posecode represent this movement for a high-value teaching visualization (slow playback, scrub diagnostics, 3D angle inspection)? What works today, and what architectural capabilities are missing?*

---

## 2. Semantic Kinematic Decomposition

A full 540 kick decomposes into eight distinct semantic phases:

```
[1. Cheat Prep] ──► [2. Takeoff] ──► [3. Flight Launch] ──► [4. Inversion/Chamber]
   (Step & dip)        (Left leg plant)   (Leave ground)        (Non-kicking chamber)
                                                                       │
[8. Recovery]   ◄── [7. Landing] ◄── [6. Scissor Prep]   ◄── [5. Crescent Apex]
   (Step out)          (Right foot plant) (Switch in air)       (Right leg kick 360°)
```

### Phase-by-Phase Breakdown

| Phase | Duration | Body Facing | Contacts | Kinematic Signature |
| :--- | :--- | :--- | :--- | :--- |
| **1. Cheat Prep** | ~0.5s | 0° → 90° | Both feet grounded | Curved approach step, torso dips to build rotational angular momentum. |
| **2. Takeoff Plant** | ~0.25s | 90° → 180° | `pin: foot_left floor` | Left stance foot plants firmly; right leg swings forward and up; arms lift overhead. |
| **3. Takeoff Launch** | ~0.15s | 180° | Airborne transition | Explosive extension of left leg; body launches vertically into free flight. |
| **4. Mid-air Inversion** | ~0.25s | 180° → 270° | **None (Free flight)** | Torso tilts ~30° off-axis; left non-kicking knee chambers to chest to accelerate spin. |
| **5. Crescent Apex** | ~0.25s | 270° → 360° | **None (Free flight)** | Right leg whips across target line (hip abduction 80°, knee extended, foot plantarflexed). Peak height ~0.8m. |
| **6. Scissor Switch** | ~0.2s | 360° → 450° | **None (Free flight)** | Right leg drives downward toward floor; left leg extends backward/upward to prepare landing clearance. |
| **7. Single-leg Landing** | ~0.3s | 450° → 540° | `pin: foot_right floor` | Right foot touches down; right knee flexes 45° to absorb shock; left leg airborne. |
| **8. Recovery** | ~0.5s | 540° (180°) | `ground-lock: feet` | Left foot touches down; torso straightens into stable martial arts stance. |

---

## 3. Expressibility Audit: Current Grammar vs. Gaps

### What Works Today in Posecode (v0.4)
1. **Multi-Turn Yaw (`turn: 540`):**
   - The parser, AST, and timeline engine fully support large yaw rotations (`turn: 540`).
   - The loop boundary correctly understands full rotations ($540^\circ \equiv 180^\circ$ relative to origin).
2. **Individual Limb Kinematics:**
   - Hip flexion/abduction, knee flexion, and arm swings for the crescent kick and chambering fit cleanly within configured ROM limits.
3. **Grounded Contacts & Pins:**
   - Phase 1 & 2 (`pin: foot_left floor`) and Phase 7 (`pin: foot_right floor`) accurately translate root to stance feet.
4. **Teaching Tools (#22 Shipped):**
   - 0.25x / 0.5x slow-motion playback.
   - Interactive timeline scrubber with millisecond precision.
   - Full 3D orbit camera controls allowing top-down, side-angle, and front-angle inspection of leg clearance.

---

### Critical Architectural Gaps

#### Gap 1: Free Flight Bounding-Box Drop
- **The Problem:** In Posecode's grounding system (`packages/posecode-render/src/index.ts`), every frame executes a bounding-box drop that lowers the character so the lowest vertex rests on the floor ($y = 0$).
- **The Impact on 540:** During free flight (Phases 3–6), when the athlete is 0.8m in the air, the lowest foot is dragged down to the floor. The character appears to crawl or slide along the floor while rotating, destroying the visual physics of a jump.
- **Language Requirement:** A mechanism to declare a phase as `airborne` with a root elevation offset or ballistic trajectory.

#### Gap 2: Tilted Gyroscopic Rotational Axis
- **The Problem:** In Posecode, `turn: <deg>` strictly applies a rotation about the global vertical Y-axis ($R_y$).
- **The Impact on 540:** Real tricking kicks rotate about an inclined cone or gyroscopic axis (torso dipped ~30°–45° during spin). Authoring this currently requires severe lateral spine flexion (`spine: abduct 35`) on every phase to simulate lean while the root remains vertical.
- **Language Requirement:** Generalized 3D turn syntax, e.g. `turn: 540 tilt 30`.

#### Gap 3: Ballistic Dynamics vs. Linear Hermite Splines
- **The Problem:** Jump timing is parabolic ($y(t) = v_0 t - \frac{1}{2}gt^2$). Keyframed cubic splines often produce floaty or inconsistent vertical apex profiles.

---

## 4. Minimum Language & Runtime Proposals

To generalize across all jumping, acrobatic, and dance movements (e.g. ballet *grand jeté*, wushu *butterfly twist*, gymnastics *back tuck*), we propose two clean orthogonal extensions:

### Proposal A: Elevation Channel (`elevation: <meters>`)
Add an optional root elevation property to steps:
```posecode
  step "Apex Crescent" 0.25s flow:
    elevation: 0.85
    turn: 360
    hip_right: abduct 85
    knee_right: extend 0
    cue "Apex of jump: whip right leg through high crescent kick"
```
- **Runtime Effect:** Bypasses floor bounding-box drop. The character root Y translates to the specified height above the floor plane.

### Proposal B: Ballistic Flight Helper
Alternatively, declare takeoff and landing phases, allowing the runtime to compute the parabolic ballistic trajectory:
```posecode
  step "Apex Crescent" 0.25s ballistic:
    apex: 0.85
    turn: 360
```

---

## 5. Evaluation of Teaching Utility

When evaluated against the YouTube reference tutorial:
- **Frame-by-frame scrubbing** provides unmatched clarity for teaching the *scissor switch*—the most common failure point for students (landing on the wrong leg).
- **Multi-angle perspective** allows students to see how the cheat step sets up hip rotation from above (floor guide cardinal markings).
- **Conclusion:** Once `elevation:` or free-flight support is implemented, Posecode will be a premier tool for tricking and martial arts choreography education.
