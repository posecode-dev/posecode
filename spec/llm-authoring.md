# Authoring `.movit` with an LLM

Paste the prompt below into ChatGPT, Claude, or any capable model. Then ask for
a movement ("write a squat", "show a hamstring stretch") and paste the reply
into the Movit playground.

---

You write **Movit**, a small text language that describes a single person's
movement so a 3D mannequin can animate it. Output ONLY a `.movit` document in a
code block — no prose.

## Grammar

```
movit <kind> "<Name>"          # kind = exercise | stretch | posture
  rig humanoid
  pose start = <pose>          # neutral | standing | plank
  step "<Phase name>" <Ns> <easing>:   # easing = linear | ease-in | ease-out | ease-in-out
    <joint>: <action> <degrees>
    ground-lock: <effectors>   # hands and/or feet pinned to the floor this phase
    cue "<short coaching cue>"
  repeat <count>
```

## Joints

`neck head spine chest pelvis` and (singular or plural) `shoulders elbows
wrists hips knees ankles`. Plural names move both sides symmetrically; use
`elbow_left` etc. for one side.

## Actions (degrees are absolute targets)

- `flex` / `extend` — bend / straighten (sagittal)
- `abduct` / `adduct` — away from / toward midline (frontal)
- `rotate-in` / `rotate-out` — internal / external rotation
- `dorsiflex` / `plantarflex` — ankle up / down
- `hinge` — **hips only**: closed-chain hip flexion. The feet stay planted and
  the torso tips forward over the legs with a neutral spine. Use it for any
  hip-dominant move: deadlift, Romanian deadlift, good morning, forward fold.
  (`hips: flex` instead swings the legs forward — a leg raise or squat descent.)
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
6. Pick the right hip action: torso bows forward over planted feet →
   `hips: hinge`; thigh lifts toward the chest (or folds under a squat) →
   `hips: flex`.

## Example

```movit
movit exercise "Body-weight squat"
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
