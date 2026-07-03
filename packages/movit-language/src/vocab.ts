/**
 * The Movit vocabulary — the single source of truth editors complete against.
 * Joint/action/easing lists come straight from the parser so they can never
 * drift from what the language actually accepts.
 */

import { JOINT_NAMES, ACTION_NAMES, EASINGS, EFFECTOR_NAMES } from "movit-parser";

export { JOINT_NAMES, ACTION_NAMES, EASINGS };

/** Movement kinds in the header (`movit <kind> "..."`). */
export const KINDS = ["exercise", "stretch", "posture"];

/** Recognised start poses (`pose start = ...`). */
export const POSES = ["neutral", "standing", "plank", "supine", "prone", "seated"];

/** Effectors that can be ground-locked. */
export const EFFECTORS = ["hands", "feet"];

/** Reach/pin effectors (groups + per-side aliases) — sourced from the parser. */
export const REACH_EFFECTORS = EFFECTOR_NAMES;
export const PROPS = ["chair", "wall", "bar", "box", "dip-bars"];

/** Top-level directives (excluding the `movit` header keyword). */
export const TOP_KEYWORDS = ["rig", "prop", "pose", "step", "repeat"];

/** Keywords valid as step children. */
export const CHILD_KEYWORDS = ["ground-lock", "reach", "pin", "turn", "travel", "cue"];

/** Short docs surfaced on hover and as completion detail. */
export const KEYWORD_DOCS: Record<string, string> = {
  movit: 'Document header — `movit <kind> "<name>"`.',
  rig: "Selects the rig (currently `humanoid`).",
  prop: "Adds a scene object — `prop chair | wall | bar | box | dip-bars`. Supplies reach/pin anchors.",
  pose: "Sets the starting pose — `pose start = standing | neutral | plank | supine | prone | seated`.",
  start: "Used in `pose start = <pose>`.",
  step: 'A movement phase — `step "<name>" <Ns> <easing>:`.',
  repeat: "How many times the movement loops.",
  "ground-lock": "Pins effectors (hands / feet) to the floor for this phase.",
  reach:
    "Drives an effector to a target via ROM-constrained IK — `reach: hand_left ankle_left`, `reach: hands floor`.",
  pin: "Moves the body so an effector sits on an anchor — `pin: hands bar` (hang, pull up, step up, dip).",
  turn: "Turns the figure to face a new direction — `turn: 360` (degrees, yaw about vertical). Absolute, carried across phases. Standing poses only.",
  travel: "Moves the figure across the floor — `travel: 0.4 0` (world x z metres from the start spot). Absolute, carried across phases. Standing poses only.",
  cue: "A short coaching cue shown while this phase plays.",
  hold: "Keep the joint at its neutral / rest angle.",
};
