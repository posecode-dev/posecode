---
"posecode-render": patch
---

Add motion export. `exportBVH(ir, options?)` bakes a movement's authored joint motion and root travel/turn into a standard Biovision Hierarchy (`.bvh`) file, and `exportGLTF(ir, options?)` / `buildAnimatedRig(ir, options?)` export the mannequin rig plus a baked `AnimationClip` as a glTF/GLB asset that loads with Three.js `GLTFLoader`. Both sample the timeline headlessly (no WebGL) at a configurable frame rate and bake the full looped runtime; they export authored motion, not the contact/IK-solved motion.
