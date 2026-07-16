# posecode-render

Renders a [`posecode-parser`](https://www.npmjs.com/package/posecode-parser) IR
as an animated 3D human figure with [Three.js](https://threejs.org):
forward kinematics plus ground-lock CCD IK, live in the browser at 60fps.
Pass `characterUrl` to show a realistic skinned character (any Mixamo-rigged
GLB); without it — or while it loads, or if it fails — a procedural athletic
figure renders instead, so the scene is never blank. Either way, a capsule
self-collision pass keeps limbs from passing through the body.

Part of [Posecode](https://posecode.org): a kinematic-motion protocol LLMs can
write, rendered as text-to-motion 3D animation.

## Install

```bash
npm install posecode-render posecode-parser three
```

## Usage

```ts
import { parse } from "posecode-parser";
import { createViewer } from "posecode-render";

const canvas = document.querySelector("canvas")!;
const viewer = createViewer(canvas, {
  autoRotate: false,
  // Optional: realistic skinned character (Mixamo bone naming). Omit for the
  // zero-asset procedural figure.
  characterUrl: "https://posecode.org/models/character.glb",
});

const { ir } = parse(myPosecodeSource);
if (ir) {
  viewer.load(ir);
  viewer.setLoop(true);
  viewer.play();
}

viewer.onPhase(({ phaseName, cue }) => {
  console.log(phaseName, cue);
});
```

No GPU, no diffusion model: generation is a fraction of a cent of text, and
rendering is plain forward kinematics.

## License

Apache-2.0
