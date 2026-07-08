/**
 * Generic Cyclic Coordinate Descent (CCD) inverse kinematics over an Object3D
 * bone chain: the §6.2 algorithm, adapted to our rigid-segment rig (Three's
 * built-in CCDIKSolver is bound to SkinnedMesh, which we don't use).
 *
 * Used for ground-lock and reach: pinning or driving a hand/foot effector to a
 * world target while the rest of the body moves. Chains may carry per-joint
 * Euler angle limits (the joint's Range of Motion expressed as a local-frame
 * box, see posecode-parser's `eulerRomFor`); each iteration clamps the joint back
 * inside its box, so a solved pose can never exceed the healthy ROM any more
 * than an authored angle can.
 */

import * as THREE from "three";

/**
 * Per-axis rotation limits (radians) in a joint's LOCAL Euler (XYZ) frame.
 * Axes the joint cannot rotate use `[0, 0]`, e.g. a knee is a pure hinge.
 */
export interface JointLimits {
  x: [number, number];
  y: [number, number];
  z: [number, number];
}

export interface IkChain {
  /** Joints that may rotate, ordered proximal → distal. */
  joints: THREE.Object3D[];
  /**
   * Optional ROM limits, parallel to `joints` (null/undefined = unconstrained).
   * Clamped every iteration so the solve stays inside the box throughout.
   */
  limits?: (JointLimits | null | undefined)[];
  /** The node whose world position should reach the target. */
  effector: THREE.Object3D;
  /** World-space goal for the effector. */
  target: THREE.Vector3;
}

const TMP_JOINT = new THREE.Vector3();
const TMP_EFF = new THREE.Vector3();
const TMP_TO_EFF = new THREE.Vector3();
const TMP_TO_TARGET = new THREE.Vector3();
const TMP_AXIS = new THREE.Vector3();
const TMP_QUAT = new THREE.Quaternion();
const TMP_PARENT_QUAT = new THREE.Quaternion();
const TMP_EULER = new THREE.Euler();

/**
 * Solve one chain in place. Rotates `joints` so `effector` approaches `target`.
 * Returns the final squared distance for diagnostics.
 */
export function solveCCD(chain: IkChain, iterations = 10, tolerance = 1e-4): number {
  const { joints, effector, target } = chain;
  const root = topmostParent(joints[0] ?? effector);

  for (let iter = 0; iter < iterations; iter++) {
    for (let j = joints.length - 1; j >= 0; j--) {
      const joint = joints[j]!;
      joint.getWorldPosition(TMP_JOINT);
      effector.getWorldPosition(TMP_EFF);

      TMP_TO_EFF.subVectors(TMP_EFF, TMP_JOINT);
      TMP_TO_TARGET.subVectors(target, TMP_JOINT);
      if (TMP_TO_EFF.lengthSq() < 1e-8 || TMP_TO_TARGET.lengthSq() < 1e-8) continue;

      TMP_TO_EFF.normalize();
      TMP_TO_TARGET.normalize();

      let dot = THREE.MathUtils.clamp(TMP_TO_EFF.dot(TMP_TO_TARGET), -1, 1);
      const angle = Math.acos(dot);
      if (angle < 1e-5) continue;

      TMP_AXIS.crossVectors(TMP_TO_EFF, TMP_TO_TARGET);
      if (TMP_AXIS.lengthSq() < 1e-8) continue;
      TMP_AXIS.normalize();

      // World-space rotation → joint local space.
      TMP_QUAT.setFromAxisAngle(TMP_AXIS, angle);
      joint.parent?.getWorldQuaternion(TMP_PARENT_QUAT);
      const localAxis = TMP_AXIS.clone().applyQuaternion(
        TMP_PARENT_QUAT.clone().invert(),
      );
      const localQuat = new THREE.Quaternion().setFromAxisAngle(localAxis, angle);
      joint.quaternion.premultiply(localQuat);
      clampToLimits(joint, chain.limits?.[j]);
      joint.updateMatrixWorld(true);
    }

    effector.getWorldPosition(TMP_EFF);
    if (TMP_EFF.distanceToSquared(target) < tolerance) break;
  }

  root.updateMatrixWorld(true);
  effector.getWorldPosition(TMP_EFF);
  return TMP_EFF.distanceToSquared(target);
}

/** Clamp a joint's local rotation into its per-axis Euler box, if it has one. */
function clampToLimits(joint: THREE.Object3D, limits: JointLimits | null | undefined): void {
  if (!limits) return;
  TMP_EULER.setFromQuaternion(joint.quaternion, "XYZ");
  const x = THREE.MathUtils.clamp(TMP_EULER.x, limits.x[0], limits.x[1]);
  const y = THREE.MathUtils.clamp(TMP_EULER.y, limits.y[0], limits.y[1]);
  const z = THREE.MathUtils.clamp(TMP_EULER.z, limits.z[0], limits.z[1]);
  if (x === TMP_EULER.x && y === TMP_EULER.y && z === TMP_EULER.z) return;
  TMP_EULER.set(x, y, z, "XYZ");
  joint.quaternion.setFromEuler(TMP_EULER);
}

function topmostParent(node: THREE.Object3D): THREE.Object3D {
  let cur = node;
  while (cur.parent) cur = cur.parent;
  return cur;
}
