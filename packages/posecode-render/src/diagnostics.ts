/** Non-mutating renderer constraint diagnostics shared by live UI and eval. */
import type { Mannequin } from "./mannequin.js";
import { floorContactHeight, measureFootContact, type BodySide } from "./contacts.js";
import { measureSelfCollisions } from "./depenetrate.js";
import { isGroundLockFootPlanted } from "./groundlock.js";

/** Maximum absolute heel/toe surface offset accepted as floor contact. */
export const FOOT_CONTACT_HEIGHT_MAX = 0.02;
/** Maximum sole tilt accepted for an explicitly plantigrade ground-lock. */
export const PLANTIGRADE_SOLE_ANGLE_MAX = 12;
/** Sampled capsule overlap tolerated as solver/numeric margin. */
export const SELF_COLLISION_DEPTH_MAX = 0.01;

export type ConstraintDiagnosticKind =
  | "heel-height"
  | "toe-height"
  | "sole-angle"
  | "grounding-rom-conflict"
  | "self-collision";

/** One named outcome measured on the post-solver procedural-driver frame. */
export interface ConstraintDiagnostic {
  id: string;
  kind: ConstraintDiagnosticKind;
  pass: boolean;
  value: number;
  limit: number;
  unit: "m" | "deg";
  detail: string;
}

export interface DiagnosticPin {
  effector: string;
  anchor: string;
}

function groundedFootSides(
  activeGroundLock: readonly string[],
  activePins: readonly DiagnosticPin[],
): BodySide[] {
  return (["left", "right"] as const).filter((side) =>
    activeGroundLock.includes("feet")
    || activeGroundLock.includes(`foot_${side}`)
    || activePins.some((pin) =>
      pin.anchor === "floor"
      && (pin.effector === "feet" || pin.effector === `foot_${side}`)),
  );
}

/**
 * Measure constraints after the procedural driver's frame solvers have run.
 * This precedes optional skinned-character and mocap surface reconciliation.
 * Intentional tiptoe poses require toe contact without demanding a flat sole.
 */
export function measureConstraintDiagnostics(
  m: Mannequin,
  activeGroundLock: readonly string[],
  activePins: readonly DiagnosticPin[] = [],
): ConstraintDiagnostic[] {
  const out: ConstraintDiagnostic[] = [];
  for (const side of groundedFootSides(activeGroundLock, activePins)) {
    const foot = measureFootContact(m, side);
    if (!foot) continue;
    const explicitlyPinned = activePins.some((pin) =>
      pin.anchor === "floor"
      && (pin.effector === "feet" || pin.effector === `foot_${side}`));
    if (
      !explicitlyPinned
      && activeGroundLock.includes("feet")
      && !activeGroundLock.includes(`foot_${side}`)
      && !isGroundLockFootPlanted(floorContactHeight(m, `foot_${side}`) ?? NaN)
    ) continue;
    const height = (edge: "heel" | "toe", value: number): ConstraintDiagnostic => ({
      id: `grounding:foot_${side}:${edge}-height`,
      kind: `${edge}-height`,
      pass: Math.abs(value) <= FOOT_CONTACT_HEIGHT_MAX,
      value,
      limit: FOOT_CONTACT_HEIGHT_MAX,
      unit: "m",
      detail: `foot_${side} ${edge} ${value.toFixed(3)}m from floor (want ±${FOOT_CONTACT_HEIGHT_MAX.toFixed(3)}m)`,
    });
    // Every grounded foot needs a toe/ball contact. A plantigrade declaration
    // additionally promises that the heel and full sole remain down.
    out.push(height("toe", foot.toeHeight));
    if (foot.plantigrade) {
      const heel = height("heel", foot.heelHeight);
      out.push(heel);
      if (!heel.pass && foot.atDorsiflexionLimit) {
        out.push({
          id: `grounding-rom-conflict:foot_${side}`,
          kind: "grounding-rom-conflict",
          pass: false,
          value: Math.abs(foot.heelHeight),
          limit: FOOT_CONTACT_HEIGHT_MAX,
          unit: "m",
          detail: `foot_${side} heel is ${Math.abs(foot.heelHeight).toFixed(3)}m off floor while ankle is at its dorsiflexion ROM limit`,
        });
      }
      out.push({
        id: `grounding:foot_${side}:sole-angle`,
        kind: "sole-angle",
        pass: foot.soleAngleDeg <= PLANTIGRADE_SOLE_ANGLE_MAX,
        value: foot.soleAngleDeg,
        limit: PLANTIGRADE_SOLE_ANGLE_MAX,
        unit: "deg",
        detail: `foot_${side} sole ${foot.soleAngleDeg.toFixed(1)}° from flat (want ≤ ${PLANTIGRADE_SOLE_ANGLE_MAX}°)`,
      });
    }
  }

  for (const collision of measureSelfCollisions(m)) {
    out.push({
      id: collision.id,
      kind: "self-collision",
      pass: collision.depth <= SELF_COLLISION_DEPTH_MAX,
      value: collision.depth,
      limit: SELF_COLLISION_DEPTH_MAX,
      unit: "m",
      detail: `${collision.id} residual ${collision.depth.toFixed(3)}m (want ≤ ${SELF_COLLISION_DEPTH_MAX.toFixed(3)}m)`,
    });
  }
  return out;
}
