<h1 align="center">◆ Movit</h1>

<p align="center"><b>Kinematic motion as text.</b> Mermaid gave LLMs a way to draw diagrams.<br/>
Movit gives them a way to <i>show movement</i> — exercises, physiotherapy, posture —<br/>
as a tiny human-readable language that renders to an animated 3D figure in the browser.</p>

<p align="center">
  <a href="https://www.posecode.org/play"><b>▶ Live playground</b></a> ·
  <a href="spec/SPEC.md">Language spec</a> ·
  <a href="spec/examples">Examples</a> ·
  <a href="packages/movit-mcp">MCP server</a>
</p>

<table align="center">
  <tr>
    <td align="center"><img src="docs/media/deadlift.gif" width="230" alt="Deadlift rendered from .movit text"/><br/><sub><code>hips: hinge 70</code> — deadlift</sub></td>
    <td align="center"><img src="docs/media/squat.gif" width="230" alt="Body-weight squat rendered from .movit text"/><br/><sub><code>knees: flex 95</code> — squat</sub></td>
    <td align="center"><img src="docs/media/lateral-raise.gif" width="230" alt="Lateral raise rendered from .movit text"/><br/><sub><code>shoulders: abduct 90</code> — lateral raise</sub></td>
  </tr>
</table>

---

## Why

Ask an LLM to explain a push-up and it can only give you prose or a flat image.
The model *knows* the biomechanics ("elbows flex, shoulders abduct on the
descent") — it just has no syntax to express it that a renderer can read.
Diffusion-based text-to-motion models exist, but they're heavy, expensive, and
give you no fine control over the anatomical phases.

Movit takes the opposite, lightweight approach (see [the research](#background)):

- The LLM writes a small **`.movit`** document — semantic phases, not 3D matrices.
- A **client-side** parser + Three.js renderer animates it. Generation is a
  fraction of a cent of text; rendering runs at 60fps on a phone.
- Every angle is **hard-clamped to a healthy range of motion**, so a model
  hallucinating "knee flex 200°" can't produce an anatomically impossible joint.

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

## Try it

**No install:** open the [live playground](https://www.posecode.org/play),
pick an example, edit the text, watch the figure move. Hit **Copy LLM prompt**
to get a system prompt that teaches ChatGPT/Claude to write Movit for you —
or wire up the [MCP server](packages/movit-mcp) so your agent authors,
validates, and renders movements natively.

**Locally:**

```bash
npm install
npm run dev      # opens the playground (Vite) at http://localhost:5173
npm test         # parser + renderer + eval test suites
npm run eval     # fidelity scorecard: geometric invariants over every example
```

## Examples

Fourteen ready-to-paste movements live in [`spec/examples`](spec/examples) —
squat, deadlift, push-up, biceps curl, lateral raise, forward fold, roll-down,
chair pose, side bend, spinal twist, neck rotation, shoulder stretch, and two
posture resets. A hip hinge is one line:

```movit
step "Hinge down" 2s ease-in-out:
  hips: hinge 70        # closed-chain: torso tips over planted feet
  knees: flex 20
  ground-lock: feet
  cue "Push the hips back, chest up, flat back"
```

## How Movit stays honest

Two safety layers ship with the language:

- **ROM clamping** — every angle is hard-clamped to healthy range-of-motion
  tables before rendering; a hallucinated `knee: flex 200` renders at 144°
  with a warning, never an impossible joint.
- **Fidelity evals** — [`movit-eval`](packages/movit-eval) re-runs the real
  parser → FK → ground-lock pipeline headlessly and scores geometric
  invariants ("a deadlift pitches the torso ≥ 55° with a flat back and
  vertical shins"). Every example must pass every invariant in CI.

## Packages

| Package | What it does |
| --- | --- |
| [`movit-parser`](packages/movit-parser) | `.movit` text → validated, ROM-clamped IR. Pure TypeScript, framework-agnostic. |
| [`movit-render`](packages/movit-render) | IR → animated low-poly mannequin (Three.js), forward kinematics + ground-lock CCD IK. |
| [`movit-share`](packages/movit-share) | Encode a `.movit` doc to a URL-safe token so a movement travels as a link. Pure, dependency-free. |
| [`movit-mcp`](packages/movit-mcp) | MCP server: lets an LLM agent author, ROM-validate, and get a render link for a movement — natively. |
| [`movit-eval`](packages/movit-eval) | Fidelity harness: headless kinematic probing + biomechanical invariant scoring. |
| [`movit-language`](packages/movit-language) | Editor smarts (completion, hover docs, diagnostics) shared by CodeMirror and the LSP. |
| [`movit-lsp`](packages/movit-lsp) | Language Server Protocol server + [VS Code extension](editors/vscode). |
| [`playground`](playground) | Live editor + 3D viewport + warnings + the LLM prompt + shareable links. |

The protocol and both libraries are **MIT-licensed** — the open core. See
[`spec/SPEC.md`](spec/SPEC.md) for the full language and
[`spec/llm-authoring.md`](spec/llm-authoring.md) for the authoring prompt.

## Scope (v0.1)

✅ Single-person fitness, stretching & posture · Mermaid-style DSL · ROM safety
clamping · forward kinematics · ground-lock IK · live playground.

⏳ Deferred: reach-IK, two-person / partner movements + collision detection,
FBX/GLB export, hosted SaaS editor and the expert-verified motion marketplace.

## Background

This project follows a design study, *"Kinematic Motion Definition Protocols for
Large Language Models"*, which argues for a semantic DSL over diffusion models,
specifies ROM-based safety constraints from clinical normative data, and lays
out the open-core commercialization path. The spec cross-references its
sections (§4 DSL, §5 biomechanics, §6 client rendering, §7 strategy).

> ⚠️ Movit's range-of-motion values are general literature data, not medical
> advice. Consult a qualified professional for physiotherapy or exercise
> prescription.
