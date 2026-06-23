/**
 * Joint vocabulary and the semantic-action → rotation-axis mapping.
 *
 * Coordinate convention (must match the renderer's rig — see spec/SPEC.md):
 *   Rest pose: standing, arms at sides, facing +Z. Each bone rotates in its
 *   own local frame where
 *     X = sagittal plane  (flexion +, extension -)
 *     Y = longitudinal    (internal rotation +, external -)
 *     Z = frontal plane   (abduction +, adduction -)
 *   Left-side bones mirror the Y and Z axes so symmetric cues look symmetric.
 */

import type { Axis } from "./types.js";

/** Every bone the rig exposes. The renderer must provide a Bone for each id. */
export const BONES = [
  "pelvis",
  "spine",
  "chest",
  "neck",
  "head",
  "shoulder_left",
  "shoulder_right",
  "elbow_left",
  "elbow_right",
  "wrist_left",
  "wrist_right",
  "hip_left",
  "hip_right",
  "knee_left",
  "knee_right",
  "ankle_left",
  "ankle_right",
] as const;

export type BoneId = (typeof BONES)[number];

const BONE_SET = new Set<string>(BONES);

/** Symmetric DSL group names → the bones they expand to. */
const GROUPS: Record<string, BoneId[]> = {
  shoulders: ["shoulder_left", "shoulder_right"],
  elbows: ["elbow_left", "elbow_right"],
  wrists: ["wrist_left", "wrist_right"],
  hips: ["hip_left", "hip_right"],
  knees: ["knee_left", "knee_right"],
  ankles: ["ankle_left", "ankle_right"],
};

/** Symmetric group names usable as joints in the DSL (e.g. "shoulders"). */
export const JOINT_GROUP_NAMES = Object.keys(GROUPS);

/** Every joint name the DSL accepts: symmetric groups + explicit bones. */
export const JOINT_NAMES = [...JOINT_GROUP_NAMES, ...BONES];

/**
 * Resolve a DSL joint name into one or more bone ids.
 * Returns an empty array if the name is unknown (caller emits the error).
 */
export function expandJoint(name: string): string[] {
  const group = GROUPS[name];
  if (group) return [...group];
  if (BONE_SET.has(name)) return [name];
  return [];
}

export interface ActionAxis {
  axis: Axis;
  /** +1 or -1 in the bone's local frame (before left/right mirroring). */
  sign: number;
}

const ACTIONS: Record<string, ActionAxis> = {
  flex: { axis: "x", sign: 1 },
  extend: { axis: "x", sign: -1 },
  abduct: { axis: "z", sign: 1 },
  adduct: { axis: "z", sign: -1 },
  "rotate-in": { axis: "y", sign: 1 },
  "rotate-out": { axis: "y", sign: -1 },
  supinate: { axis: "y", sign: 1 },
  pronate: { axis: "y", sign: -1 },
  dorsiflex: { axis: "x", sign: 1 },
  plantarflex: { axis: "x", sign: -1 },
};

/** Every semantic action name the DSL accepts (e.g. "flex", "abduct"). */
export const ACTION_NAMES = Object.keys(ACTIONS);

/** Map a semantic action to its rotation axis and sign, or null if unknown. */
export function actionAxis(action: string): ActionAxis | null {
  return ACTIONS[action] ?? null;
}

/**
 * Sagittal flexion direction differs by joint. With every bone resting along
 * -Y, most joints flex toward +Z (anatomically forward / up): hip, shoulder,
 * elbow, spine, neck. The KNEE is the exception — it flexes toward -Z (heel
 * toward the buttock). `extend` is the opposite of `flex`. Used by the resolver
 * to sign flex/extend per joint so a squat folds correctly instead of inverting.
 */
const FLEXION_SIGN: Record<string, number> = { knee: 1 };

export function flexionSign(boneType: string): number {
  return FLEXION_SIGN[boneType] ?? -1;
}

/** Reduce a bone id to its joint type (drops `_left` / `_right`). */
export function boneType(boneId: string): string {
  return boneId.replace(/_(left|right)$/, "");
}

/** True for left-side bones, which mirror the Y and Z axes. */
export function isLeft(boneId: string): boolean {
  return boneId.endsWith("_left");
}
