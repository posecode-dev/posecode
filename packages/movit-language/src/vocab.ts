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
export const POSES = ["neutral", "standing", "plank"];

/** Effectors that can be ground-locked. */
export const EFFECTORS = ["hands", "feet"];

/** Top-level directives (excluding the `movit` header keyword). */
export const TOP_KEYWORDS = ["rig", "pose", "step", "repeat"];

/** Keywords valid as step children. */
export const CHILD_KEYWORDS = ["ground-lock", "cue"];

/** Short docs surfaced on hover and as completion detail. */
export const KEYWORD_DOCS: Record<string, string> = {
  movit: 'Document header — `movit <kind> "<name>"`.',
  rig: "Selects the rig (currently `humanoid`).",
  pose: "Sets the starting pose — `pose start = standing | neutral | plank`.",
  start: "Used in `pose start = <pose>`.",
  step: 'A movement phase — `step "<name>" <Ns> <easing>:`.',
  repeat: "How many times the movement loops.",
  "ground-lock": "Pins effectors (hands / feet) to the floor for this phase.",
  cue: "A short coaching cue shown while this phase plays.",
  hold: "Keep the joint at its neutral / rest angle.",
  hinge:
    "Hips only: closed-chain hip flexion — the torso tips over planted feet " +
    "with a neutral spine (deadlift / forward fold).",
};
