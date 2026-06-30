/**
 * The Movit vocabulary — the single source of truth editors complete against.
 * Joint/action/easing lists come straight from the parser so they can never
 * drift from what the language actually accepts.
 */

import { JOINT_NAMES, ACTION_NAMES, EASINGS } from "movit-parser";

export { JOINT_NAMES, ACTION_NAMES, EASINGS };

/** Movement kinds in the header (`movit <kind> "..."`). */
export const KINDS = ["exercise", "stretch", "posture"];

/** Recognised start poses (`pose start = ...`). */
export const POSES = ["neutral", "standing", "plank", "supine", "prone", "seated"];

/** Effectors that can be ground-locked. */
export const EFFECTORS = ["hands", "feet"];

/** Reach effectors (friendly aliases) and the scene props that supply anchors. */
export const REACH_EFFECTORS = ["hand_left", "hand_right", "foot_left", "foot_right"];
export const PROPS = ["chair", "wall", "bar", "box"];

/** Top-level directives (excluding the `movit` header keyword). */
export const TOP_KEYWORDS = ["rig", "prop", "pose", "step", "repeat"];

/** Keywords valid as step children. */
export const CHILD_KEYWORDS = ["ground-lock", "reach", "pin", "cue"];

/** Short docs surfaced on hover and as completion detail. */
export const KEYWORD_DOCS: Record<string, string> = {
  movit: 'Document header — `movit <kind> "<name>"`.',
  rig: "Selects the rig (currently `humanoid`).",
  prop: "Adds a scene object — `prop chair | wall | bar | box`. Supplies reach anchors.",
  pose: "Sets the starting pose — `pose start = standing | neutral | plank | supine | prone | seated`.",
  start: "Used in `pose start = <pose>`.",
  step: 'A movement phase — `step "<name>" <Ns> <easing>:`.',
  repeat: "How many times the movement loops.",
  "ground-lock": "Pins effectors (hands / feet) to the floor for this phase.",
  reach: "Drives an effector to a target via IK — `reach: hand_left ankle_left`.",
  pin: "Moves the body so an effector sits on an anchor — `pin: hand_left bar` (hang, pull up, step up, dip).",
  cue: "A short coaching cue shown while this phase plays.",
  hold: "Keep the joint at its neutral / rest angle.",
};
