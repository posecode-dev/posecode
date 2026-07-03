<h1 align="center">◆ Posecode</h1>

<p align="center"><b>Kinematic motion as text.</b> Mermaid gave LLMs a way to draw diagrams.<br/>
Posecode gives them a way to <i>show movement</i> — exercises, physiotherapy, posture —<br/>
as a tiny human-readable language that renders to an animated 3D figure in the browser.</p>

---

## Why

Ask an LLM to explain a push-up and it can only give you prose or a flat image.
The model *knows* the biomechanics ("elbows flex, shoulders abduct on the
descent") — it just has no syntax to express it that a renderer can read.
Diffusion-based text-to-motion models exist, but they're heavy, expensive, and
give you no fine control over the anatomical phases.

Posecode takes the opposite, lightweight approach (see [the research](#background)):

- The LLM writes a small **`.posecode`** document — semantic phases, not 3D matrices.
- A **client-side** parser + Three.js renderer animates it. Generation is a
  fraction of a cent of text; rendering runs at 60fps on a phone.
- Every angle is **hard-clamped to a healthy range of motion**, so a model
  hallucinating "knee flex 200°" can't produce an anatomically impossible joint.

```posecode
posecode exercise "Body-weight squat"
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

```bash
npm install
npm run dev      # opens the playground (Vite) at http://localhost:5173
npm test         # parser + renderer test suites
```

In the playground: pick an example, watch it animate, edit the text live, and
hit **Copy LLM prompt** to get a system prompt that teaches ChatGPT/Claude to
write Posecode for you.

## Packages

| Package | What it does |
| --- | --- |
| [`posecode-parser`](packages/posecode-parser) | `.posecode` text → validated, ROM-clamped IR. Pure TypeScript, framework-agnostic. |
| [`posecode-render`](packages/posecode-render) | IR → animated low-poly mannequin (Three.js), forward kinematics + ground-lock CCD IK. |
| [`posecode-share`](packages/posecode-share) | Encode a `.posecode` doc to a URL-safe token so a movement travels as a link. Pure, dependency-free. |
| [`posecode-mcp`](packages/posecode-mcp) | MCP server: lets an LLM agent author, ROM-validate, and get a render link for a movement — natively. |
| [`playground`](playground) | Live editor + 3D viewport + warnings + the LLM prompt + shareable links. |

The protocol and both libraries are **MIT-licensed** — the open core. See
[`spec/SPEC.md`](spec/SPEC.md) for the full language and
[`spec/llm-authoring.md`](spec/llm-authoring.md) for the authoring prompt.
For where Posecode spreads fastest and the per-domain go-to-market plan, see
[`docs/market-research.md`](docs/market-research.md); for the engine roadmap,
[`ROADMAP.md`](ROADMAP.md).

## Scope (v0.1)

✅ Single-person movement across fitness, physio, desk, dance, education & rehab ·
Mermaid-style DSL · ROM safety clamping (authored **and IK-solved** angles) ·
forward kinematics · ground-lock **and ROM-constrained reach-to-target IK** ·
hip-hinge · lying/seated poses · scene props (chair/wall/bar) · a single-DOF
hand rig · live playground.

⏳ Deferred: two-person / partner movements + collision detection, deeper props
(load, bands, rings), multi-joint fingers, FBX/GLB export, hosted SaaS editor and
the expert-verified motion marketplace.

## Background

This project follows a design study, *"Kinematic Motion Definition Protocols for
Large Language Models"*, which argues for a semantic DSL over diffusion models,
specifies ROM-based safety constraints from clinical normative data, and lays
out the open-core commercialization path. The spec cross-references its
sections (§4 DSL, §5 biomechanics, §6 client rendering, §7 strategy).

> ⚠️ Posecode's range-of-motion values are general literature data, not medical
> advice. Consult a qualified professional for physiotherapy or exercise
> prescription.
