# Labanotation Interoperability & Bounded Translator Research

**Status:** Completed research and prototype evaluation (Issue #105 / Workstream 6 of #91)  
**Author:** Posecode Core Team  
**Scope:** Feasibility analysis, semantic mapping, lossiness taxonomy, and prototype evaluation for converting Labanotation scores into Posecode IR.

---

## 1. Executive Summary & Core Conclusion

Labanotation is a profound, standardized, human-readable graphic notation system for recording human movement, widely utilized in dance preservation and movement analysis.

Our central question for Issue #105:
> *Can Labanotation serve as a viable automated import format for Posecode, and with what fidelity?*

### Key Recommendation
**Labanotation is best treated as Design Research and a Validation Oracle, NOT as a general automated import format.**
- **As Design Research:** Labanotation's 90-year-old formalization of support vs. gesture, levels (plié vs. neutral vs. relevé), and spatial direction offers essential foundational insights for Posecode language design (e.g. separating `pin moves the body` from `reach moves the limb`).
- **As a Validation Oracle:** A dance-notator verified Labanotation score can serve as a ground-truth specification against which Posecode simulations and LLM choreographic generations are tested.
- **As an Import Format:** Any automated compiler from full Labanotation to Posecode is inherently lossy. Labanotation's continuous time-staff, polyphonic limb timing, and fractional weight transfers require either coarse approximations or hundreds of fragmented micro-phases that destroy Posecode's human/LLM readability. When translation is attempted, the engine must emit explicit warnings for lossy constructs rather than fabricating inaccurate motion.

---

## 2. Conceptual Mapping Table: Labanotation to Posecode

Labanotation scores are read from bottom to top along a vertical three-line staff representing the dancer's body symmetry (center line divides left and right).

| Labanotation Concept | Staff Column / Representation | Posecode DSL & IR Target | Fidelity & Semantic Equivalence |
| :--- | :--- | :--- | :--- |
| **Center Line** | Divides Left and Right body halves | Rig bilateral joint hierarchy (`*_left`, `*_right`) | **Lossless:** Direct 1:1 mapping |
| **Support Columns (inner)** | Columns 1 & 2 directly adjacent to center | Stance constraints: `pin: <foot> floor`, `ground-lock: feet` | **Bounded:** Supports plantigrade and demi-pointe, but lacks continuous weight shifts |
| **Leg Gesture Columns** | Columns 3 & 4 (outer leg columns) | Kinematic limb targeting: `hip_*`, `knee_*`, `ankle_*`, `reach:` | **Lossless for basic shapes:** Euler angles & IK |
| **Body / Torso Column** | Column 5 | `pelvis: hinge`, `spine: flex/extend/abduct/twist` | **High:** Maps to axial spine and pelvis |
| **Arm Gesture Columns** | Outermost columns (left and right) | `shoulder_*`, `elbow_*`, `wrist_*` | **Lossless:** Direct joint rotational mapping |
| **Head Column** | Outermost or above staff | `neck: twist/flex`, `head:` | **Bounded:** Neck/head rotational channels |
| **Direction Signs** | Symbol shape (Triangle=Fwd, Flat=Place, Pins=Sides/Diagonals) | Target Euler directions & `travel: <x> <z>` | **High for discrete steps; Moderate for continuous curves** |
| **Level Indicators** | Internal shading (Black=Low, Dot=Medium, Striped=High) | Joint flex/extension: Low=flex/plié, Med=neutral, High=plantarflex/relevé | **High:** Directly maps to joint state transitions |
| **Turn Signs** | Circular symbols with interior rotation degrees | `turn: <deg>` | **Lossless:** Direct yaw rotation in degrees |
| **Vertical Staff Height** | Metric distance along staff = duration | Phase duration: `step "<name>" <duration>s <easing>:` | **Quantized:** Continuous staff quantized into discrete steps |

---

## 3. Lossiness Taxonomy: What Posecode Cannot Preserve

Full Labanotation encodes physical, spatial, and dynamic realities that exceed Posecode's discrete kinematic phase model:

```
┌────────────────────────────────────────────────────────────────────────┐
│                   LABANOTATION REPRESENTATION SPACE                     │
│                                                                        │
│  ┌───────────────────────┐              ┌───────────────────────────┐  │
│  │   Continuous Space    │              │    LMA Effort Dynamics    │  │
│  │  - Fractional weight  │              │  - Space (direct/indirect)│  │
│  │  - Polyphonic timing  │              │  - Weight (strong/light)  │  │
│  │  - Asynchronous limbs │              │  - Time (sudden/sustained)│  │
│  │  - Curved spatial path│              │  - Flow (bound/free)      │  │
│  └───────────┬───────────┘              └─────────────┬─────────────┘  │
│              │                                        │                │
│              ▼                                        ▼                │
│       [ BOUNDED TRANSLATOR: LOSS REPORTING & APPROXIMATION ]           │
│                               │                                        │
│                               ▼                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                    POSECODE DSL SPECIFICATION                     │  │
│  │  - Synchronized global phases (step "<name>" <time>s:)           │  │
│  │  - Discrete ground contacts (pin / ground-lock / reach)          │  │
│  │  - Joint local Euler rotations + Absolute root yaw/travel        │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

### 1. Asynchronous Polyphonic Timing
- **Labanotation:** Different limbs can start and end gestures at arbitrary, independent heights along the staff (e.g. an arm gesture spanning 3 beats while a leg takes two 1.5-beat steps).
- **Posecode:** Phases are strictly synchronized barriers (`step "..." <duration>:`). Translating polyphonic movements requires slicing the timeline into the least common multiple of all limb transitions, creating fragmented artificial micro-phases.

### 2. Fractional Weight Transfer & Center of Mass Path
- **Labanotation:** Can specify partial support (e.g. 60% on left heel, 40% on right metatarsal) and the exact continuous trajectory of the center of weight.
- **Posecode:** Support is binary per-phase (`pin` or `ground-lock`). The solver calculates root translation kinematically, but cannot simulate muscular weight distribution or force balance.

### 3. Effort / Dynamics (Laban Movement Analysis)
- **Labanotation / LMA:** Explicitly notates movement qualities (Space: Direct vs. Flexible; Weight: Strong vs. Light; Time: Sudden vs. Sustained; Flow: Bound vs. Free).
- **Posecode:** Uses timing keywords (`flow`, `settle`, `drive`, `linear`) to configure C1 spline interpolation, but has no internal model of muscular effort, acceleration impulses, or mechanical impedance.

### 4. Continuous Spatial Paths vs. Discrete Waypoints
- **Labanotation:** Spatial path signs describe circular or helical paths relative to room coordinates or interpersonal axes.
- **Posecode:** Root travel is defined by discrete Cartesian waypoints (`travel: <x> <z>`). Curvature depends on hermite spline interpolation between those waypoints.

---

## 4. Evaluated Score Fixtures

To empirically test the bounded translator (`packages/posecode-eval/src/laban.ts`), four reference scores of increasing complexity were evaluated:

### Fixture 1: Static Position (First Position / Standing)
- **Laban structure:** Bilateral place supports at middle level; arms resting in low diagonal.
- **Translation:** 1 phase, `pose start = first-position`, `ground-lock: feet`.
- **Fidelity:** **100% (Lossless).** 0 warnings.

### Fixture 2: Grounded Step (Forward Step with Weight Transfer)
- **Laban structure:** Left support holds while right support steps forward (level middle); weight transfers onto right foot.
- **Translation:** 2 phases, `travel: 0 0.35`, stance pin switches from left to right.
- **Fidelity:** **High.** Both body destination and stance transition match.

### Fixture 3: Pivot Turn (Half-turn on Stance Foot)
- **Laban structure:** Turn sign (180° clockwise) on left support with right leg in gesture.
- **Translation:** 1 phase with `turn: 180`, `pin: foot_left floor`.
- **Fidelity:** **High.** Correct facing and ground anchor.

### Fixture 4: Complex Phrase with Polyphonic Timing & Dynamics
- **Laban structure:** Demi-plié into relevé with asymmetrical arm elevations and gradual 70/30 weight transfer.
- **Translation:** 3 phases. Explicit diagnostics emitted:
  - `Unsupported Labanotation feature: "fractional-weight-70-30"`
  - `Unsupported Labanotation feature: "asynchronous-arm-delay"`
- **Fidelity:** **Approximated.** Bounded translator successfully identified and logged lossy features in diagnostics without hallucinating physics.

---

## 5. Verification & Acceptance
- Prototype translator implemented in `packages/posecode-eval/src/laban.ts`.
- Automated test suite in `packages/posecode-eval/test/labanotation-translator.test.ts` validates:
  1. Lossless translation of foundational direction and level primitives.
  2. Step travel and turn angle preservation.
  3. Strict diagnostic generation when lossy/unsupported constructs are encountered.
