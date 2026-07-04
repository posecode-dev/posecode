/**
 * Invariant checks — the "does it look like the movement it claims to be"
 * layer. Generic checks apply to every document; movement checks encode the
 * biomechanical signature of specific canonical movements (verified against
 * the playground render).
 */

import type { PhasePose, ProbeResult } from "./probe.js";
import {
  heightOf,
  kneeFlexionDeg,
  lowestPoint,
  segmentTiltDeg,
  spineCurlDeg,
  torsoPitchDeg,
} from "./metrics.js";

export interface CheckOutcome {
  id: string;
  pass: boolean;
  /** Human-readable measurement, e.g. "torso pitch 68.2° (want ≥ 55)". */
  detail: string;
}

export interface MovementChecks {
  /** Matches ProbeResult docs by fixture file name (without extension). */
  movement: string;
  checks: ((result: ProbeResult) => CheckOutcome)[];
}

/** Find a phase by name; throws a failing outcome path if missing. */
function phase(result: ProbeResult, name: string): PhasePose | null {
  return result.phases.find((p) => p.name === name) ?? null;
}

/** Build a check on one named phase with a measured value and a predicate. */
export function phaseCheck(
  id: string,
  phaseName: string,
  measure: (pose: PhasePose) => number,
  test: (value: number) => boolean,
  want: string,
): (result: ProbeResult) => CheckOutcome {
  return (result) => {
    const p = phase(result, phaseName);
    if (!p) return { id, pass: false, detail: `phase "${phaseName}" not found` };
    const value = measure(p);
    return {
      id,
      pass: test(value),
      detail: `${value.toFixed(1)} (want ${want})`,
    };
  };
}

/** Generic invariants every well-formed movement must satisfy. */
export function genericChecks(result: ProbeResult): CheckOutcome[] {
  const out: CheckOutcome[] = [
    {
      id: "parses-clean",
      pass: result.ok && result.errors.length === 0,
      detail: result.errors.map((e) => e.message).join("; ") || "no errors",
    },
    {
      id: "no-clamp-warnings",
      pass: result.warnings.length === 0,
      detail:
        result.warnings
          .map((w) => `${w.joint} ${w.action} ${w.requested}→${w.clamped}`)
          .join("; ") || "no warnings",
    },
  ];
  for (const p of result.phases) {
    // The one universal contact invariant: nothing sinks through the floor.
    // (A stricter "declared effector is planted" check isn't portable across
    // the library — the renderer grounds the visible MESH, so a planted foot
    // leaves its ankle BONE ~0.04m up and a supporting hand leaves the wrist
    // bone higher still; stepping/travel movements lift feet by design.)
    out.push({
      id: `above-floor:${p.name}`,
      pass: lowestPoint(p) > -0.05,
      detail: `lowest bone ${lowestPoint(p).toFixed(3)}m (want > -0.05)`,
    });
  }
  return out;
}

/**
 * Movement-specific signatures. Thresholds were set from the verified
 * playground renders with margin; a regression that flattens a deadlift into
 * a leg-swing (the pre-hinge bug) fails these loudly.
 */
export const MOVEMENT_CHECKS: MovementChecks[] = [
  {
    // `pelvis: hinge` — torso tips forward over vertical legs (deadlift phases
    // "Lower"/"Lift"). Regressing the hinge into a leg-swing or a backward
    // bend fails these loudly.
    movement: "deadlift",
    checks: [
      phaseCheck("torso-hinged", "Lower", torsoPitchDeg, (v) => v >= 50, "≥ 50° pitch"),
      phaseCheck(
        "soft-knees-only",
        "Lower",
        (p) => kneeFlexionDeg(p, "left"),
        (v) => v < 45,
        "< 45° knee flexion",
      ),
      phaseCheck(
        "legs-vertical",
        "Lower",
        (p) => segmentTiltDeg(p, "knee_left", "hip_left"),
        (v) => v < 20,
        "< 20° leg tilt",
      ),
      phaseCheck("stands-back-up", "Lift", torsoPitchDeg, (v) => v < 12, "< 12° pitch"),
    ],
  },
  {
    // Good morning: same hinge, hands stay behind the head. Phases "Hinge"/"Stand".
    movement: "good-morning",
    checks: [
      phaseCheck("torso-hinged", "Hinge", torsoPitchDeg, (v) => v >= 55, "≥ 55° pitch"),
      phaseCheck(
        "legs-vertical",
        "Hinge",
        (p) => segmentTiltDeg(p, "knee_left", "hip_left"),
        (v) => v < 20,
        "< 20° leg tilt",
      ),
      phaseCheck("stands-back-up", "Stand", torsoPitchDeg, (v) => v < 12, "< 12° pitch"),
    ],
  },
  {
    movement: "squat",
    checks: [
      phaseCheck(
        "pelvis-drops",
        "Descend",
        (p) => heightOf(p, "pelvis"),
        (v) => v < 0.78,
        "pelvis < 0.78m",
      ),
      phaseCheck(
        "knees-bend-deep",
        "Descend",
        (p) => kneeFlexionDeg(p, "left"),
        (v) => v >= 75,
        "≥ 75° knee flexion",
      ),
      phaseCheck(
        "stands-back-up",
        "Drive up",
        (p) => heightOf(p, "pelvis"),
        (v) => v > 0.9,
        "pelvis > 0.9m",
      ),
    ],
  },
  {
    // forward-fold.posecode is a standing roll-down (spinal flexion). The
    // pre-fix rig curled the spine BACKWARD (-Z); forward is +Z.
    movement: "forward-fold",
    checks: [
      phaseCheck(
        "curls-forward",
        "Roll down",
        (p) => p.bones.get("head")![2],
        (v) => v > 0.05,
        "head z > 0.05m (forward)",
      ),
      phaseCheck("spine-curls", "Roll down", spineCurlDeg, (v) => v >= 25, "≥ 25° spine curl"),
    ],
  },
  {
    movement: "biceps-curl",
    checks: [
      phaseCheck(
        "forearm-raises",
        "Curl",
        (p) => heightOf(p, "wrist_left"),
        (v) => v > 1.0,
        "wrist > 1.0m",
      ),
    ],
  },
  {
    movement: "lateral-raise",
    checks: [
      phaseCheck(
        "arms-out-to-sides",
        "Raise",
        (p) => Math.abs(p.bones.get("wrist_left")![0]),
        (v) => v > 0.5,
        "wrist |x| > 0.5m",
      ),
    ],
  },
];
