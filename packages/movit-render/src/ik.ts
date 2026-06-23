/**
 * Generic Cyclic Coordinate Descent (CCD) inverse kinematics over an Object3D
 * bone chain — the §6.2 algorithm, adapted to our rigid-segment rig (Three's
 * built-in CCDIKSolver is bound to SkinnedMesh, which we don't use).
 *
 * Used for ground-lock: pinning a hand/foot effector to a fixed floor target
 * while the rest of the body moves. v0.1 runs unconstrained CCD; ROM-aware
 * angle limits on the chain are deferred to a later version.
 */

import * as THREE from "three";

export interface IkChain {
  /** Joints that may rotate, ordered proximal → distal. */
  joints: THREE.Object3D[];
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
      joint.updateMatrixWorld(true);
    }

    effector.getWorldPosition(TMP_EFF);
    if (TMP_EFF.distanceToSquared(target) < tolerance) break;
  }

  root.updateMatrixWorld(true);
  effector.getWorldPosition(TMP_EFF);
  return TMP_EFF.distanceToSquared(target);
}

function topmostParent(node: THREE.Object3D): THREE.Object3D {
  let cur = node;
  while (cur.parent) cur = cur.parent;
  return cur;
}
