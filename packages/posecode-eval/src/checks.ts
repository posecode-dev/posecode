/**
 * Invariant checks: the "does it look like the movement it claims to be"
 * layer. Generic checks apply to every document; movement checks encode the
 * biomechanical signature of specific canonical movements (verified against
 * the playground render).
 */

import type { PhasePose, ProbeResult } from "./probe.js";
import {
  balanceOverflow,
  barGripError,
  distanceBetween,
  feetCenterSkateDistance,
  footIsSupported,
  footSkateDistance,
  headPropClearance,
  heightOf,
  kneeFlexionDeg,
  lowestPoint,
  palmFloorAngleDeg,
  palmBarAngleDeg,
  phaseMaxLandmarkSpeed,
  segmentTiltDeg,
  soleUpAngleDeg,
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
    // the library: the renderer grounds the visible MESH, so a planted foot
    // leaves its ankle BONE ~0.04m up and a supporting hand leaves the wrist
    // bone higher still; stepping/travel movements lift feet by design.)
    out.push({
      id: `above-floor:${p.name}`,
      pass: lowestPoint(p) > -0.05,
      detail: `lowest bone ${lowestPoint(p).toFixed(3)}m (want > -0.05)`,
    });

    const floorHands = new Set<string>();
    for (const r of p.reaches) {
      if (r.target !== "floor") continue;
      if (r.effector === "hands" || r.effector === "hand_left") floorHands.add("left");
      if (r.effector === "hands" || r.effector === "hand_right") floorHands.add("right");
    }
    for (const pin of p.pins) {
      if (pin.anchor !== "floor") continue;
      if (pin.effector === "hands" || pin.effector === "hand_left") floorHands.add("left");
      if (pin.effector === "hands" || pin.effector === "hand_right") floorHands.add("right");
    }
    for (const side of floorHands) {
      const angle = palmFloorAngleDeg(p, side as "left" | "right");
      out.push({
        id: `palm-normal:${p.name}:${side}`,
        pass: angle < 55,
        detail: `${angle.toFixed(1)}° from palm-down (want < 55°)`,
      });
    }

    const overflow = balanceOverflow(p);
    out.push({
      id: `balance:${p.name}`,
      pass: overflow < 0.3,
      detail: `COM ${overflow.toFixed(3)}m outside support base (want < 0.30m)`,
    });

    const clearance = headPropClearance(result, p);
    if (Number.isFinite(clearance)) {
      out.push({
        id: `head-prop-clearance:${p.name}`,
        pass: clearance > -0.01,
        detail: `${clearance.toFixed(3)}m clearance (want > -0.01m)`,
      });
    }
  }

  for (let i = 1; i < result.phases.length; i++) {
    const previous = result.phases[i - 1]!;
    const current = result.phases[i]!;
    const bothSupported = (["left", "right"] as const).every((side) =>
      footIsSupported(previous, side) && footIsSupported(current, side));
    if (bothSupported) {
      const skate = feetCenterSkateDistance(previous, current);
      out.push({
        id: `foot-skate:${current.name}:pair`,
        pass: skate < 0.08,
        detail: `${skate.toFixed(3)}m planted support-center drift (want < 0.08m)`,
      });
    }
    for (const side of ["left", "right"] as const) {
      const explicitlyPinned = (phase: PhasePose) => phase.pins.some((p) =>
        (p.effector === "feet" || p.effector === `foot_${side}`) && p.anchor === "floor");
      if (!explicitlyPinned(previous) || !explicitlyPinned(current)) continue;
      const skate = footSkateDistance(previous, current, side);
      out.push({
        id: `foot-skate:${current.name}:${side}`,
        pass: skate < 0.08,
        detail: `${skate.toFixed(3)}m pinned-foot drift (want < 0.08m)`,
      });
    }
    const speed = phaseMaxLandmarkSpeed(previous, current);
    out.push({
      id: `transition-speed:${current.name}`,
      pass: speed < 4,
      detail: `${speed.toFixed(2)}m/s fastest landmark (want < 4.0m/s)`,
    });
    if (current.easing === "linear" && speed > 0.15) {
      out.push({
        id: `transition-easing:${current.name}`,
        pass: false,
        detail: `moving linear phase enters at ${speed.toFixed(2)}m/s (use eased transition)`,
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
    // `pelvis: hinge`: torso tips forward over vertical legs (deadlift phases
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
      phaseCheck(
        "feet-stay-planted",
        "Lower",
        (p) => Math.max(heightOf(p, "ankle_left"), heightOf(p, "ankle_right")),
        (v) => v < 0.15,
        "both ankles < 0.15m",
      ),
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
      phaseCheck("left-sole-flat", "Descend", (p) => soleUpAngleDeg(p, "left"), (v) => v < 2, "< 2°"),
      phaseCheck("right-sole-flat", "Descend", (p) => soleUpAngleDeg(p, "right"), (v) => v < 2, "< 2°"),
    ],
  },
  {
    movement: "pull-up",
    checks: [
      phaseCheck("left-grip-position", "Hang", (p) => barGripError(p, "left"), (v) => v < 0.12, "< 0.12m"),
      phaseCheck("right-grip-position", "Hang", (p) => barGripError(p, "right"), (v) => v < 0.12, "< 0.12m"),
      phaseCheck("left-palm-wrap", "Hang", (p) => palmBarAngleDeg(p, "left"), (v) => v < 5, "< 5°"),
      phaseCheck("right-palm-wrap", "Hang", (p) => palmBarAngleDeg(p, "right"), (v) => v < 5, "< 5°"),
      phaseCheck("left-grip-held", "Pull up", (p) => barGripError(p, "left"), (v) => v < 0.12, "< 0.12m"),
      phaseCheck("right-grip-held", "Pull up", (p) => barGripError(p, "right"), (v) => v < 0.12, "< 0.12m"),
    ],
  },
  {
    movement: "walk-cycle",
    checks: [
      phaseCheck("left-stance-flat", "Step right", (p) => soleUpAngleDeg(p, "left"), (v) => v < 2, "< 2°"),
      phaseCheck("right-stance-flat", "Step left", (p) => soleUpAngleDeg(p, "right"), (v) => v < 2, "< 2°"),
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
  {
    movement: "plank-hold",
    checks: [
      phaseCheck(
        "forearms-support-body",
        "Hold",
        (p) => Math.max(heightOf(p, "elbow_left"), heightOf(p, "elbow_right")),
        (v) => v < 0.08,
        "both elbows < 0.08m",
      ),
    ],
  },
  {
    movement: "crunch",
    checks: [
      phaseCheck("pelvis-stays-down", "Curl up", (p) => heightOf(p, "pelvis"), (v) => v < 0.18, "pelvis < 0.18m"),
      phaseCheck(
        "feet-stay-down",
        "Curl up",
        (p) => Math.max(heightOf(p, "ankle_left"), heightOf(p, "ankle_right")),
        (v) => v < 0.18,
        "both ankles < 0.18m",
      ),
    ],
  },
  {
    movement: "bicycle-crunch",
    checks: [
      phaseCheck("right-elbow-nears-left-knee", "Right to left", (p) => distanceBetween(p, "elbow_right", "knee_left"), (v) => v < 0.45, "distance < 0.45m"),
      phaseCheck("left-elbow-nears-right-knee", "Left to right", (p) => distanceBetween(p, "elbow_left", "knee_right"), (v) => v < 0.45, "distance < 0.45m"),
    ],
  },
  {
    movement: "superman",
    checks: [
      phaseCheck("pelvis-remains-supported", "Lift", (p) => heightOf(p, "pelvis"), (v) => v < 0.16, "pelvis < 0.16m"),
    ],
  },
];
