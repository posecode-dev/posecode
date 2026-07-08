# posecode-render

Renders a [`posecode-parser`](https://www.npmjs.com/package/posecode-parser) IR
as an animated low-poly mannequin with [Three.js](https://threejs.org):
forward kinematics plus ground-lock CCD IK, live in the browser at 60fps.

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
const viewer = createViewer(canvas, { autoRotate: false });

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

MIT
