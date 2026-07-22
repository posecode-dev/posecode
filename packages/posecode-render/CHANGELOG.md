# posecode-render

## 0.4.2

### Patch Changes

- 094d453: Carry the body to its authored travel waypoints in gait moves. A floor foot-pin in a clip that travels and alternates both feet is now solved as a stance foot (leg IK to the fixed plant) while the travelled root stays put, instead of translating the whole body back onto the plant and cancelling the travel. Same-foot travel pins and vertical supports keep the body-translate behaviour.
- 94399be: Add motion export. `exportBVH(ir, options?)` bakes a movement's authored joint motion and root travel/turn into a standard Biovision Hierarchy (`.bvh`) file, and `exportGLTF(ir, options?)` / `buildAnimatedRig(ir, options?)` export the mannequin rig plus a baked `AnimationClip` as a glTF/GLB asset that loads with Three.js `GLTFLoader`. Both sample the timeline headlessly (no WebGL) at a configurable frame rate and bake the full looped runtime; they export authored motion, not the contact/IK-solved motion.

## 0.4.1

## 0.4.0

### Minor Changes

- 645f0aa: Add scoped, ROM-checked custom start-pose overrides with deterministic loop resets, Posecode language/IR v0.3 metadata, and updated authoring guidance.

  Expose solved-frame grounding and residual self-collision diagnostics, plus a metric floor guide with facing, authored travel, and loop-reset paths.

  Keep the renderer peer range compatible with the parser's new start-pose IR.

  Keep the MCP initialization identity synchronized with its published package version.

## 0.3.0

### Minor Changes

- 797b1a8: Establish the Posecode 0.3 open-standard and product-layer license boundary. The specification, parser, and share codec remain Apache-2.0. The renderer, embed, and MCP product surfaces move to AGPL-3.0-only with a separately negotiated commercial option. Earlier MIT and Apache-2.0 releases keep their existing rights.

### Patch Changes

- 1bd0c1f: Add a ballet first-position start pose, keep superhero landing contacts stable
  with an inward planted fist, and prevent visible foot friction in demi-plié.
- cdcd978: Strengthen Posecode motion authoring and playback with strict contact validation,
  grounded multi-contact solving, continuous sparse transitions, explicit forearm
  roll guidance, natural relaxed hands, a mobile-safe phase rail, and more lifelike
  canonical movements.

## 0.2.2

### Patch Changes

- Switch package licensing from MIT to Apache-2.0 and include the full license in published packages.
- Updated dependencies
  - posecode-parser@0.2.2

## 0.2.1

### Patch Changes

- posecode-parser@0.2.1
