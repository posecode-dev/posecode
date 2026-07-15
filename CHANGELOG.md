# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-07-15

### Added

- **Canonical timing modes**: `flow`, `settle`, `drive`, `snap`, and `linear`
  now describe continuous motion, deliberate rests, acceleration, and sharp
  arrivals. The v0.1 easing spellings remain accepted as deprecated aliases.
- **Third-party validation CLI**: `npx posecode-parser@0.2.0 validate <path>`
  recursively checks `.posecode` libraries, with `--strict` and `--json` modes
  for CI.
- **Embed compatibility metadata**: the CDN bundle exports `version`,
  `languageVersion`, and `validatePosecode()`. Player ready/error events now
  include structured version and diagnostic details, while host elements expose
  a machine-readable loading/ready/error state.
- **Release contract checks**: CI builds the publishable package chain so a
  source-only language change cannot land without a valid CDN bundle.
- **Realistic human figure**: the playground, landing hero, and `<posecode-player>` embeds now render a fully rigged, textured human character (hands with articulated fingers, sneakers, face) instead of the procedural capsule mannequin. All solving (FK, ground-lock, pins, reach-IK) still runs on the driver skeleton, rebuilt to the character's exact proportions and retargeted bone-for-bone every frame; the procedural figure remains as an automatic fallback (and via `?figure=classic` / `character="off"`).
- **Self-collision resolution**: a capsule-based de-penetration pass keeps forearms/hands out of the torso, head, and legs (and shins out of each other), clamped to healthy ROM, so limbs no longer pass through the body mid-movement.
- **Solid props**: props now declare blocking faces (the wall's surface, the chair's backrest and seat edge, the box's near face) and a contact pass keeps the body out of them — translating the whole figure along the face normal, or bending the offending leg's hip clear (ROM-clamped). Limbs pinned/gripped/reached to a prop anchor stay exempt as declared support. A new `solid-props` eval invariant (independent geometry re-derivation) guards every prop movement against this bug class.
- `viewer.characterActive`, `createViewer({ characterUrl })`, and the embed `character` attribute.
- `scripts/capture-gifs.mjs` (`npm run gifs`): reproducible headless regeneration of the README movement GIFs from the live renderer.

### Fixed

- Wall sit no longer clips through the wall: the body now translates forward until the back rests on the wall's surface (feet walking out, thighs parallel), the physically correct wall-sit geometry. Sit-to-stand and box-squat land against the chair's backrest instead of sinking into it, a standing figure's calves clear the seat edge, and a step-up's trailing shin bends over the box edge instead of sweeping through it.
- Deadlift arms now hang toward the bar during the hinge (were authored as shoulder extension, flying up behind the back).
- Crunch keeps the feet planted with bent knees (shins previously folded through the floor and jacked the body up).
- Touch-toes folds like a human (hinge depth and knee bend were over-authored, collapsing the figure).

## [0.1.0] - 2026-07-08

### Added

- **Language (`.posecode` DSL)**:
  - Human-readable text-based kinematic motion definition syntax.
  - Joint and rotation specifications (e.g. `hips: flex 80`, `knees: flex 95`).
  - Support for `step` definitions with transition duration, easing curves (`ease-in-out`, `ease-out`, `ease-in`), and visual cues.
  - Starting poses (`supine`, `prone`, `seated`, `standing`).
  - Spatial choreography: `turn: <deg>` and `travel: <x> <z>` coordinates.
  - Hand / finger curl articulation (single-DOF curls + `fingers` group).
  - Scene props integration (`prop chair|wall|bar|box|dip-bars`).
- **Parser (`posecode-parser`)**:
  - Full TypeScript parser converting `.posecode` source text to a validated, range-of-motion-clamped intermediate representation (IR).
  - Robust error recovery (never throws, instead reporting structured errors and warnings).
  - Clinical range-of-motion safety clamping.
- **Renderer (`posecode-render`)**:
  - High-performance, client-side Three.js-based 3D mannequin rendering.
  - Forward kinematics plus ground-lock Cyclic Coordinate Descent (CCD) Inverse Kinematics (IK).
  - Range-of-motion constrained reach-to-target IK for limbs.
  - Motion aliveness layer simulating breathing and subtle aliveness.
- **Playground (`playground`)**:
  - Live browser editor at `posecode.org/play` with split-pane view (code editor + 3D viewport).
  - Real-time linting, compilation warnings, and shareable link generator using URL-safe compression (`posecode-share`).
  - "Copy LLM prompt" tool to instantly get an interactive system prompt instructing models on how to write valid `.posecode`.
  - "New" button to clear the editor for pasting external model outputs.
  - Complete favicon, brand assets, and customized bare figure iconography.
- **MCP Server (`posecode-mcp`)**:
  - Model Context Protocol server exposing tools to external AI agents:
    - `posecode_authoring_guide`: returns the grammar, joints, actions, and examples.
    - `validate_posecode`: parses a document and returns errors plus range-of-motion safety clamps.
    - `render_posecode`: compiles and returns a shareable preview link to the playground.
- **Embed Component (`posecode-embed`)**:
  - Framework-free `<posecode-player>` Web Component for embedding movements anywhere using a single script tag.
  - Supports loading from a URL-safe share token, external `.posecode` file source, or inline DSL text.
  - Lazy loading (Three.js loads only when the player scrolls into view).
  - Accessibility first (supports `prefers-reduced-motion` and keyboard/mouse controls).
  - Isolated Shadow DOM styling.
- **Eval Harness (`posecode-eval`)**:
  - Headless test and validation runner to measure kinematic fidelity.
  - Real parser → FK → ground-lock pipeline evaluation.
  - Geometric invariant assertions (e.g. shin angles, torso pitch, spine curl) scored programmatically to prevent regressions.
