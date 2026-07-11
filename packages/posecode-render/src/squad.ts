/**
 * Spherical-quadrangle (squad) quaternion interpolation — Shoemake's C1
 * quaternion spline. Given a keyframe and its two neighbors, `squadControl`
 * derives the intermediate control quaternion; `squad` blends one segment.
 *
 * All functions return NEW quaternions (or write into a caller `out`); the
 * shared keyframe quaternions are never mutated.
 */

import * as THREE from "three";

/** Ensure `b` is in the same hemisphere as `a` (shortest-path continuity). */
function alignHemisphere(a: THREE.Quaternion, b: THREE.Quaternion): THREE.Quaternion {
  const out = b.clone();
  if (a.dot(out) < 0) out.set(-out.x, -out.y, -out.z, -out.w);
  return out;
}

/** q^-1 for a UNIT quaternion is its conjugate. */
function conjugate(q: THREE.Quaternion): THREE.Quaternion {
  return new THREE.Quaternion(-q.x, -q.y, -q.z, q.w);
}

/** Natural log of a unit quaternion → a pure quaternion (w = 0). */
function logUnit(q: THREE.Quaternion): THREE.Quaternion {
  const v = new THREE.Vector3(q.x, q.y, q.z);
  const vLen = v.length();
  const w = THREE.MathUtils.clamp(q.w, -1, 1);
  if (vLen < 1e-8) return new THREE.Quaternion(0, 0, 0, 0);
  const theta = Math.atan2(vLen, w);
  const k = theta / vLen;
  return new THREE.Quaternion(v.x * k, v.y * k, v.z * k, 0);
}

/** Exp of a pure quaternion (w = 0) → a unit quaternion. */
function expPure(q: THREE.Quaternion): THREE.Quaternion {
  const v = new THREE.Vector3(q.x, q.y, q.z);
  const theta = v.length();
  if (theta < 1e-8) return new THREE.Quaternion(0, 0, 0, 1);
  const s = Math.sin(theta) / theta;
  return new THREE.Quaternion(v.x * s, v.y * s, v.z * s, Math.cos(theta));
}

function mul(a: THREE.Quaternion, b: THREE.Quaternion): THREE.Quaternion {
  return a.clone().multiply(b);
}

/**
 * Shoemake control quaternion for `cur`:
 *   s = cur * exp( -( log(cur^-1 * next) + log(cur^-1 * prev) ) / 4 )
 * Neighbors are hemisphere-aligned to `cur` first for shortest-path continuity.
 */
export function squadControl(
  prev: THREE.Quaternion,
  cur: THREE.Quaternion,
  next: THREE.Quaternion,
): THREE.Quaternion {
  const p = alignHemisphere(cur, prev);
  const n = alignHemisphere(cur, next);
  const inv = conjugate(cur);
  const logNext = logUnit(mul(inv, n));
  const logPrev = logUnit(mul(inv, p));
  const sum = new THREE.Quaternion(
    -(logNext.x + logPrev.x) / 4,
    -(logNext.y + logPrev.y) / 4,
    -(logNext.z + logPrev.z) / 4,
    0,
  );
  return mul(cur, expPure(sum)).normalize();
}

/**
 * Squad blend of one segment: slerp(slerp(q0,q1,t), slerp(s0,s1,t), 2t(1-t)).
 * Endpoints `q0`,`q1`; their controls `s0`,`s1`. Returns q0 at t=0, q1 at t=1.
 */
export function squad(
  q0: THREE.Quaternion,
  s0: THREE.Quaternion,
  s1: THREE.Quaternion,
  q1: THREE.Quaternion,
  t: number,
  out: THREE.Quaternion = new THREE.Quaternion(),
): THREE.Quaternion {
  const q1a = alignHemisphere(q0, q1);
  const a = new THREE.Quaternion().slerpQuaternions(q0, q1a, t);
  const b = new THREE.Quaternion().slerpQuaternions(s0, alignHemisphere(s0, s1), t);
  return out.slerpQuaternions(a, alignHemisphere(a, b), 2 * t * (1 - t));
}
