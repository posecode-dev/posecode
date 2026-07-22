/**
 * BVH motion export.
 *
 * Bakes a Posecode movement into a Biovision Hierarchy (`.bvh`) file so an
 * authored movement can be imported into Blender and other animation tools.
 *
 * ## What is exported
 *
 * This exporter bakes the **authored joint motion**: the timeline's forward
 * kinematics (joint rotations per phase) plus the root choreography (travel
 * translation and turn yaw). It does NOT run the renderer's contact solve
 * (ground-lock, reach/pin/grip IK, floor clamping), so movements whose final
 * look depends on IK — e.g. a `reach: hand_left floor` — will export the
 * authored pose rather than the solved one. Purely FK-authored movements
 * (squats, curls, ballet port de bras, most of the library) round-trip
 * faithfully. Exporting the fully solved motion is a documented future
 * enhancement; see issue #63.
 *
 * ## Coordinate system and scale
 *
 * - Right-handed, **Y-up**, figure facing **+Z** in the rest pose — identical
 *   to the renderer's rig, and to Three.js' default. Blender's BVH importer
 *   has a "Y up" option; enable it (or apply a +90° X rotation on import).
 * - Units are **metres** by default. Pass `scale: 100` to emit centimetres if
 *   your tool expects that.
 * - Joint rotation channels use the `Zrotation Xrotation Yrotation` order
 *   (Euler order `ZXY`), the most widely compatible BVH convention.
 */

import * as THREE from "three";
import type { PosecodeIR } from "posecode-parser";
import { buildMannequin, type Proportions } from "./mannequin.js";
import { buildTimeline } from "./timeline.js";

/** Finger joints, excluded by default to keep the skeleton importer-friendly. */
const FINGER_PREFIXES = ["thumb", "index", "middle", "ring", "pinky"];

const DEFAULT_FPS = 30;
/** BVH channel order `Zrotation Xrotation Yrotation` ⇔ Three.js Euler `ZXY`. */
const EULER_ORDER = "ZXY" as const;

export interface BvhExportOptions {
  /** Sample rate for the baked keyframes. Defaults to 30 fps. */
  fps?: number;
  /** Include the per-finger curl joints (30 extra channels). Defaults to false. */
  includeFingers?: boolean;
  /** Multiply every length by this factor. 1 = metres (default), 100 = cm. */
  scale?: number;
  /** Rig proportions, if exporting for a calibrated character. */
  proportions?: Proportions;
}

function isFingerBone(id: string): boolean {
  return FINGER_PREFIXES.some((p) => id.startsWith(p));
}

/** A joint in the export skeleton, mirroring the live mannequin bone tree. */
interface ExportJoint {
  id: string;
  node: THREE.Object3D;
  children: ExportJoint[];
}

/**
 * Sensible End Site tip offset (metres, local frame) for a leaf joint, so the
 * exported skeleton reads correctly in an importer. Cosmetic — any non-zero
 * value produces a valid file.
 */
function endSiteOffset(id: string): [number, number, number] {
  if (id === "head") return [0, 0.12, 0];
  if (id.startsWith("ankle")) return [0, -0.04, 0.14]; // toe, forward
  if (isFingerBone(id)) return [0, -0.03, 0];
  return [0, -0.08, 0]; // generic distal extension
}

/** Build the export skeleton tree from a fresh, rest-posed mannequin. */
function buildExportSkeleton(
  bones: Map<string, THREE.Object3D>,
  root: THREE.Object3D,
  includeFingers: boolean,
): ExportJoint {
  const boneNodes = new Set(bones.values());
  const make = (id: string, node: THREE.Object3D): ExportJoint => {
    const children: ExportJoint[] = [];
    for (const [childId, childNode] of bones) {
      if (childNode.parent !== node) continue;
      if (!includeFingers && isFingerBone(childId)) continue;
      children.push(make(childId, childNode));
    }
    // Deterministic child order keeps output stable across runs.
    children.sort((a, b) => a.id.localeCompare(b.id));
    return { id, node, children };
  };
  // The root joint is the single bone parented directly to the rig group.
  for (const [id, node] of bones) {
    if (node.parent === root || !boneNodes.has(node.parent as THREE.Object3D)) {
      return make(id, node);
    }
  }
  throw new Error("posecode BVH export: could not locate a root joint");
}

function fmt(n: number): string {
  // Trim to 6 decimals, then strip trailing zeros for compact, stable output.
  return Number(n.toFixed(6)).toString();
}

/** Enumerate joints in the exact depth-first order channel values are written. */
function flatten(joint: ExportJoint, out: ExportJoint[]): void {
  out.push(joint);
  for (const child of joint.children) flatten(child, out);
}

