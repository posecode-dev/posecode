/** Reach-effector resolution and ROM-constrained IK shared by the viewer/tests. */
import * as THREE from "three";
import { eulerRomFor } from "posecode-parser";
import type { Mannequin } from "./mannequin.js";
import { solveCCD, type JointLimits } from "./ik.js";

const DEG = Math.PI / 180;
const REACH_EULER = new THREE.Euler();

/** Friendly/canonical contact effectors mapped to their driven rig bone. */
export const EFFECTOR_BONE: Readonly<Record<string, string>> = {
  hand_left: "wrist_left",
  hand_right: "wrist_right",
  fist_left: "wrist_left",
  fist_right: "wrist_right",
  foot_left: "ankle_left",
  foot_right: "ankle_right",
  knee_left: "knee_left",
  knee_right: "knee_right",
};

export type ReachResidualReason =
  | "missing-effector"
  | "missing-target"
  | "unsupported-effector";

/**
 * Runtime outcome for one active reach. `distance` is the actual post-blend
 * world-space effector error in metres. A null distance means the target or
 * effector could not be resolved; these cases are deliberately retained
 * instead of being silently discarded by the renderer.
 */
export interface ReachResidual {
  effector: string;
  target: string;
  weight: number;
  distance: number | null;
  reached: boolean;
  reason?: ReachResidualReason;
}

/** Viewer/testing tolerance for considering a terminal contact reached. */
export const REACH_TOLERANCE = 0.03;

/** Resolve a canonical effector name to the bone that occupies its endpoint. */
export function effectorBoneId(effector: string): string {
  return EFFECTOR_BONE[effector] ?? effector;
}

/**
 * The proximal-to-distal chain allowed to move a terminal effector.
 * Knee contact rotates the hip only: the knee itself is the endpoint, not a
 * joint that may rotate itself toward its own target. Fists share the arm
 * chain with palms while retaining distinct contact geometry in contacts.ts.
 */
export function reachChain(
  m: Mannequin,
  effector: string,
): { joints: THREE.Object3D[]; limits: (JointLimits | null)[] } {
  const boneId = effectorBoneId(effector);
  const side = boneId.endsWith("_left") ? "left" : "right";
  const ids = boneId.startsWith("wrist")
    ? [`shoulder_${side}`, `elbow_${side}`]
    : boneId.startsWith("elbow")
      ? [`shoulder_${side}`]
      : boneId.startsWith("ankle")
        ? [`hip_${side}`, `knee_${side}`]
        : boneId.startsWith("knee")
          ? [`hip_${side}`]
          : [];
  const joints: THREE.Object3D[] = [];
  const limits: (JointLimits | null)[] = [];
  for (const id of ids) {
    const node = m.bones.get(id);
    if (!node) continue;
    joints.push(node);
    limits.push(widenedJointLimits(id, node));
  }
  return { joints, limits };
}

/** A bone's ROM in radians, widened only enough to preserve authored FK. */
export function widenedJointLimits(
  boneId: string,
  node: THREE.Object3D,
): JointLimits | null {
  const rom = eulerRomFor(boneId);
  if (!rom) return null;
  REACH_EULER.setFromQuaternion(node.quaternion, "XYZ");
  return {
    x: widen(rom.x.min * DEG, rom.x.max * DEG, REACH_EULER.x),
    y: widen(rom.y.min * DEG, rom.y.max * DEG, REACH_EULER.y),
    z: widen(rom.z.min * DEG, rom.z.max * DEG, REACH_EULER.z),
  };
}

function widen(min: number, max: number, current: number): [number, number] {
  return [Math.min(min, current), Math.max(max, current)];
}

/**
 * Solve one named effector to an already-resolved world point and report the
 * residual after reach-weight blending. This low-level entry point lets tests
 * and non-WebGL consumers exercise the exact viewer solve.
 */
export function solveReachToPoint(
  m: Mannequin,
  effectorName: string,
  targetName: string,
  target: THREE.Vector3,
  weight = 1,
): ReachResidual {
  const safeWeight = THREE.MathUtils.clamp(weight, 0, 1);
  const effector = m.bones.get(effectorBoneId(effectorName));
  if (!effector) {
    return {
      effector: effectorName,
      target: targetName,
      weight: safeWeight,
      distance: null,
      reached: false,
      reason: "missing-effector",
    };
  }
  const { joints, limits } = reachChain(m, effectorName);
  if (joints.length === 0) {
    return {
      effector: effectorName,
      target: targetName,
      weight: safeWeight,
      distance: null,
      reached: false,
      reason: "unsupported-effector",
    };
  }

  const before = joints.map((joint) => joint.quaternion.clone());
  solveCCD({ joints, limits, effector, target }, 12);
  for (let i = 0; i < joints.length; i++) {
    const solved = joints[i]!.quaternion.clone();
    joints[i]!.quaternion.slerpQuaternions(before[i]!, solved, safeWeight);
  }
  m.root.updateMatrixWorld(true);
  const distance = effector
    .getWorldPosition(new THREE.Vector3())
    .distanceTo(target);
  return {
    effector: effectorName,
    target: targetName,
    weight: safeWeight,
    distance,
    reached: distance <= REACH_TOLERANCE,
  };
}

/** Construct an explicit diagnostic for a target name that did not resolve. */
export function missingReachTarget(
  effector: string,
  target: string,
  weight = 1,
): ReachResidual {
  return {
    effector,
    target,
    weight: THREE.MathUtils.clamp(weight, 0, 1),
    distance: null,
    reached: false,
    reason: "missing-target",
  };
}
