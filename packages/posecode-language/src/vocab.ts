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
  EFFECTOR_NAMES,
  GROUND_LOCK_EFFECTOR_NAMES,
} from "posecode-parser";

export { JOINT_NAMES, ACTION_NAMES, EASINGS, MODES, LEGACY_MODE_ALIASES };

/** Movement kinds in the header (`posecode <kind> "..."`). */
export const KINDS = ["exercise", "stretch", "posture"];

/** Recognised start poses (`pose start = ...`). */
export const POSES = ["neutral", "standing", "plank", "supine", "prone", "seated"];

/** Effectors that can be ground-locked. */
export const EFFECTORS = [...GROUND_LOCK_EFFECTOR_NAMES];

/** Reach/pin effectors (groups + per-side aliases), sourced from the parser. */
export const REACH_EFFECTORS = EFFECTOR_NAMES;
export const PROPS = ["chair", "wall", "bar", "box", "dip-bars"];

/** Top-level directives (excluding the `posecode` header keyword). */
export const TOP_KEYWORDS = ["rig", "prop", "pose", "clip", "step", "repeat"];

/** Keywords valid as step children. */
export const CHILD_KEYWORDS = ["ground-lock", "reach", "pin", "grip", "turn", "travel", "cue"];

/** Short docs surfaced on hover and as completion detail. */
export const KEYWORD_DOCS: Record<string, string> = {
  posecode: 'Document header: `posecode <kind> "<name>"`.',
  rig: "Selects the rig (currently `humanoid`).",
  prop: "Adds a scene object: `prop chair | wall | bar | box | dip-bars`. Supplies reach/pin anchors.",
  pose: "Sets the starting pose: `pose start = standing | neutral | plank | supine | prone | seated`.",
  start: "Used in `pose start = <pose>`.",
  clip: 'Optional mocap clip: `clip "walk"`. A renderer with a matching retargeted animation plays it crossfaded over the procedural pose; others ignore it.',
  step: 'A movement phase: `step "<name>" <Ns> <mode>:` where mode is flow | settle | drive | snap | linear.',
  flow: "Timing mode: pass through this pose with continuous velocity (flowing motion).",
  settle: "Timing mode: decelerate to a genuine rest at this pose (a deliberate pause).",
  drive: "Timing mode: accelerate from rest — the concentric effort of a rep.",
  snap: "Timing mode: fast, near-immediate arrival — an accent.",
  linear: "Timing mode: constant velocity — intentionally mechanical.",
  repeat: "How many times the movement loops.",
  "ground-lock": "Pins grouped or per-side effectors to the floor for this phase: `ground-lock: feet`, `ground-lock: foot_right`. Planted feet auto-level flat unless the ankle is plantarflexed (tiptoe).",
  reach:
    "Drives an effector to a target via ROM-constrained IK: `reach: hand_left ankle_left`, `reach: hands floor`.",
  pin: "Moves the body so an effector sits on an anchor: `pin: hands bar` (hang, pull up, step up, dip).",
  grip: "Holds a bar/rail: `grip: hands bar`. Each hand gets its own two-point anchor (bar_left/bar_right), the arm bends via IK onto it, and the fingers wrap the bar. Use for pull-up, dead-hang, hanging knee raise.",
  turn: "Turns the figure to face a new direction: `turn: 360` (degrees, yaw about vertical). Absolute, carried across phases. Standing poses only.",
  travel: "Moves the figure across the floor: `travel: 0.4 0` (world x z metres from the start spot). Absolute, carried across phases. Standing poses only.",
  cue: "A short coaching cue shown while this phase plays.",
  hold: "Keep the joint at its neutral / rest angle.",
};