function writeHierarchy(
  joint: ExportJoint,
  scale: number,
  depth: number,
  isRoot: boolean,
): string {
  const pad = "  ".repeat(depth);
  const lines: string[] = [];
  if (isRoot) {
    lines.push(`${pad}ROOT ${joint.id}`);
    lines.push(`${pad}{`);
    // The root joint carries the world translation in its position channels,
    // so its own OFFSET is the origin.
    lines.push(`${pad}  OFFSET 0.000000 0.000000 0.000000`);
    lines.push(
      `${pad}  CHANNELS 6 Xposition Yposition Zposition Zrotation Xrotation Yrotation`,
    );
  } else {
    const o = joint.node.position;
    lines.push(`${pad}JOINT ${joint.id}`);
    lines.push(`${pad}{`);
    lines.push(
      `${pad}  OFFSET ${fmt(o.x * scale)} ${fmt(o.y * scale)} ${fmt(o.z * scale)}`,
    );
    lines.push(`${pad}  CHANNELS 3 Zrotation Xrotation Yrotation`);
  }
  if (joint.children.length > 0) {
    for (const child of joint.children) {
      lines.push(writeHierarchy(child, scale, depth + 1, false));
    }
  } else {
    // Leaf joint: BVH requires a terminating End Site with a tip offset.
    const [ex, ey, ez] = endSiteOffset(joint.id);
    lines.push(`${pad}  End Site`);
    lines.push(`${pad}  {`);
    lines.push(`${pad}    OFFSET ${fmt(ex * scale)} ${fmt(ey * scale)} ${fmt(ez * scale)}`);
    lines.push(`${pad}  }`);
  }
  lines.push(`${pad}}`);
  return lines.join("\n");
}

const _euler = new THREE.Euler();
const _yawQuat = new THREE.Quaternion();
const _rootQuat = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);

/** Extract `Zrotation Xrotation Yrotation` degrees from a local quaternion. */
function eulerChannels(q: THREE.Quaternion): [number, number, number] {
  _euler.setFromQuaternion(q, EULER_ORDER);
  const RAD2DEG = 180 / Math.PI;
  return [_euler.z * RAD2DEG, _euler.x * RAD2DEG, _euler.y * RAD2DEG];
}

/**
 * Export a parsed Posecode movement as BVH text.
 *
 * The returned string is a complete `.bvh` document (HIERARCHY + MOTION) ready
 * to write to disk or hand to a browser download.
 */
export function exportBVH(ir: PosecodeIR, options: BvhExportOptions = {}): string {
  const fps = options.fps && options.fps > 0 ? options.fps : DEFAULT_FPS;
  const scale = options.scale && options.scale > 0 ? options.scale : 1;
  const includeFingers = options.includeFingers ?? false;

  const mannequin = buildMannequin(undefined, options.proportions);
  const timeline = buildTimeline(ir);
  const skeleton = buildExportSkeleton(
    mannequin.bones,
    mannequin.root,
    includeFingers,
  );

  const flat: ExportJoint[] = [];
  flatten(skeleton, flat);
  const rootRestY = skeleton.node.position.y;

  // Bake one frame per 1/fps across the full played duration (all repeats), so
  // the loop count and total runtime survive the export as literal keyframes.
  const cycle = Math.max(timeline.duration, 1e-6);
  const total = cycle * Math.max(1, timeline.repeat);
  const dt = 1 / fps;
  const frameCount = Math.max(1, Math.round(total * fps)) + 1;

  const motionRows: string[] = [];
  for (let f = 0; f < frameCount; f++) {
    const t = Math.min(f * dt, total);
    const info = timeline.sample(t, mannequin.bones);

    // Root world orientation folds the body yaw into the pelvis local rotation
    // (the root joint has no parent, so its channels are world-space).
    _yawQuat.setFromAxisAngle(_up, info.rootYaw);
    _rootQuat.copy(_yawQuat).multiply(skeleton.node.quaternion);

    const row: number[] = [];
    for (const joint of flat) {
      if (joint === skeleton) {
        row.push(info.rootOffset.x * scale, rootRestY * scale, info.rootOffset.z * scale);
        row.push(...eulerChannels(_rootQuat));
      } else {
        row.push(...eulerChannels(joint.node.quaternion));
      }
    }
    motionRows.push(row.map(fmt).join(" "));
  }

  const header = [
    "HIERARCHY",
    writeHierarchy(skeleton, scale, 0, true),
    "MOTION",
    `Frames: ${frameCount}`,
    `Frame Time: ${fmt(dt)}`,
  ];
  return `${header.join("\n")}\n${motionRows.join("\n")}\n`;
}
