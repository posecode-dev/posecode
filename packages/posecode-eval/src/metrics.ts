/**
 * Geometric metrics over probed bone positions: the vocabulary the
 * invariant checks are written in. All angles in degrees, distances in metres.
 */

import type { PhasePose, ProbeResult, Quat, Vec3 } from "./probe.js";

const RAD2DEG = 180 / Math.PI;

export function bone(pose: PhasePose, id: string): Vec3 {
  const p = pose.bones.get(id);
  if (!p) throw new Error(`probe result has no bone "${id}"`);
  return p;
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function norm(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Angle between two direction vectors, 0–180. */
export function angleBetweenDeg(a: Vec3, b: Vec3): number {
  const d = dot(a, b) / (norm(a) * norm(b) || 1);
  return Math.acos(Math.min(1, Math.max(-1, d))) * RAD2DEG;
}

/** Tilt of the segment from→to away from world-vertical (+Y). 0 = upright. */
export function segmentTiltDeg(pose: PhasePose, from: string, to: string): number {
  return angleBetweenDeg(sub(bone(pose, to), bone(pose, from)), [0, 1, 0]);
}

/** Torso pitch: pelvis→neck tilt from vertical. Standing ≈ 0, hinged ≈ 70+. */
export function torsoPitchDeg(pose: PhasePose): number {
  return segmentTiltDeg(pose, "pelvis", "neck");
}

/**
 * Signed torso pitch in the character's travel-relative sagittal plane.
 * Positive values lean character-forward; backward and sideways collapses do
 * not masquerade as a valid forward hinge merely because their unsigned tilt
 * is large.
 */
export function torsoForwardPitchDeg(pose: PhasePose): number {
  const direction = sub(bone(pose, "neck"), bone(pose, "pelvis"));
  const c = Math.cos(-pose.rootYaw);
  const s = Math.sin(-pose.rootYaw);
  const localForward = direction[0] * s + direction[2] * c;
  return Math.atan2(localForward, direction[1]) * RAD2DEG;
}

/** Interior angle at joint b formed by segments b→a and b→c (180 = straight). */
export function jointAngleDeg(pose: PhasePose, a: string, b: string, c: string): number {
  return angleBetweenDeg(sub(bone(pose, a), bone(pose, b)), sub(bone(pose, c), bone(pose, b)));
}

/** Knee flexion for one side: 0 = straight leg, 90 = right angle. */
export function kneeFlexionDeg(pose: PhasePose, side: "left" | "right"): number {
  return 180 - jointAngleDeg(pose, `hip_${side}`, `knee_${side}`, `ankle_${side}`);
}

/**
 * How much the spine curls: angle between the lower-torso (pelvis→chest) and
 * upper-torso (chest→head) directions. ~0 = neutral straight back.
 */
export function spineCurlDeg(pose: PhasePose): number {
  return angleBetweenDeg(
    sub(bone(pose, "chest"), bone(pose, "pelvis")),
    sub(bone(pose, "head"), bone(pose, "chest")),
  );
}

/** Height of a bone above the floor. */
export function heightOf(pose: PhasePose, id: string): number {
  return bone(pose, id)[1];
}

/** World-space distance between two body landmarks. */
export function distanceBetween(pose: PhasePose, a: string, b: string): number {
  return norm(sub(bone(pose, a), bone(pose, b)));
}

function rotateByQuat(v: Vec3, q: Quat): Vec3 {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [
    v[0] + w * tx + (y * tz - z * ty),
    v[1] + w * ty + (z * tx - x * tz),
    v[2] + w * tz + (x * ty - y * tx),
  ];
}

/** Angle between the palm face normal and the downward floor normal. */
export function palmFloorAngleDeg(pose: PhasePose, side: "left" | "right"): number {
  const q = pose.boneQuaternions.get(`wrist_${side}`);
  if (!q) return 180;
  // The procedural palm is shallow on local Z for both sides (the same
  // geometry axis used by render's production floor-contact solver).
  return angleBetweenDeg(rotateByQuat([0, 0, 1], q), [0, -1, 0]);
}

/** Angle between the semantic fist's knuckle direction and floor-down. */
export function fistFloorAngleDeg(pose: PhasePose, side: "left" | "right"): number {
  const q = pose.boneQuaternions.get(`wrist_${side}`);
  if (!q) return 180;
  // Same wrist→knuckle axis used by render's production fist contact solver.
  return angleBetweenDeg(rotateByQuat([0, -1, 0], q), [0, -1, 0]);
}

/** Landmark position along character-forward after undoing authored root yaw. */
export function forwardCoordinate(pose: PhasePose, id: string): number {
  const p = bone(pose, id);
  const x = p[0] - pose.rootOffset[0];
  const z = p[2] - pose.rootOffset[2];
  const c = Math.cos(-pose.rootYaw);
  const s = Math.sin(-pose.rootYaw);
  return x * s + z * c;
}

/** Angle between the sole's local up axis and world up (0 = foot flat). */
export function soleUpAngleDeg(pose: PhasePose, side: "left" | "right"): number {
  const q = pose.boneQuaternions.get(`ankle_${side}`);
  if (!q) return 180;
  return angleBetweenDeg(rotateByQuat([0, 1, 0], q), [0, 1, 0]);
}

/** Overhand bar grip: angle between the palm face normal and character-forward. */
export function palmBarAngleDeg(pose: PhasePose, side: "left" | "right"): number {
  const q = pose.boneQuaternions.get(`wrist_${side}`);
  if (!q) return 180;
  return angleBetweenDeg(rotateByQuat([0, 0, 1], q), [0, 0, 1]);
}

/** Distance from a wrist to its side-specific pull-up-bar grip anchor. */
export function barGripError(pose: PhasePose, side: "left" | "right"): number {
  const wrist = bone(pose, `wrist_${side}`);
  const anchor: Vec3 = [side === "left" ? 0.24 : -0.24, 2.255, 0.025];
  return norm(sub(wrist, anchor));
}

const MASS_WEIGHTS: ReadonlyArray<readonly [string, number]> = [
  ["pelvis", 0.22], ["spine", 0.13], ["chest", 0.2], ["head", 0.08],
  ["hip_left", 0.07], ["hip_right", 0.07], ["knee_left", 0.05], ["knee_right", 0.05],
  ["shoulder_left", 0.025], ["shoulder_right", 0.025],
  ["elbow_left", 0.025], ["elbow_right", 0.025],
  ["ankle_left", 0.015], ["ankle_right", 0.015],
];

/** Approximate whole-body COM from anthropometrically weighted landmarks. */
export function centerOfMass(pose: PhasePose): Vec3 {
  let x = 0, y = 0, z = 0, total = 0;
  for (const [id, weight] of MASS_WEIGHTS) {
    const p = pose.bones.get(id);
    if (!p) continue;
    x += p[0] * weight; y += p[1] * weight; z += p[2] * weight; total += weight;
  }
  return total > 0 ? [x / total, y / total, z / total] : [0, 0, 0];
}

function supportBoneIds(pose: PhasePose): string[] {
  const ids = new Set<string>();
  const addGroup = (name: string) => {
    if (name === "feet") { ids.add("ankle_left"); ids.add("ankle_right"); }
    if (name === "foot_left") ids.add("ankle_left");
    if (name === "foot_right") ids.add("ankle_right");
    if (name === "hands") { ids.add("wrist_left"); ids.add("wrist_right"); }
    if (name === "hand_left") ids.add("wrist_left");
    if (name === "hand_right") ids.add("wrist_right");
    if (name === "fists") { ids.add("wrist_left"); ids.add("wrist_right"); }
    if (name === "fist_left") ids.add("wrist_left");
    if (name === "fist_right") ids.add("wrist_right");
    if (name === "forearms") { ids.add("elbow_left"); ids.add("elbow_right"); }
    if (name === "elbow_left") ids.add("elbow_left");
    if (name === "elbow_right") ids.add("elbow_right");
    if (name === "knees") { ids.add("knee_left"); ids.add("knee_right"); }
    if (name === "knee_left") ids.add("knee_left");
    if (name === "knee_right") ids.add("knee_right");
  };
  pose.groundLock.forEach(addGroup);
  for (const reach of pose.reaches) {
    if (reach.target !== "floor") continue;
    addGroup(reach.effector);
    const mapped = reach.effector
      .replace("hand_", "wrist_")
      .replace("fist_", "wrist_")
      .replace("foot_", "ankle_");
    if (pose.bones.has(mapped)) ids.add(mapped);
  }
  for (const pin of pose.pins) {
    addGroup(pin.effector);
    const mapped = pin.effector
      .replace("hand_", "wrist_")
      .replace("fist_", "wrist_")
      .replace("foot_", "ankle_");
    if (pose.bones.has(mapped)) ids.add(mapped);
  }
  // Floor poses also distribute load through the torso/pelvis even when the
  // authored contact declaration only mentions hands or feet.
  for (const id of ["pelvis", "chest", "head"]) {
    const p = pose.bones.get(id);
    if (p && p[1] < 0.5) ids.add(id);
  }
  return [...ids];
}

/** Horizontal COM distance outside the active support bounding box (0 = inside). */
export function balanceOverflow(pose: PhasePose): number {
  const supports = supportBoneIds(pose).map((id) => bone(pose, id));
  // No authored support information remains unscored for backward
  // compatibility. A single support, however, is a real balance constraint:
  // measure outside a foot/hand-sized disc instead of auto-passing it.
  if (supports.length === 0) return 0;
  const com = centerOfMass(pose);
  const margin = 0.14;
  if (supports.length === 1) {
    const support = supports[0]!;
    return Math.max(0, Math.hypot(com[0] - support[0], com[2] - support[2]) - margin);
  }
  const minX = Math.min(...supports.map((p) => p[0])) - margin;
  const maxX = Math.max(...supports.map((p) => p[0])) + margin;
  const minZ = Math.min(...supports.map((p) => p[2])) - margin;
  const maxZ = Math.max(...supports.map((p) => p[2])) + margin;
  const dx = Math.max(minX - com[0], 0, com[0] - maxX);
  const dz = Math.max(minZ - com[2], 0, com[2] - maxZ);
  return Math.hypot(dx, dz);
}

/** Clearance between the head sphere and known prop geometry; Infinity if none. */
export function headPropClearance(result: ProbeResult, pose: PhasePose): number {
  const h = bone(pose, "head");
  let clearance = Infinity;
  if (result.propTypes.includes("bar")) {
    const closestX = Math.max(-0.6, Math.min(0.6, h[0]));
    clearance = Math.min(clearance, Math.hypot(h[0] - closestX, h[1] - 2.3, h[2]) - 0.13);
  }
  if (result.propTypes.includes("wall")) {
    clearance = Math.min(clearance, Math.abs(h[2] - (-0.29)) - 0.105);
  }
  if (result.propTypes.includes("chair")) {
    const dx = Math.max(Math.abs(h[0]) - 0.21, 0);
    const dy = Math.max(Math.abs(h[1] - 0.78) - 0.25, 0);
    const dz = Math.max(Math.abs(h[2] - (-0.34)) - 0.03, 0);
    clearance = Math.min(clearance, Math.hypot(dx, dy, dz) - 0.105);
  }
  return clearance;
}

interface SolidFace {
  point: Vec3;
  normal: Vec3;
  tangentU: Vec3;
  halfU: number;
  tangentV: Vec3;
  halfV: number;
  captureDepth: number;
  blocks: readonly string[];
}

/** The solid prop faces, re-derived from the prop geometry independently of
 * the renderer's collider declarations so a regression in either is caught. */
function solidFaces(propTypes: readonly string[]): SolidFace[] {
  const out: SolidFace[] = [];
  const all = ["torso", "head", "thigh", "shin", "arm"];
  if (propTypes.includes("wall")) {
    out.push({ point: [0, 1.3, -0.29], normal: [0, 0, 1], tangentU: [1, 0, 0], halfU: 1.1, tangentV: [0, 1, 0], halfV: 1.3, captureDepth: 0.8, blocks: all });
  }
  if (propTypes.includes("chair")) {
    out.push(
      { point: [0, 0.78, -0.31], normal: [0, 0, 1], tangentU: [1, 0, 0], halfU: 0.21, tangentV: [0, 1, 0], halfV: 0.25, captureDepth: 0.4, blocks: ["torso", "head"] },
      { point: [0, 0.47, 0.05], normal: [0, 0, 1], tangentU: [1, 0, 0], halfU: 0.21, tangentV: [0, 1, 0], halfV: 0.03, captureDepth: 0.42, blocks: ["shin"] },
    );
  }
  if (propTypes.includes("box")) {
    out.push({ point: [0, 0.15, 0.11], normal: [0, 0, -1], tangentU: [1, 0, 0], halfU: 0.25, tangentV: [0, 1, 0], halfV: 0.15, captureDepth: 0.42, blocks: ["shin"] });
  }
  return out;
}

/** Body capsule radii matching the render mannequin (see mannequin.ts). */
const PART_RADII = { torso: 0.13, head: 0.105, thigh: 0.075, shin: 0.055, arm: 0.038 } as const;

/**
 * Worst body penetration into a solid prop face (metres, ≤0 when clear), or
 * reached to a non-floor anchor are that phase's declared prop support and
 * don't count (a foot standing ON the box is not "in" the box).
 */
export function propPenetrationDepth(result: ProbeResult, pose: PhasePose): number {
  const faces = solidFaces(result.propTypes);
  if (faces.length === 0) return -Infinity;
  const exemptLegs = new Set<string>();
  const contacts = [
    ...pose.pins,
    ...pose.reaches.map((r) => ({ effector: r.effector, anchor: r.target })),
  ];
  for (const c of contacts) {
    if (c.anchor === "floor") continue;
    if (c.effector === "feet" || c.effector === "foot_left") exemptLegs.add("left");
    if (c.effector === "feet" || c.effector === "foot_right") exemptLegs.add("right");
  }
  const segments: [string, string, keyof typeof PART_RADII][] = [
    ["pelvis", "neck", "torso"],
    ["neck", "head", "head"],
  ];
  for (const side of ["left", "right"]) {
    segments.push([`shoulder_${side}`, `elbow_${side}`, "arm"], [`elbow_${side}`, `wrist_${side}`, "arm"]);
    if (exemptLegs.has(side)) continue;
    segments.push([`hip_${side}`, `knee_${side}`, "thigh"], [`knee_${side}`, `ankle_${side}`, "shin"]);
  }
  let worst = -Infinity;
  for (const [aId, bId, part] of segments) {
    const a = pose.bones.get(aId);
    const b = pose.bones.get(bId);
    if (!a || !b) continue;
    const r = PART_RADII[part];
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const p: Vec3 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      for (const f of faces) {
        if (!f.blocks.includes(part)) continue;
        const rel = sub(p, f.point);
        const d = dot(rel, f.normal);
        if (d < -f.captureDepth) continue;
        if (Math.abs(dot(rel, f.tangentU)) > f.halfU + r) continue;
        if (Math.abs(dot(rel, f.tangentV)) > f.halfV + r) continue;
        worst = Math.max(worst, r - d);
      }
    }
  }
  return worst;
}

/** Fastest landmark's average speed from the previous endpoint into this phase. */
export function phaseMaxLandmarkSpeed(previous: PhasePose | null, pose: PhasePose): number {
  if (!previous || pose.durationSec <= 0) return 0;
  let max = 0;
  for (const [id, p] of pose.bones) {
    const before = previous.bones.get(id);
    if (before) max = Math.max(max, norm(sub(p, before)) / pose.durationSec);
  }
  return max;
}

export function footSkateDistance(previous: PhasePose, pose: PhasePose, side: "left" | "right"): number {
  const id = `ankle_${side}`;
  // Authored travel AND the solid-prop contact push both translate the whole
  // body deliberately, feet included; skate is what's left after removing them.
  const local = (p: Vec3, phase: PhasePose): readonly [number, number] => {
    const x = p[0] - phase.rootOffset[0] - phase.propPush[0];
    const z = p[2] - phase.rootOffset[2] - phase.propPush[2];
    const c = Math.cos(-phase.rootYaw), s = Math.sin(-phase.rootYaw);
    return [x * c - z * s, x * s + z * c];
  };
  const a = local(bone(previous, id), previous), b = local(bone(pose, id), pose);
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/** World-space X/Z drift for a support whose anchor is fixed in the scene. */
export function footWorldSkateDistance(
  previous: PhasePose,
  pose: PhasePose,
  side: "left" | "right",
): number {
  const a = bone(previous, `ankle_${side}`);
  const b = bone(pose, `ankle_${side}`);
  return Math.hypot(b[0] - a[0], b[2] - a[2]);
}

/** Drift of the planted foot-pair center, ignoring intentional stance-width changes. */
export function feetCenterSkateDistance(previous: PhasePose, pose: PhasePose): number {
  const delta = (side: "left" | "right") => {
    const id = `ankle_${side}`;
    const a = bone(previous, id), b = bone(pose, id);
    const unyaw = (p: Vec3, phase: PhasePose) => {
      const x = p[0] - phase.rootOffset[0] - phase.propPush[0];
      const z = p[2] - phase.rootOffset[2] - phase.propPush[2];
      const c = Math.cos(-phase.rootYaw), s = Math.sin(-phase.rootYaw);
      return [x * c - z * s, x * s + z * c] as const;
    };
    const aa = unyaw(a, previous), bb = unyaw(b, pose);
    return [bb[0] - aa[0], bb[1] - aa[1]] as const;
  };
  const l = delta("left"), r = delta("right");
  return Math.hypot((l[0] + r[0]) / 2, (l[1] + r[1]) / 2);
}

export function footIsSupported(pose: PhasePose, side: "left" | "right"): boolean {
  return pose.groundLock.includes("feet")
    || pose.groundLock.includes(`foot_${side}`)
    || pose.pins.some((p) =>
      (p.effector === "feet" || p.effector === `foot_${side}`) && p.anchor === "floor");
}

/** Lowest bone height in the pose (should never be much below 0). */
export function lowestPoint(pose: PhasePose): number {
  let min = Infinity;
  for (const p of pose.bones.values()) min = Math.min(min, p[1]);
  return min;
}

/** Average height of the two ankles (0 when the feet are planted). */
export function feetHeight(pose: PhasePose): number {
  return (heightOf(pose, "ankle_left") + heightOf(pose, "ankle_right")) / 2;
}
