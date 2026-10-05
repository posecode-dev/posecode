# Design Proposal: Custom and Overridable Start Poses

**Status:** Implemented  
**Date:** July 2026 (Updated October 2026)  
**Author:** Posecode Protocol Working Group  
**Issue:** [#101](https://github.com/posecode-dev/posecode/issues/101)  

---

## 1. Motivation

In motion choreography and domain-specific movement (such as ballet, martial arts, or gymnastics), a figure often begins in a specialized starting posture (for example, ballet *first position* with arms held in *bras bas* / first position, rather than standing with arms relaxed at the sides).

Previously, authors had two unsatisfactory choices:
1. Accept the generic built-in base pose where arms hang at the sides.
2. Introduce an artificial first animation phase (`step "Prepare" 0.5s`) that immediately moves the arms into place before the real movement begins. This pollutes the exercise rep timing, causes unwanted motion upon loading, and complicates loop wraps.

The goal of this design is to let a document define a custom start pose or override specific channels of a built-in start pose so domain-specific starting positions render immediately at $t = 0$ without a visible transition phase.

---

## 2. Comparison of Design Options

We evaluated three architectural options:

### Option 1: Inline Scoped Override Block Attached to `pose start` (Selected)

```posecode
pose start = first-position:
  shoulders: flex 15
  shoulders: abduct 10
  elbows: flex 20
```

- **Pros:**
  - **Natural extension of existing grammar:** Extends the familiar `pose start = <name>` directive using standard indentation blocks.
  - **Explicitly non-animated:** Syntactically distinct from `step` phases—has no duration, no timing mode, and accepts only joint targets.
  - **Sparse inheritance:** Unspecified channels (e.g. turnout on hips) are inherited from the named base pose.
  - **Direct IR mapping:** Maps cleanly to `startPoseOverrides` in `PosecodeIR`.
- **Cons:**
  - Cannot be reused across multiple independent documents without copy-paste (though documents only ever declare one start pose).

### Option 2: Reusable Named Pose Declarations

```posecode
define pose ballet-prep:
  base first-position
  shoulders: flex 15
  elbows: flex 20

pose start = ballet-prep
```

- **Pros:**
  - Modular; could allow multiple named poses.
- **Cons:**
  - Excessive boilerplate for a domain where 99% of documents define only a single start pose.
  - Introduces symbol table management, forward declarations, and naming collisions.
  - Blurs the line between Posecode as a simple, human-inspectable protocol and a complex programming language.

### Option 3: Zero-Duration Setup Phase in the IR

```posecode
step "Setup" 0s snap:
  shoulders: flex 15
  elbows: flex 20
```

- **Pros:**
  - Requires no grammar additions; reuses `step`.
- **Cons:**
  - Semantically confusing: is a 0s step a real phase? Does it count as a repetition? How does the scrubber render a 0s marker?
  - Breaches the timeline invariant where all phases have positive duration ($> 0$).
  - Ambiguous grounding and contact behavior: does a 0s step run IK or grounding passes differently from $t=0$?

### Selection

**Option 1** was chosen for its elegance, unambiguous non-animated semantics, and seamless integration with the parser and timeline.

---

## 3. Detailed Specification and Invariants

### 3.1 Grammar
A document may declare an optional block following `pose start = <base>:`:

```ebnf
pose          = "pose" "start" "=" startPose [ ":" { startOverride } ] ;
startOverride = jointTarget ;
startPose     = "neutral" | "standing" | "first-position" | "plank" | "supine" | "prone" | "seated" ;
```

- Exactly **one** `pose start` is permitted per document. Duplicate declarations produce a fatal parse error.
- The block accepts **only joint targets** (`<joint>: <action> <degrees>`). Step-only directives (`ground-lock`, `reach`, `pin`, `grip`, `turn`, `travel`, `cue`) are forbidden and emit line-anchored parse errors.

### 3.2 Range of Motion (ROM) Clamping
All override joint angles are validated and clamped against the rig's configured range-of-motion limits in `clamp.ts`.
- Clamped angles produce line-anchored authoring warnings referencing `"start pose"`.
- Clamping is deterministic and guarantees that illegal angles (e.g. `knees: flex 200`) never reach the renderer.

### 3.3 Sparse Channel Inheritance
Start-pose overrides apply as a sparse overlay:
- Only explicitly authored Euler channels are updated.
- Unauthored channels retain their built-in base pose values. For example, overriding `elbow_left: flex 35` on `standing` preserves the built-in relaxed forearm roll (`pronate 80`).
- Authored `hold neutral` explicitly resets all three rotational channels on the specified joint back to zero.

### 3.4 Timeline & Loop Reset
- **Initialization at $t = 0$:** The composed start pose seeds the base pose of the timeline. The Three.js bone hierarchy and mannequin capsule segments are initialized to this exact composed pose at $t = 0$.
- **Loop Reset:** The timeline samples the composed start pose at the loop boundary. During timeline rewind or loop wrap, the figure smoothly recovers to the composed start pose.

### 3.5 LSP & Editor Experience
- **Completion:** Inside the indented block, completion offers only joint names (`start-joint`) and valid actions for the given joint (`action`). Step keywords (`ground-lock`, `cue`, etc.) are excluded.
- **Diagnostics:** Parse errors and ROM warnings appear in real time directly on the override lines.
- **Hovers:** Hovering over joint targets displays the configured ROM limits and documentation.

---

## 4. Evaluation Example: Ballet First Position

In classical ballet, *first position* involves external rotation of the hips (turnout) combined with arms held softly curved in front of the lower torso (*bras bas* / first position).

```posecode
posecode exercise "Ballet first position with arms in preparatory"
  rig humanoid
  pose start = first-position:
    shoulders: flex 15
    shoulders: abduct 10
    elbows: flex 20

  step "Demi-plie" 2s settle:
    knees: flex 55
    ankles: dorsiflex 15
    ground-lock: feet
    cue "Lower with heels anchored and turnout preserved"

  step "Rise" 2s settle:
    knees: flex 0
    ankles: dorsiflex 0
    ground-lock: feet
    cue "Return to first position"

  repeat 2
```

### Visual Outcome
1. At load ($t = 0$), the mannequin stands in first-position turnout with both arms already positioned in preparatory curve.
2. No initial snap or animation transition occurs.
3. On loop wrap, the animation returns seamlessly to this customized preparatory pose.
