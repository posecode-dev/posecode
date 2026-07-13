/**
 * Self-collision resolution: stop limbs from passing through the body.
 *
 * Authored poses are pure per-joint rotations, so nothing prevents a biceps
 * curl from dragging the forearm through the thighs, or a cross-body reach
 * from sweeping the hand through the chest. This pass approximates the body
 * with capsules (torso, head, thighs, shins), samples points along each
 * forearm/hand and each lower leg, and when a sample sits inside an obstacle
 * it rotates the limb's proximal joint (shoulder / hip) just enough to clear.
 *
 * Principles:
 * - **Minimal**: corrections only remove actual overlap, so intentional
 *   contact poses ("hands to temples") end up touching the surface instead of
 *   inside it. A pose with no overlap is untouched.
 * - **Deterministic**: corrections are a pure function of the pose, so looping
 *   animations stay smooth (no frame-to-frame jitter).
 * - **Safe**: each adjusted joint is clamped back into its healthy ROM
 *   (widened to admit the authored angle), the same guarantee reach-IK gives.
 *
 * Runs on the driver skeleton right after FK sampling, before ground-lock, in
 * both the viewer's frame loop and its load-time anchor capture, so ground
 * anchors and per-frame poses see the same corrected skeleton.
 */

import * as THREE from "three";
import { eulerRomFor } from "posecode-parser";
import type { Mannequin } from "./mannequin.js";

const DEG = Math.PI / 180;

/** Max corrective rotation applied per joint per frame (radians). */
const MAX_CORRECTION = 30 * DEG;
/** Per-iteration step cap (radians): several small steps converge smoothly. */
const MAX_STEP = 6 * DEG;
const ITERATIONS = 8;

interface Capsule {
  a: THREE.Vector3;
  b: THREE.Vector3;
  r: number;
}

const TMP_AB = new THREE.Vector3();
const TMP_AP = new THREE.Vector3();
const TMP_CLOSEST = new THREE.Vector3();
const TMP_PUSH = new THREE.Vector3();
const TMP_LEVER = new THREE.Vector3();
const TMP_AXIS = new THREE.Vector3();
const TMP_Q = new THREE.Quaternion();
const TMP_PARENT_Q = new THREE.Quaternion();
const TMP_EULER = new THREE.Euler();

/** Closest point on segment ab to p, written into `out`. */
function closestOnSegment(p: THREE.Vector3, cap: Capsule, out: THREE.Vector3): THREE.Vector3 {
  TMP_AB.subVectors(cap.b, cap.a);
  TMP_AP.subVectors(p, cap.a);
  const len2 = TMP_AB.lengthSq();
  const t = len2 > 1e-10 ? THREE.MathUtils.clamp(TMP_AP.dot(TMP_AB) / len2, 0, 1) : 0;
  return out.copy(cap.a).addScaledVector(TMP_AB, t);
}

interface Hit {
  depth: number;
  point: THREE.Vector3;
  push: THREE.Vector3;
}

/** Deepest penetration of sample point p (radius r) against the obstacles. */
function deepestHit(p: THREE.Vector3, r: number, obstacles: Capsule[], best: Hit | null): Hit | null {
  for (const cap of obstacles) {
    closestOnSegment(p, cap, TMP_CLOSEST);
    TMP_PUSH.subVectors(p, TMP_CLOSEST);
    const dist = TMP_PUSH.length();
    const depth = cap.r + r - dist;
    if (depth <= 0 || depth <= (best?.depth ?? 0)) continue;
    // Degenerate: sample exactly on the axis. Push sideways, away from midline.
    const dir = dist > 1e-6 ? TMP_PUSH.clone().multiplyScalar(1 / dist) : new THREE.Vector3(Math.sign(p.x) || 1, 0, 0);
    best = { depth, point: p.clone(), push: dir };
  }
  return best;
}

/** World position helper (assumes matrices are current). */
function wp(m: Mannequin, id: string, out = new THREE.Vector3()): THREE.Vector3 {
  return m.bones.get(id)!.getWorldPosition(out);
}

/**
 * Rotate `joint` (world-space axis/angle) and clamp it back into `limits`.
 * Mirrors the CCD solver's joint update so corrections obey the same ROM.
 * Shared with the prop-contact pass (propcontact.ts).
 */
export function rotateJoint(
  joint: THREE.Object3D,
  axis: THREE.Vector3,
  angle: number,
  limits: { x: [number, number]; y: [number, number]; z: [number, number] } | null,
): void {
  joint.parent?.getWorldQuaternion(TMP_PARENT_Q);
  const localAxis = TMP_AXIS.copy(axis).applyQuaternion(TMP_PARENT_Q.invert());
  TMP_Q.setFromAxisAngle(localAxis, angle);
  joint.quaternion.premultiply(TMP_Q);
  if (limits) {
    TMP_EULER.setFromQuaternion(joint.quaternion, "XYZ");
    const x = THREE.MathUtils.clamp(TMP_EULER.x, limits.x[0], limits.x[1]);
    const y = THREE.MathUtils.clamp(TMP_EULER.y, limits.y[0], limits.y[1]);
    const z = THREE.MathUtils.clamp(TMP_EULER.z, limits.z[0], limits.z[1]);
    if (x !== TMP_EULER.x || y !== TMP_EULER.y || z !== TMP_EULER.z) {
      TMP_EULER.set(x, y, z, "XYZ");
      joint.quaternion.setFromEuler(TMP_EULER);
    }
  }
  joint.updateMatrixWorld(true);
}

