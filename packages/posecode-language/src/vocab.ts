/**
 * The Posecode vocabulary: the single source of truth editors complete against.
 * Joint/action/easing lists come straight from the parser so they can never
 * drift from what the language actually accepts.
 */

import {
  JOINT_NAMES,
  ACTION_NAMES,
  EASINGS,
  MODES,
  LEGACY_MODE_ALIASES,
  REACH_EFFECTOR_NAMES,
  PIN_EFFECTOR_NAMES,
  GRIP_EFFECTOR_NAMES,
  GROUND_LOCK_EFFECTOR_NAMES,
  MOVEMENT_KINDS,
  START_POSE_NAMES,
  PROP_TYPES,
  actionsForJoint,
} from "posecode-parser";

export {
  JOINT_NAMES,
  ACTION_NAMES,
  EASINGS,
  MODES,
  LEGACY_MODE_ALIASES,
  actionsForJoint,
};

/** Movement kinds in the header (`posecode <kind> "..."`). */
export const KINDS: string[] = [...MOVEMENT_KINDS];

/** Recognised start poses (`pose start = ...`). */
export const POSES: string[] = [...START_POSE_NAMES];

/** Floor contacts that can be ground-locked. */
export const EFFECTORS = [...GROUND_LOCK_EFFECTOR_NAMES];

/** Capability-specific constraint effectors, sourced from the parser. */
export const REACH_EFFECTORS = [...REACH_EFFECTOR_NAMES];
export const PIN_EFFECTORS = [...PIN_EFFECTOR_NAMES];
export const GRIP_EFFECTORS = [...GRIP_EFFECTOR_NAMES];
export const PROPS: string[] = [...PROP_TYPES];

/** Top-level directives (excluding the `posecode` header keyword). */
export const TOP_KEYWORDS = ["rig", "prop", "pose", "clip", "step", "repeat"];

/** Keywords valid as step children. */
export const CHILD_KEYWORDS = ["ground-lock", "reach", "pin", "grip", "turn", "travel", "cue"];

/** Short docs surfaced on hover and as completion detail. */
export const KEYWORD_DOCS: Record<string, string> = {
  posecode: 'Document header: `posecode <kind> "<name>"`.',
  rig: "Selects the rig (currently `humanoid`).",
  prop: "Adds a scene object: `prop chair | wall | bar | box | dip-bars`. Supplies declared reach, pin, and grip anchors.",
  pose: "Sets the starting pose. Add a trailing `:` and indented joint targets to sparsely override a built-in pose.",
  start: "Used in `pose start = <pose>` or the custom form `pose start = <pose>:` followed by joint overrides.",
  clip: 'Optional mocap clip: `clip "walk"`. A renderer with a matching retargeted animation plays it crossfaded over the procedural pose; others ignore it.',
  step: 'A movement phase: `step "<name>" <Ns> <mode>:` where mode is flow | settle | drive | snap | linear.',
  flow: "Timing mode: pass through this pose with continuous velocity (flowing motion).",
  settle: "Timing mode: decelerate to a genuine rest at this pose (a deliberate pause).",
  drive: "Timing mode: accelerate from rest, like the concentric effort of a rep.",
  snap: "Timing mode: fast, near-immediate arrival with an accent.",
  linear: "Timing mode: constant velocity; intentionally mechanical.",
  repeat: "How many times the movement loops.",
  "ground-lock": "Keeps declared floor supports planted for this phase: grouped, per-side, or axial contacts such as `feet`, `foot_left` (also written `left foot`), `hands`, `forearms`, and `back` for supine work. Repeat the declaration in every phase that needs it; planted feet auto-level unless intentionally plantarflexed.",
  reach:
    "Drives a limb effector toward a validated target via constrained IK: `reach: hand_left ankle_left`, `reach: fist_left floor`, `reach: knee_left floor`.",
  pin: "Moves the body so one primary effector sits on a validated anchor. Use `grip` for a two-hand bar or rails contact.",
  grip: "Holds a bar/rail: `grip: hands bar`. Each hand gets its own two-point anchor (bar_left/bar_right), the arm bends via IK onto it, and the fingers wrap the bar. Use for pull-up, dead-hang, hanging knee raise.",
  turn: "Turns the figure to face a new direction: `turn: 360` (degrees, yaw about vertical). Absolute, carried across phases. Standing poses only.",
  travel: "Moves the figure across the floor: `travel: 0.4 0` (world x z metres from the start spot). Absolute, carried across phases. Standing poses only.",
  cue: "A short coaching cue shown while this phase plays.",
  hold: "Reset every rotation channel on this joint to its neutral / rest angle: `<joint>: hold neutral`.",
  pronate: "Rolls the forearm toward palm-down. With upright arms at the sides, about 80° faces the palm inward toward the thigh; final world facing also depends on the arm pose.",
  supinate: "Rolls the forearm in the palm-up direction; final world facing also depends on the shoulder and elbow pose.",
};
