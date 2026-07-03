/**
 * Invariant checks — the "does it look like the movement it claims to be"
 * layer. Generic checks apply to every document; movement checks encode the
 * biomechanical signature of specific canonical movements (verified against
 * the playground render).
 */

import type { PhasePose, ProbeResult } from "./probe.js";
import {
  feetHeight,
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
    out.push({
      id: `above-floor:${p.name}`,
      pass: lowestPoint(p) > -0.05,
      detail: `lowest bone ${lowestPoint(p).toFixed(3)}m (want > -0.05)`,
    });
    const hands = p.groundLock.includes("hands");
    const feet = p.groundLock.includes("feet");
    if (feet && !hands) {
      // Standing support: the ankle joints sit on the floor.
      out.push({
        id: `feet-planted:${p.name}`,
        pass: Math.abs(feetHeight(p)) < 0.03,
        detail: `avg ankle height ${feetHeight(p).toFixed(3)}m (want |·| < 0.03)`,
      });
    } else if (hands && feet) {
      // Plank-style support pivots on the TOES (ankles ride above the floor);
      // the solver drives the hands to the ground, so assert that instead.
      const handY = (heightOf(p, "wrist_left") + heightOf(p, "wrist_right")) / 2;
      out.push({
        id: `hands-planted:${p.name}`,
        pass: Math.abs(handY) < 0.03,
        detail: `avg wrist height ${handY.toFixed(3)}m (want |·| < 0.03)`,
      });
    }
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
    movement: "deadlift",
    checks: [
      phaseCheck("torso-hinged", "Hinge down", torsoPitchDeg, (v) => v >= 55, "≥ 55° pitch"),
      phaseCheck(
        "soft-knees-only",
        "Hinge down",
        (p) => kneeFlexionDeg(p, "left"),
        (v) => v < 35,
        "< 35° knee flexion",
      ),
      phaseCheck(
        "legs-vertical",
        "Hinge down",
        (p) => segmentTiltDeg(p, "knee_left", "hip_left"),
        (v) => v < 15,
        "< 15° leg tilt",
      ),
      phaseCheck("flat-back", "Hinge down", spineCurlDeg, (v) => v < 15, "< 15° spine curl"),
      phaseCheck("stands-back-up", "Stand tall", torsoPitchDeg, (v) => v < 10, "< 10° pitch"),
    ],
  },
  {
    movement: "forward-fold",
    checks: [
      phaseCheck("deep-hinge", "Fold", torsoPitchDeg, (v) => v >= 75, "≥ 75° pitch"),
      phaseCheck(
        "head-drops",
        "Fold",
        (p) => heightOf(p, "head"),
        (v) => v < 1.0,
        "head < 1.0m",
      ),
      phaseCheck(
        "arms-hang",
        "Fold",
        (p) => heightOf(p, "wrist_left"),
        (v) => v < 0.7,
        "wrist < 0.7m",
      ),
    ],
  },
  {
    movement: "squat",
    checks: [
      phaseCheck(
        "pelvis-drops",
        "Descend",
        (p) => heightOf(p, "pelvis"),
        (v) => v < 0.75,
        "pelvis < 0.75m",
      ),
      phaseCheck(
        "knees-bend-deep",
        "Descend",
        (p) => kneeFlexionDeg(p, "left"),
        (v) => v >= 80,
        "≥ 80° knee flexion",
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
    movement: "roll-down",
    checks: [
      // The pre-fix rig curled the spine BACKWARD (-Z); forward is +Z.
      phaseCheck(
        "curls-forward",
        "Roll down",
        (p) => p.bones.get("head")![2],
        (v) => v > 0.1,
        "head z > 0.1m (forward)",
      ),
      phaseCheck("spine-curls", "Roll down", spineCurlDeg, (v) => v >= 30, "≥ 30° spine curl"),
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
