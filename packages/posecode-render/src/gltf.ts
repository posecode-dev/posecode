/**
 * glTF / GLB animation export.
 *
 * Bakes a Posecode movement into a standard glTF asset — the rig plus a baked
 * animation clip — so it can drop into an existing web animation pipeline and
 * load with Three.js' `GLTFLoader`.
 *
 * ## What is exported
 *
 * The procedural mannequin rig (bone hierarchy with limb meshes parented to
 * each joint) and one `AnimationClip` that drives the joint rotations and the
 * root travel/turn. Like the BVH path, this bakes the **authored** joint motion
 * plus root choreography; it does not re-run the renderer's contact/IK solve,
 * so IK-dependent movements export their authored pose. Exporting the fully
 * solved motion, and retargeting onto external/humanoid skeletons, are
 * documented future work (see issue #90).
 *
 * ## Conventions
 *
 * - Right-handed, **Y-up**, figure faces **+Z** at rest (Three.js default).
 * - Units are metres.
 * - Joint nodes are named by their Posecode bone id (`elbow_left`, `hip_right`,
 *   …); the animated root group is `posecode_root`.
 * - The full looped runtime (cycle incl. loop-reset wrap × repeats) is baked as
 *   keyframes, so duration and loop count survive without a runtime loop flag.
 */

import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import type { PosecodeIR } from "posecode-parser";
import { buildMannequin, type Proportions } from "./mannequin.js";
import { buildTimeline } from "./timeline.js";

const DEFAULT_FPS = 30;
const ROOT_NODE_NAME = "posecode_root";

export interface GltfExportOptions {
  /** Keyframe sample rate. Defaults to 30 fps. */
  fps?: number;
  /** true → GLB binary ArrayBuffer (default); false → glTF JSON object. */
  binary?: boolean;
  /** Rig proportions, if exporting for a calibrated character. */
  proportions?: Proportions;
}

const _up = new THREE.Vector3(0, 1, 0);
const _yaw = new THREE.Quaternion();

/**
 * Build the mannequin rig and a baked `AnimationClip` for a movement, without
 * touching the DOM. Exposed for tests and advanced callers; most consumers want
 * {@link exportGLTF}.
 */
export function buildAnimatedRig(
  ir: PosecodeIR,
  options: GltfExportOptions = {},
): { root: THREE.Group; clip: THREE.AnimationClip } {
  const fps = options.fps && options.fps > 0 ? options.fps : DEFAULT_FPS;
  const mannequin = buildMannequin(undefined, options.proportions);
  const timeline = buildTimeline(ir);

  // Name every joint node by its bone id so animation tracks bind by name and
  // the exported glTF uses a stable, documented joint-naming convention.
  mannequin.root.name = ROOT_NODE_NAME;
  const animatedBones: string[] = [];
  for (const [id, node] of mannequin.bones) {
    node.name = id;
    animatedBones.push(id);
  }

  const cycle = Math.max(timeline.duration, 1e-6);
  const total = cycle * Math.max(1, timeline.repeat);
  const dt = 1 / fps;
  const frameCount = Math.max(1, Math.round(total * fps)) + 1;

  const times = new Float32Array(frameCount);
  const rootPos = new Float32Array(frameCount * 3);
  const rootQuat = new Float32Array(frameCount * 4);
  const boneQuat = new Map<string, Float32Array>();
  for (const id of animatedBones) boneQuat.set(id, new Float32Array(frameCount * 4));

  for (let f = 0; f < frameCount; f++) {
    const t = Math.min(f * dt, total);
    times[f] = t;
    const info = timeline.sample(t, mannequin.bones);

    // Root group carries the world travel (x,z) and the body yaw.
    rootPos[f * 3] = info.rootOffset.x;
    rootPos[f * 3 + 1] = 0;
    rootPos[f * 3 + 2] = info.rootOffset.z;
    _yaw.setFromAxisAngle(_up, info.rootYaw);
    rootQuat[f * 4] = _yaw.x;
    rootQuat[f * 4 + 1] = _yaw.y;
    rootQuat[f * 4 + 2] = _yaw.z;
    rootQuat[f * 4 + 3] = _yaw.w;

    for (const id of animatedBones) {
      const q = mannequin.bones.get(id)!.quaternion;
      const buf = boneQuat.get(id)!;
      buf[f * 4] = q.x;
      buf[f * 4 + 1] = q.y;
      buf[f * 4 + 2] = q.z;
      buf[f * 4 + 3] = q.w;
    }
  }

  const tracks: THREE.KeyframeTrack[] = [
    new THREE.VectorKeyframeTrack(`${ROOT_NODE_NAME}.position`, Array.from(times), Array.from(rootPos)),
    new THREE.QuaternionKeyframeTrack(`${ROOT_NODE_NAME}.quaternion`, Array.from(times), Array.from(rootQuat)),
  ];
  for (const id of animatedBones) {
    tracks.push(
      new THREE.QuaternionKeyframeTrack(
        `${id}.quaternion`,
        Array.from(times),
        Array.from(boneQuat.get(id)!),
      ),
    );
  }

  const clip = new THREE.AnimationClip(ir.name || "posecode", total, tracks);
  // Reset the rig to its rest pose so the exported node transforms are neutral;
  // the clip supplies all motion.
  timeline.sample(0, mannequin.bones);
  return { root: mannequin.root, clip };
}

/**
 * Export a parsed Posecode movement as a glTF/GLB asset.
 *
 * Returns a GLB `ArrayBuffer` (default) or a glTF JSON object when
 * `binary: false`. The result loads with Three.js `GLTFLoader`, and the baked
 * clip plays on the included rig.
 */
export async function exportGLTF(
  ir: PosecodeIR,
  options: GltfExportOptions = {},
): Promise<ArrayBuffer | Record<string, unknown>> {
  const { root, clip } = buildAnimatedRig(ir, options);
  const exporter = new GLTFExporter();
  const binary = options.binary ?? true;
  return await new Promise((resolve, reject) => {
    exporter.parse(
      root,
      (result) => resolve(result as ArrayBuffer | Record<string, unknown>),
      (error) => reject(error),
      { binary, animations: [clip] },
    );
  });
}
