/**
 * Geometric metrics over probed bone positions: the vocabulary the
 * invariant checks are written in. All angles in degrees, distances in metres.
 */

import type { PhasePose, Vec3 } from "./probe.js";

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