/** The joint's ROM (radians), widened to admit its current authored pose. */
export function widenedLimits(
  boneId: string,
  joint: THREE.Object3D,
): { x: [number, number]; y: [number, number]; z: [number, number] } | null {
  const rom = eulerRomFor(boneId);
  if (!rom) return null;
  TMP_EULER.setFromQuaternion(joint.quaternion, "XYZ");
  const widen = (min: number, max: number, cur: number): [number, number] => [
    Math.min(min * DEG, cur),
    Math.max(max * DEG, cur),
  ];
  return {
    x: widen(rom.x.min, rom.x.max, TMP_EULER.x),
    y: widen(rom.y.min, rom.y.max, TMP_EULER.y),
    z: widen(rom.z.min, rom.z.max, TMP_EULER.z),
  };
}

/**
 * Resolve self-collisions on the driver skeleton in place. Call with the
 * root's matrix world current; leaves matrices current.
 */
export function depenetrate(m: Mannequin): void {
  const R = m.collision;

  // Sample points along a limb, proximal → tip. `tipOverhang` extends past the
  // last joint to cover the hand/foot mesh beyond its bone.
  const samples = (aId: string, bId: string, tipOverhang: number): THREE.Vector3[] => {
    const a = wp(m, aId);
    const b = wp(m, bId);
    const dir = b.clone().sub(a);
    const pts: THREE.Vector3[] = [];
    for (const t of [0.15, 0.45, 0.75, 1.0]) pts.push(a.clone().addScaledVector(dir, t));
    if (tipOverhang > 0) {
      const n = dir.clone().normalize();
      pts.push(b.clone().addScaledVector(n, tipOverhang));
    }
    return pts;
  };

  // Rebuilt each iteration: obstacles move as corrections are applied.
  const bodyObstacles = (): { torsoHead: Capsule[]; leg: Record<"left" | "right", Capsule[]> } => {
    const pelvis = wp(m, "pelvis");
    const neck = wp(m, "neck");
    const head = wp(m, "head");
    // Extend the torso capsule a little below the pelvis joint (hip mass) and
    // centre the head sphere in the skull rather than at the neck end.
    const torso: Capsule = {
      a: pelvis.clone().addScaledVector(neck.clone().sub(pelvis).normalize(), -0.08),
      b: neck,
      r: R.torso,
    };
    const headCap: Capsule = {
      a: head.clone().addScaledVector(head.clone().sub(neck).normalize(), 0.05),
      b: head,
      r: R.head,
    };
    const legCaps = (side: "left" | "right"): Capsule[] => [
      { a: wp(m, `hip_${side}`), b: wp(m, `knee_${side}`), r: R.thigh },
      { a: wp(m, `knee_${side}`), b: wp(m, `ankle_${side}`), r: R.shin },
    ];
    return {
      torsoHead: [torso, headCap],
      leg: { left: legCaps("left"), right: legCaps("right") },
    };
  };

  for (const side of ["left", "right"] as const) {
    // --- Arm: forearm + hand vs torso, head, and both legs. ---
    const shoulder = m.bones.get(`shoulder_${side}`)!;
    const shoulderLimits = widenedLimits(`shoulder_${side}`, shoulder);
    let applied = 0;
    for (let i = 0; i < ITERATIONS && applied < MAX_CORRECTION; i++) {
      const obs = bodyObstacles();
      const obstacles = [...obs.torsoHead, ...obs.leg.left, ...obs.leg.right];
      let hit: Hit | null = null;
      for (const p of samples(`elbow_${side}`, `wrist_${side}`, 0.09)) {
        hit = deepestHit(p, R.arm, obstacles, hit);
      }
      if (!hit) break;
      const pivot = wp(m, `shoulder_${side}`);
      TMP_LEVER.subVectors(hit.point, pivot);
      const lever = TMP_LEVER.length();
      if (lever < 0.05) break;
      const axis = TMP_LEVER.clone().cross(hit.push);
      if (axis.lengthSq() < 1e-8) break;
      axis.normalize();
      const step = Math.min(hit.depth / lever, MAX_STEP, MAX_CORRECTION - applied);
      rotateJoint(shoulder, axis, step, shoulderLimits);
      applied += step;
    }

    // --- Leg: knee→foot vs the OTHER leg (crossing steps, curtsies). ---
    const hip = m.bones.get(`hip_${side}`)!;
    const hipLimits = widenedLimits(`hip_${side}`, hip);
    const other = side === "left" ? "right" : "left";
    applied = 0;
    for (let i = 0; i < ITERATIONS && applied < 10 * DEG; i++) {
      const obs = bodyObstacles();
      let hit: Hit | null = null;
      for (const p of samples(`knee_${side}`, `ankle_${side}`, 0.06)) {
        hit = deepestHit(p, R.shin, obs.leg[other], hit);
      }
      if (!hit) break;
      const pivot = wp(m, `hip_${side}`);
      TMP_LEVER.subVectors(hit.point, pivot);
      const lever = TMP_LEVER.length();
      if (lever < 0.05) break;
      const axis = TMP_LEVER.clone().cross(hit.push);
      if (axis.lengthSq() < 1e-8) break;
      axis.normalize();
      const step = Math.min(hit.depth / lever, MAX_STEP, 10 * DEG - applied);
      rotateJoint(hip, axis, step, hipLimits);
      applied += step;
    }
  }
}
