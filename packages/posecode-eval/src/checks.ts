/**
 * Invariant checks: the "does it look like the movement it claims to be"
 * layer. Generic checks apply to every document; movement checks encode the
 * biomechanical signature of specific canonical movements (verified against
 * the playground render).
 */

import type { PhasePose, ProbeResult } from "./probe.js";
import { REACH_TOLERANCE } from "posecode-render";
import {
  balanceOverflow,
  distanceBetween,
  feetCenterSkateDistance,
  fistFloorAngleDeg,
  footIsSupported,
  footSkateDistance,
  footWorldSkateDistance,
  forwardCoordinate,
  headPropClearance,
  heightOf,
  kneeFlexionDeg,
  lowestPoint,
  palmFloorAngleDeg,
  phaseMaxLandmarkSpeed,
  propPenetrationDepth,
  segmentTiltDeg,
  soleUpAngleDeg,
  spineCurlDeg,
  torsoForwardPitchDeg,
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

/** Maximum positional error for a declared reach/pin/grip contact. */
export const CONTACT_ERROR_MAX = REACH_TOLERANCE;

/** Find a phase by name; throws a failing outcome path if missing. */
function phase(result: ProbeResult, name: string): PhasePose | null {
  return result.phases.find((p) => p.name === name) ?? null;
}

/** Expanded identities of every body part explicitly supported by the floor. */
function floorSupportEffectors(pose: PhasePose): Set<string> {
  const supports = new Set<string>();
  const add = (effector: string): void => {
    const groups: Readonly<Record<string, readonly string[]>> = {
      feet: ["foot_left", "foot_right"],
      hands: ["hand_left", "hand_right"],
      fists: ["fist_left", "fist_right"],
      knees: ["knee_left", "knee_right"],
      forearms: ["elbow_left", "elbow_right"],
    };
    for (const item of groups[effector] ?? [effector]) supports.add(item);
  };
  pose.groundLock.forEach(add);
  pose.reaches.filter((reach) => reach.target === "floor").forEach((reach) => add(reach.effector));
  pose.pins.filter((pin) => pin.anchor === "floor").forEach((pin) => add(pin.effector));
  return supports;
}

function footSupportKind(
  pose: PhasePose,
  side: "left" | "right",
): "ground-lock" | "pin" | null {
  if (pose.pins.some((pin) =>
    (pin.effector === "feet" || pin.effector === `foot_${side}`) && pin.anchor === "floor")) {
    return "pin";
  }
  if (pose.groundLock.includes("feet") || pose.groundLock.includes(`foot_${side}`)) {
    return "ground-lock";
  }
  return null;
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
    {
      id: "has-phases",
      pass: result.phases.length > 0,
      detail: result.phases.length > 0
        ? `${result.phases.length} phase(s)`
        : "no movement phases to evaluate",
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

    // A ground-locked phase declares its effectors planted, so the visible mesh
    // must actually rest on the floor — not hover above it. Guards the
    // levitating-squat/deadlift regression where levelPlantedFeet lifted the
    // sole after ground-lock and an up-only clamp left the whole figure floating.
    if (p.floorBound) {
      out.push({
        id: `grounded-not-floating:${p.name}`,
        pass: p.meshMinY > -0.02 && p.meshMinY < 0.02,
        detail: `mesh floor offset ${p.meshMinY.toFixed(3)}m (want -0.020 to +0.020)`,
      });
    }

    // A contact declaration is an executable promise, not metadata. Every
    // reach/pin/grip must either resolve within tolerance or fail explicitly;
    // unsupported targets/solver paths must never disappear into a green score.
    p.contactResiduals.forEach((contact, index) => {
      const suffix = `${p.name}:${contact.kind}:${contact.effector}:${contact.target}:${index}`;
      if (contact.status === "unsupported" || contact.error === null) {
        out.push({
          id: `contact-supported:${suffix}`,
          pass: false,
          detail: contact.reason ?? "contact could not be evaluated",
        });
        return;
      }
      out.push({
        id: `contact-position:${suffix}`,
        pass: contact.error <= CONTACT_ERROR_MAX,
        detail: `${contact.error.toFixed(3)}m residual (want ≤ ${CONTACT_ERROR_MAX.toFixed(3)}m)`,
      });
    });

    const floorHands = new Set<string>();
    const floorFists = new Set<string>();
    const collectFloorHand = (effector: string): void => {
      if (effector === "hands" || effector === "hand_left") floorHands.add("left");
      if (effector === "hands" || effector === "hand_right") floorHands.add("right");
      if (effector === "fists" || effector === "fist_left") floorFists.add("left");
      if (effector === "fists" || effector === "fist_right") floorFists.add("right");
    };
    p.reaches.filter((reach) => reach.target === "floor").forEach((reach) => collectFloorHand(reach.effector));
    p.pins.filter((pin) => pin.anchor === "floor").forEach((pin) => collectFloorHand(pin.effector));
    p.groundLock.forEach(collectFloorHand);
    for (const side of floorHands) {
      const angle = palmFloorAngleDeg(p, side as "left" | "right");
      out.push({
        id: `palm-normal:${p.name}:${side}`,
        pass: angle < 55,
        detail: `${angle.toFixed(1)}° from palm-down (want < 55°)`,
      });
    }
    for (const side of floorFists) {
      const angle = fistFloorAngleDeg(p, side as "left" | "right");
      out.push({
        id: `fist-normal:${p.name}:${side}`,
        pass: angle < 55,
        detail: `${angle.toFixed(1)}° from knuckles-down (want < 55°)`,
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

    // Props are solid: no body capsule may sit inside a prop's blocking face
    // (the wall-sit-through-the-wall class of bug). Independent re-derivation
    // of the face geometry, so it fails loudly if resolvePropContacts or a
    // prop's collider declaration regresses.
    const penetration = propPenetrationDepth(result, p);
    if (Number.isFinite(penetration)) {
      out.push({
        id: `solid-props:${p.name}`,
        pass: penetration < 0.03,
        detail: `${penetration.toFixed(3)}m into a solid prop face (want < 0.030)`,
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
      // With both feet down, a deliberate stance-width change may move each
      // foot symmetrically while the support center stays fixed (checked
      // above). A single carried support, however, must not jump when the
      // author switches between ground-lock and pin semantics.
      if (bothSupported || !footIsSupported(previous, side) || !footIsSupported(current, side)) continue;
      const previousKind = footSupportKind(previous, side);
      const currentKind = footSupportKind(current, side);
      // Releasing a world pin into a ground-locked landing deliberately lets
      // the foot travel to its new planted position during this phase (step
      // closes, marches, and dance phrases). Endpoint displacement is motion,
      // not a boundary snap, so it is covered by speed/contact checks instead.
      if (previousKind === "pin" && currentKind === "ground-lock") continue;
      // Ground-lock anchors travel/yaw with the figure, so compare in its
      // choreography-relative frame. A floor pin is a fixed WORLD anchor;
      // subtracting authored travel fabricates skate (forward lunge reported
      // 30 cm while the pinned foot was actually motionless). Handoffs to or
      // from a pin are continuity checks in world space too.
      const skate = previousKind === "ground-lock" && currentKind === "ground-lock"
        ? footSkateDistance(previous, current, side)
        : footWorldSkateDistance(previous, current, side);
      out.push({
        id: `foot-skate:${current.name}:${side}`,
        pass: skate < 0.03,
        detail: `${skate.toFixed(3)}m single-support drift (want < 0.03m)`,
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
        detail: `moving linear phase enters at ${speed.toFixed(2)}m/s (use a flow/settle/drive mode)`,
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
    movement: "glute-bridge",
    checks: [
      phaseCheck(
        "bridge-pelvis-raised",
        "Bridge up",
        (p) => heightOf(p, "pelvis"),
        (v) => v > 0.5,
        "pelvis > 0.50m",
      ),
      phaseCheck(
        "lower-pelvis-on-floor",
        "Lower",
        (p) => heightOf(p, "pelvis"),
        (v) => v < 0.16,
        "pelvis < 0.16m",
      ),
      (result) => {
        const up = phase(result, "Bridge up");
        const down = phase(result, "Lower");
        if (!up || !down) return { id: "bridge-has-real-height-change", pass: false, detail: "bridge phase missing" };
        const delta = heightOf(up, "pelvis") - heightOf(down, "pelvis");
        return {
          id: "bridge-has-real-height-change",
          pass: delta > 0.4,
          detail: `${delta.toFixed(3)}m pelvis height change (want > 0.40m)`,
        };
      },
    ],
  },
  {
    // Three-point landing: the front sole, rear knee, and opposite fist must
    // form distinct supports while the torso stays above the floor. Contact
    // residuals alone once allowed a folded body with a vertical planted foot.
    movement: "superhero-landing",
    checks: [
      phaseCheck(
        "torso-forward-not-collapsed",
        "Hold the landing",
        torsoForwardPitchDeg,
        (v) => v >= 65 && v <= 100,
        "65–100° character-forward pitch",
      ),
      (result) => {
        const p = phase(result, "Hold the landing");
        if (!p) return { id: "exact-three-supports", pass: false, detail: "phase \"Hold the landing\" not found" };
        const actual = floorSupportEffectors(p);
        const expected = ["foot_right", "knee_left", "fist_left"];
        const pass = actual.size === expected.length && expected.every((item) => actual.has(item));
        return {
          id: "exact-three-supports",
          pass,
          detail: `floor supports: ${[...actual].sort().join(", ") || "none"} (want ${expected.join(", ")})`,
        };
      },
      (result) => {
        const phases = [
          phase(result, "Drop into the landing"),
          phase(result, "Make three-point contact"),
          phase(result, "Hold the landing"),
        ];
        if (phases.some((item) => !item)) {
          return { id: "three-supports-stay-planted", pass: false, detail: "landing phase missing" };
        }
        let maxDrift = 0;
        for (let i = 1; i < phases.length; i++) {
          const a = phases[i - 1]!;
          const b = phases[i]!;
          for (const boneId of ["ankle_right", "knee_left", "wrist_left"]) {
            const pa = a.bones.get(boneId)!;
            const pb = b.bones.get(boneId)!;
            maxDrift = Math.max(maxDrift, Math.hypot(pb[0] - pa[0], pb[2] - pa[2]));
          }
        }
        return {
          id: "three-supports-stay-planted",
          pass: maxDrift < 0.03,
          detail: `${maxDrift.toFixed(3)}m maximum support drift (want < 0.03m)`,
        };
      },
      phaseCheck(
        "front-sole-planted",
        "Hold the landing",
        (p) => soleUpAngleDeg(p, "right"),
        (v) => v < 25,
        "< 25° from flat",
      ),
      phaseCheck(
        "rear-knee-down",
        "Hold the landing",
        (p) => heightOf(p, "knee_left"),
        (v) => v < 0.12,
        "left knee < 0.12m",
      ),
      phaseCheck(
        "fist-down",
        "Hold the landing",
        (p) => heightOf(p, "wrist_left"),
        (v) => v < 0.13,
        "left fist < 0.13m",
      ),
      phaseCheck(
        "head-clear-of-floor",
        "Hold the landing",
        (p) => heightOf(p, "head"),
        (v) => v > 0.4,
        "head > 0.40m",
      ),
      phaseCheck(
        "front-knee-up",
        "Hold the landing",
        (p) => heightOf(p, "knee_right"),
        (v) => v > 0.3,
        "right knee > 0.30m",
      ),
      phaseCheck(
        "supports-separated",
        "Hold the landing",
        (p) => Math.min(
          distanceBetween(p, "ankle_right", "knee_left"),
          distanceBetween(p, "ankle_right", "wrist_left"),
          distanceBetween(p, "knee_left", "wrist_left"),
        ),
        (v) => v > 0.2,
        "every support pair > 0.20m apart",
      ),
      phaseCheck(
        "supports-front-to-back",
        "Hold the landing",
        (p) => Math.min(
          forwardCoordinate(p, "ankle_right") - forwardCoordinate(p, "knee_left"),
          forwardCoordinate(p, "wrist_left") - forwardCoordinate(p, "knee_left"),
        ),
        (v) => v > 0.12,
        "front foot and fist > 0.12m ahead of rear knee",
      ),
      phaseCheck(
        "free-arm-raised",
        "Hold the landing",
        (p) => heightOf(p, "wrist_right") - heightOf(p, "pelvis"),
        (v) => v > 0.12,
        "right wrist > 0.12m above pelvis",
      ),
    ],
  },
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
