/**
 * Joint vocabulary and the semantic-action → rotation-axis mapping.
 *
 * Coordinate convention (must match the renderer's rig: see spec/SPEC.md):
 *   Rest pose: standing, arms at sides, facing +Z. Each bone rotates in its
 *   own local frame where
 *     X = sagittal plane  (flexion / extension)
 *     Y = longitudinal    (internal / external rotation)
 *     Z = frontal plane   (abduction / adduction)
 *   The unmirrored sign of each action is the RIGHT side's (the body's right
 *   is -X); left-side bones mirror the Y and Z axes so symmetric cues look
 *   symmetric: `shoulders: abduct 80` lifts both arms away from the midline.
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

  // Hand rig: one curl bone per finger (single DOF), off each wrist.
  "thumb_left",
  "index_left",
  "middle_left",
  "ring_left",
  "pinky_left",
  "thumb_right",
  "index_right",
  "middle_right",
  "ring_right",
  "pinky_right",
] as const;

export type BoneId = (typeof BONES)[number];

const BONE_SET = new Set<string>(BONES);

/** Symmetric DSL group names → the bones they expand to. */
const FINGERS_LEFT: BoneId[] = [
  "thumb_left",
  "index_left",
  "middle_left",
  "ring_left",
  "pinky_left",
];
const FINGERS_RIGHT: BoneId[] = [
  "thumb_right",
  "index_right",
  "middle_right",
  "ring_right",
  "pinky_right",
];

const GROUPS: Record<string, BoneId[]> = {
  shoulders: ["shoulder_left", "shoulder_right"],
  elbows: ["elbow_left", "elbow_right"],
  wrists: ["wrist_left", "wrist_right"],
  hips: ["hip_left", "hip_right"],
  knees: ["knee_left", "knee_right"],
  ankles: ["ankle_left", "ankle_right"],
  // Finger groups: curl one hand, or both with `fingers`.
  fingers_left: FINGERS_LEFT,
  fingers_right: FINGERS_RIGHT,
  fingers: [...FINGERS_LEFT, ...FINGERS_RIGHT],
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

/** Per-side reach/pin effectors (friendly aliases the renderer maps to bones). */
const EFFECTOR_SIDES = [
  "hand_left",
  "hand_right",
  "elbow_left",
  "elbow_right",
  "foot_left",
  "foot_right",
  // Axial support point for floor-based poses such as cobra. Unlike a reach,
  // pinning the pelvis moves the root while the spine and limbs articulate.
  "pelvis",
] as const;

/** Symmetric effector groups → the per-side effectors they expand to. */
const EFFECTOR_GROUPS: Record<string, string[]> = {
  hands: ["hand_left", "hand_right"],
  forearms: ["elbow_left", "elbow_right"],
  feet: ["foot_left", "foot_right"],
};

/** Every effector name `reach:` / `pin:` accept: groups + per-side aliases. */
export const EFFECTOR_NAMES = [...Object.keys(EFFECTOR_GROUPS), ...EFFECTOR_SIDES];

/**
 * Effectors accepted by `ground-lock:`. Ground locking has historically
 * supported the symmetric hand/forearm/foot groups; per-side aliases let a
 * movement keep one support planted while the opposite limb moves freely.
 */
export const GROUND_LOCK_EFFECTOR_NAMES = [
  "hands",
  "hand_left",
  "hand_right",
  "forearms",
  "elbow_left",
  "elbow_right",
  "feet",
  "foot_left",
  "foot_right",
] as const;

const GROUND_LOCK_EFFECTOR_SET = new Set<string>(GROUND_LOCK_EFFECTOR_NAMES);

/** True when an effector is implemented by the ground-lock solver. */
export function isGroundLockEffector(name: string): boolean {
  return GROUND_LOCK_EFFECTOR_SET.has(name);
}
const EFFECTOR_SIDE_SET = new Set<string>(EFFECTOR_SIDES);

/**
 * Resolve a reach/pin effector name into per-side effectors (`hands` →
 * both hands). Returns an empty array if the name is unknown (caller errors).
 */
export function expandEffector(name: string): string[] {
  const group = EFFECTOR_GROUPS[name];
  if (group) return [...group];
  if (EFFECTOR_SIDE_SET.has(name)) return [name];
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
  // Frontal plane. The unmirrored sign is the RIGHT side's; with every bone
  // resting along -Y and the right side of the body at -X, carrying a limb
  // AWAY from the midline (abduction) is a -Z rotation. The left side mirrors
  // to +Z. (Base sign +1 here was a bug that swung both arms and both legs
  // through the torso.) For the unmirrored axial bones (spine/neck) abduct
  // reads as lateral flexion toward the person's left.
  abduct: { axis: "z", sign: -1 },
  adduct: { axis: "z", sign: 1 },
  "rotate-in": { axis: "y", sign: 1 },
  "rotate-out": { axis: "y", sign: -1 },
  supinate: { axis: "y", sign: 1 },
  pronate: { axis: "y", sign: -1 },
  // The foot points FORWARD (+Z): lifting the toes toward the shin
  // (dorsiflexion) is a -X rotation, pointing them is +X.
  dorsiflex: { axis: "x", sign: -1 },
  plantarflex: { axis: "x", sign: 1 },
  // Hip hinge: tip the torso forward over the hip line (deadlift, row, bow,
  // good-morning). Applied to the `pelvis`, whose torso child points UP, so
  // forward is +X (like spine flexion). The renderer counter-rotates the hips
  // so the legs stay planted; see posecode-render/src/timeline.ts.
  hinge: { axis: "x", sign: 1 },
};

/** Every semantic action name the DSL accepts (e.g. "flex", "abduct"). */
export const ACTION_NAMES = Object.keys(ACTIONS);

/** Map a semantic action to its rotation axis and sign, or null if unknown. */
export function actionAxis(action: string): ActionAxis | null {
  return ACTIONS[action] ?? null;
}

/**
 * Sagittal flexion direction differs by joint. Limb bones rest along -Y
 * (their child chain points DOWN), so flexing toward +Z (anatomically
 * forward: hip, shoulder, elbow, wrist, fingers) is a -X rotation. The AXIAL
 * chain (spine, chest, neck, head) points UP, so the same forward bend is +X.
 * The KNEE is the odd limb out: it flexes backward (heel toward the buttock),
 * +X. `extend` is the opposite of `flex`. Used by the resolver to sign
 * flex/extend per joint so a squat folds and a crunch curls forward instead
 * of inverting.
 */
const FLEXION_SIGN: Record<string, number> = {
  knee: 1,
  spine: 1,
  chest: 1,
  neck: 1,
  head: 1,
};

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
