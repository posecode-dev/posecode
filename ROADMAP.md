# Movit — domains & roadmap

Movit's vision is broad: **describe any single-person movement as text and render it
safely in 3D.** The *protocol* is general; the *current renderer* is deliberately
scoped (one figure, forward kinematics, ground-locked hands/feet, no props). This
doc maps the domains Movit can serve, what already works, and what each remaining
domain needs — so contributions land where they unlock the most.

## Where Movit fits

| Domain | Example uses | Status |
| --- | --- | --- |
| **Physiotherapy / rehab** | Range-of-motion demos, home-exercise programs, post-op protocols, cervical/shoulder mobility | ✅ Strong fit today — the ROM safety clamp is a clinical feature. Many moves render now; equipment (bands, balls) is future. |
| **Ergonomics / desk & posture** | Posture resets, seated/standing stretch breaks, "do this every hour" prompts | ✅ Works today for standing variants; true *seated* needs a chair prop (below). |
| **Yoga & mobility** | Standing poses (chair, side bend, twist), flows, mobility drills | ✅ Standing poses work; floor/inversion/lying poses need lying base poses + a mat. |
| **Movement education / anatomy** | Demonstrate joint actions ("what is shoulder abduction?"), biomechanics teaching | ✅ Excellent fit — single-joint demos are exactly what the rig does. |
| **Fitness / strength** | Body-weight and free-form movement coaching | ✅ Core today (squat, curl, raise). Barbell/dumbbell/machine work needs props + grip. |
| **Functional / elderly care** | Sit-to-stand, balance, gentle ROM, fall-prevention drills | 🟡 Partial — sit-to-stand works; reaching/balance need reach-IK + props. |
| **Sports technique** | Golf swing, tennis serve, throwing, kicking | 🟡 Partial — needs trunk rotation fidelity, weight shift, and implements (club/racket/ball). |
| **Dance / choreography** | Notating sequences, port de bras, simple phrases | 🟡 Simple gestures work; precise reach + partner work are future. |
| **Martial arts** | Stances, strikes, basic forms | 🟡 Stances/strikes partly work; contact and weapons are future. |
| **Sign language / gesture** | Finger-spelling, signs, expressive gesture | ⛔ Needs a hand/finger rig (the rig currently ends at the wrist). |

## Engine capabilities that widen the scope

These are the unlocks, roughly in order of leverage:

1. **Hip / waist hinge primitive** — today deadlift / forward-fold are faked as a
   spinal roll-down. A true hip hinge unlocks deadlift, row, good-morning, hinge-based
   yoga, and bending to interact with props.
2. **Reach-IK (reach a world target)** — touch your toes, hand-to-opposite-knee,
   grab a bar, place a hand on a wall. Unlocks a huge share of physio, yoga, and any
   prop interaction.
3. **Scene props with contact anchors** — objects the figure can stand on, sit on,
   hang from, or push against, plus ground-lock-style anchors to them.
4. **Lying & seated base poses** — supine / prone / quadruped / seated starting poses
   (for floor yoga, mat Pilates, bed-based rehab, sit-to-stand on a real seat).
5. **Hand / finger articulation** — grip and gesture (sign language, grasping props).
6. **Two-person + collision** — partner stretches, assisted rehab, contact sports
   (already noted as deferred in the spec).

## Prop / equipment library (future)

Each prop is a small scene object + an anchor type; movements then reference it
(e.g. `ground-lock: bar` or a future `reach: bar`). Candidates, and what they unlock:

| Prop | Unlocks |
| --- | --- |
| **Chair / stool / bench** | Seated desk & rehab work, sit-to-stand, step-ups, bench press, box squats |
| **Pull-up bar** | Pull-ups, dead hangs, hanging knee raises (needs grip + reach-IK) |
| **Gymnastic rings** | Rows, dips, support holds, skin-the-cat (grip + reach-IK + two-anchor) |
| **Yoga mat + blocks / strap / bolster** | Floor poses, supported stretches, props-assisted mobility |
| **Bed / table** | Bed-based rehab, supine exercises, clinical assessments |
| **Wall** | Wall sits, wall push-ups, calf/shoulder stretches against a surface |
| **Resistance band** | Band pull-aparts, banded rehab, mobility with tension |
| **Dumbbell / barbell / kettlebell** | Loaded strength patterns (needs grip + load cues) |
| **Ball (stability / medicine)** | Core work, balance, throws |
| **Parallettes / dip station** | Dips, L-sits, push-up variations at height |
| **Foam roller** | Self-myofascial release, mobility drills |

## Current limitations (honest)

- One figure only; no props or external objects yet.
- Forward kinematics + ground-locked hands/feet; **no reach-to-target IK**.
- Hip/waist hinge is approximated by spinal flexion (so deadlift-class moves look
  like a roll-down — curate around this until the hinge primitive lands).
- Rig ends at the wrist (no fingers) and the head (no facial articulation).

> Range-of-motion values are general literature data, not medical advice.
