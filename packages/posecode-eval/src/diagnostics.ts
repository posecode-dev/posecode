/** Clip-wide aggregation of renderer constraint diagnostics. */
import {
  measureFootContact,
  measureSelfCollisions,
  floorContactHeight,
  FOOT_CONTACT_HEIGHT_MAX,
  PLANTIGRADE_SOLE_ANGLE_MAX,
  SELF_COLLISION_DEPTH_MAX,
  isGroundLockFootPlanted,
  type Mannequin,
  type SelfCollisionKind,
} from "posecode-render";
import type { PinTarget } from "posecode-parser";
import type { Vec3 } from "./probe.js";

export const DEFAULT_DIAGNOSTIC_SAMPLE_RATE_HZ = 12;
/** Warning threshold for one continuously supported foot's horizontal drift. */
export const PLANTED_FOOT_DRIFT_MAX = 0.03;
/** Small proxy/solver allowance while a raised heel pivots on its toe edge. */
export const TIPTOE_FOOT_DRIFT_MAX = 0.04;

export interface DiagnosticLocation {
  timeSec: number;
  phaseName: string;
}

export interface FootClipDiagnostics {
  side: "left" | "right";
  supportedSamples: number;
  plantigradeSamples: number;
  minHeelHeightMeters: number | null;
  maxHeelHeightMeters: number | null;
  minToeHeightMeters: number | null;
  maxToeHeightMeters: number | null;
  maxSoleAngleDeg: number | null;
  /** Maximum X/Z movement from the start of one continuous support interval. */
  maxDriftMeters: number;
  maxPlantigradeDriftMeters: number;
  maxTiptoeDriftMeters: number;
  worstHeel: DiagnosticLocation | null;
  /** Whether the worst heel lift coincided with the configured dorsiflexion bound. */
  worstHeelAtDorsiflexionLimit: boolean;
  /** Local ankle +X angle at the worst heel sample (negative is dorsiflexion). */
  worstHeelAnkleXDeg: number | null;
  worstToe: DiagnosticLocation | null;
  worstSoleAngle: DiagnosticLocation | null;
  worstDrift: DiagnosticLocation | null;
  worstPlantigradeDrift: DiagnosticLocation | null;
  worstTiptoeDrift: DiagnosticLocation | null;
}

export interface SelfCollisionClipDiagnostics extends DiagnosticLocation {
  id: string;
  kind: SelfCollisionKind;
  side: "left" | "right";
  maxDepthMeters: number;
}

export type ClipDiagnosticWarningKind =
  | "heel-height"
  | "toe-height"
  | "sole-angle"
  | "foot-drift"
  | "grounding-rom-conflict"
  | "self-collision";

/** Strict, named constraint breach surfaced without changing the CI gate. */
export interface ClipDiagnosticWarning extends DiagnosticLocation {
  id: string;
  kind: ClipDiagnosticWarningKind;
  value: number;
  limit: number;
  unit: "m" | "deg";
  detail: string;
}

/** Diagnostics aggregated from regularly sampled, fully solved clip frames. */
export interface ClipDiagnostics {
  sampleRateHz: number;
  sampleCount: number;
  feet: Readonly<Record<"left" | "right", FootClipDiagnostics>>;
  selfCollisions: readonly SelfCollisionClipDiagnostics[];
  /** Known constraint breaches; intentionally non-gating until solver fixes land. */
  warnings: readonly ClipDiagnosticWarning[];
}

export interface DiagnosticFrame {
  timeSec: number;
  phaseName: string;
  groundLock: readonly string[];
  pins: readonly PinTarget[];
  rootOffset: Vec3;
  rootYaw: number;
  propPush: Vec3;
}

interface MutableFoot extends FootClipDiagnostics {
  supportKind: "ground-lock" | "pin" | null;
  supportAnchorMode: "sole" | "toe" | null;
  supportAnchor: readonly [x: number, z: number] | null;
  worstHeelAbs: number;
  worstToeAbs: number;
}

const footState = (side: "left" | "right"): MutableFoot => ({
  side,
  supportedSamples: 0,
  plantigradeSamples: 0,
  minHeelHeightMeters: null,
  maxHeelHeightMeters: null,
  minToeHeightMeters: null,
  maxToeHeightMeters: null,
  maxSoleAngleDeg: null,
  maxDriftMeters: 0,
  maxPlantigradeDriftMeters: 0,
  maxTiptoeDriftMeters: 0,
  worstHeel: null,
  worstHeelAtDorsiflexionLimit: false,
  worstHeelAnkleXDeg: null,
  worstToe: null,
  worstSoleAngle: null,
  worstDrift: null,
  worstPlantigradeDrift: null,
  worstTiptoeDrift: null,
  supportKind: null,
  supportAnchorMode: null,
  supportAnchor: null,
  worstHeelAbs: -Infinity,
  worstToeAbs: -Infinity,
});

function supportKind(
  frame: DiagnosticFrame,
  side: "left" | "right",
): "ground-lock" | "pin" | null {
  if (frame.pins.some((pin) =>
    pin.anchor === "floor" && (pin.effector === "feet" || pin.effector === `foot_${side}`))) {
    return "pin";
  }
  return frame.groundLock.includes("feet") || frame.groundLock.includes(`foot_${side}`)
    ? "ground-lock"
    : null;
}

function choreographyRelative(
  point: readonly [number, number, number],
  frame: DiagnosticFrame,
): readonly [number, number] {
  const x = point[0] - frame.rootOffset[0] - frame.propPush[0];
  const z = point[2] - frame.rootOffset[2] - frame.propPush[2];
  const c = Math.cos(-frame.rootYaw);
  const s = Math.sin(-frame.rootYaw);
  return [x * c - z * s, x * s + z * c];
}

export interface ClipDiagnosticsCollector {
  record(m: Mannequin, frame: DiagnosticFrame): void;
  finish(): ClipDiagnostics;
}

export function createClipDiagnosticsCollector(sampleRateHz: number): ClipDiagnosticsCollector {
  const rate = Math.max(
    1,
    Math.min(120, Number.isFinite(sampleRateHz) ? sampleRateHz : DEFAULT_DIAGNOSTIC_SAMPLE_RATE_HZ),
  );
  let sampleCount = 0;
  const feet = { left: footState("left"), right: footState("right") };
  const collisions = new Map<string, SelfCollisionClipDiagnostics>();

  const record = (m: Mannequin, frame: DiagnosticFrame): void => {
    sampleCount++;
    for (const side of ["left", "right"] as const) {
      const state = feet[side];
      const foot = measureFootContact(m, side);
      let kind = supportKind(frame, side);
      // The generic `feet` group also contains a deliberately lifted swing
      // foot. Match ground-lock's own near-floor selection so that swing height
      // is not mislabeled as a failed planted contact; an explicit foot lock or
      // floor pin is always evaluated.
      if (
        kind === "ground-lock"
        && frame.groundLock.includes("feet")
        && !frame.groundLock.includes(`foot_${side}`)
        && foot
        && !isGroundLockFootPlanted(floorContactHeight(m, `foot_${side}`) ?? NaN)
      ) kind = null;
      if (!kind || !foot) {
        state.supportKind = null;
        state.supportAnchorMode = null;
        state.supportAnchor = null;
        continue;
      }
      state.supportedSamples++;
      const location = { timeSec: frame.timeSec, phaseName: frame.phaseName };
      state.minToeHeightMeters = Math.min(state.minToeHeightMeters ?? Infinity, foot.toeHeight);
      state.maxToeHeightMeters = Math.max(state.maxToeHeightMeters ?? -Infinity, foot.toeHeight);
      if (Math.abs(foot.toeHeight) > state.worstToeAbs) {
        state.worstToeAbs = Math.abs(foot.toeHeight);
        state.worstToe = location;
      }
      if (foot.plantigrade) {
        state.plantigradeSamples++;
        state.minHeelHeightMeters = Math.min(state.minHeelHeightMeters ?? Infinity, foot.heelHeight);
        state.maxHeelHeightMeters = Math.max(state.maxHeelHeightMeters ?? -Infinity, foot.heelHeight);
        state.maxSoleAngleDeg = Math.max(state.maxSoleAngleDeg ?? -Infinity, foot.soleAngleDeg);
        if (Math.abs(foot.heelHeight) > state.worstHeelAbs) {
          state.worstHeelAbs = Math.abs(foot.heelHeight);
          state.worstHeel = location;
          state.worstHeelAtDorsiflexionLimit = foot.atDorsiflexionLimit;
          state.worstHeelAnkleXDeg = foot.plantarflexDeg;
        }
        if (foot.soleAngleDeg >= (state.maxSoleAngleDeg ?? -Infinity)) state.worstSoleAngle = location;
      }

      // A plantigrade foot is supported by its full sole, while a deliberate
      // rise pivots about the toe/ball edge. Measuring the sole centre during
      // plantarflexion fabricates drift from normal foot rotation.
      const anchorMode = foot.plantigrade ? "sole" : "toe";
      const contactPoint = anchorMode === "sole" ? foot.center : foot.toeCenter;
      const position = kind === "pin"
        ? [contactPoint[0], contactPoint[2]] as const
        : choreographyRelative(contactPoint, frame);
      if (
        state.supportKind !== kind
        || state.supportAnchorMode !== anchorMode
        || !state.supportAnchor
      ) {
        state.supportKind = kind;
        state.supportAnchorMode = anchorMode;
        state.supportAnchor = position;
      } else {
        const drift = Math.hypot(
          position[0] - state.supportAnchor[0],
          position[1] - state.supportAnchor[1],
        );
        if (drift > state.maxDriftMeters) {
          state.maxDriftMeters = drift;
          state.worstDrift = location;
        }
        if (anchorMode === "sole" && drift > state.maxPlantigradeDriftMeters) {
          state.maxPlantigradeDriftMeters = drift;
          state.worstPlantigradeDrift = location;
        }
        if (anchorMode === "toe" && drift > state.maxTiptoeDriftMeters) {
          state.maxTiptoeDriftMeters = drift;
          state.worstTiptoeDrift = location;
        }
      }
    }

    for (const residual of measureSelfCollisions(m)) {
      const previous = collisions.get(residual.id);
      if (!previous || residual.depth > previous.maxDepthMeters) {
        collisions.set(residual.id, {
          id: residual.id,
          kind: residual.kind,
          side: residual.side,
          maxDepthMeters: residual.depth,
          timeSec: frame.timeSec,
          phaseName: frame.phaseName,
        });
      }
    }
  };

  const finish = (): ClipDiagnostics => {
    const publicFoot = (state: MutableFoot): FootClipDiagnostics => ({
      side: state.side,
      supportedSamples: state.supportedSamples,
      plantigradeSamples: state.plantigradeSamples,
      minHeelHeightMeters: state.minHeelHeightMeters,
      maxHeelHeightMeters: state.maxHeelHeightMeters,
      minToeHeightMeters: state.minToeHeightMeters,
      maxToeHeightMeters: state.maxToeHeightMeters,
      maxSoleAngleDeg: state.maxSoleAngleDeg,
      maxDriftMeters: state.maxDriftMeters,
      maxPlantigradeDriftMeters: state.maxPlantigradeDriftMeters,
      maxTiptoeDriftMeters: state.maxTiptoeDriftMeters,
      worstHeel: state.worstHeel,
      worstHeelAtDorsiflexionLimit: state.worstHeelAtDorsiflexionLimit,
      worstHeelAnkleXDeg: state.worstHeelAnkleXDeg,
      worstToe: state.worstToe,
      worstSoleAngle: state.worstSoleAngle,
      worstDrift: state.worstDrift,
      worstPlantigradeDrift: state.worstPlantigradeDrift,
      worstTiptoeDrift: state.worstTiptoeDrift,
    });
    const publicFeet = { left: publicFoot(feet.left), right: publicFoot(feet.right) };
    const publicCollisions = [...collisions.values()];
    const warnings: ClipDiagnosticWarning[] = [];
    const pushFootWarning = (
      side: "left" | "right",
      kind: Exclude<ClipDiagnosticWarningKind, "self-collision">,
      value: number,
      limit: number,
      unit: "m" | "deg",
      location: DiagnosticLocation | null,
      label: string,
    ): void => {
      if (value <= limit || !location) return;
      warnings.push({
        id: `clip-${kind}:foot_${side}`,
        kind,
        value,
        limit,
        unit,
        timeSec: location.timeSec,
        phaseName: location.phaseName,
        detail: `${label} ${value.toFixed(unit === "m" ? 3 : 1)}${unit} at ${location.phaseName} ${location.timeSec.toFixed(2)}s (want ≤ ${limit.toFixed(unit === "m" ? 3 : 1)}${unit})`,
      });
    };
    for (const side of ["left", "right"] as const) {
      const foot = publicFeet[side];
      const heel = Math.max(
        Math.abs(foot.minHeelHeightMeters ?? 0),
        Math.abs(foot.maxHeelHeightMeters ?? 0),
      );
      const toe = Math.max(
        Math.abs(foot.minToeHeightMeters ?? 0),
        Math.abs(foot.maxToeHeightMeters ?? 0),
      );
      pushFootWarning(side, "heel-height", heel, FOOT_CONTACT_HEIGHT_MAX, "m", foot.worstHeel, `foot_${side} heel floor offset`);
      if (
        heel > FOOT_CONTACT_HEIGHT_MAX
        && foot.worstHeelAtDorsiflexionLimit
        && foot.worstHeel
      ) {
        warnings.push({
          id: `clip-grounding-rom-conflict:foot_${side}`,
          kind: "grounding-rom-conflict",
          value: heel,
          limit: FOOT_CONTACT_HEIGHT_MAX,
          unit: "m",
          timeSec: foot.worstHeel.timeSec,
          phaseName: foot.worstHeel.phaseName,
          detail: `foot_${side} heel is ${heel.toFixed(3)}m off floor while ankle is at ${foot.worstHeelAnkleXDeg?.toFixed(1)}° (configured dorsiflexion limit)`,
        });
      }
      pushFootWarning(side, "toe-height", toe, FOOT_CONTACT_HEIGHT_MAX, "m", foot.worstToe, `foot_${side} toe floor offset`);
      pushFootWarning(side, "sole-angle", foot.maxSoleAngleDeg ?? 0, PLANTIGRADE_SOLE_ANGLE_MAX, "deg", foot.worstSoleAngle, `foot_${side} sole tilt`);
      const plantigradeRatio = foot.maxPlantigradeDriftMeters / PLANTED_FOOT_DRIFT_MAX;
      const tiptoeRatio = foot.maxTiptoeDriftMeters / TIPTOE_FOOT_DRIFT_MAX;
      if (plantigradeRatio >= tiptoeRatio) {
        pushFootWarning(side, "foot-drift", foot.maxPlantigradeDriftMeters, PLANTED_FOOT_DRIFT_MAX, "m", foot.worstPlantigradeDrift, `foot_${side} planted drift`);
      } else {
        pushFootWarning(side, "foot-drift", foot.maxTiptoeDriftMeters, TIPTOE_FOOT_DRIFT_MAX, "m", foot.worstTiptoeDrift, `foot_${side} toe-anchor drift`);
      }
    }
    for (const collision of publicCollisions) {
      if (collision.maxDepthMeters <= SELF_COLLISION_DEPTH_MAX) continue;
      warnings.push({
        id: collision.id,
        kind: "self-collision",
        value: collision.maxDepthMeters,
        limit: SELF_COLLISION_DEPTH_MAX,
        unit: "m",
        timeSec: collision.timeSec,
        phaseName: collision.phaseName,
        detail: `${collision.id} residual ${collision.maxDepthMeters.toFixed(3)}m at ${collision.phaseName} ${collision.timeSec.toFixed(2)}s (want ≤ ${SELF_COLLISION_DEPTH_MAX.toFixed(3)}m)`,
      });
    }
    return {
      sampleRateHz: rate,
      sampleCount,
      feet: publicFeet,
      selfCollisions: publicCollisions,
      warnings,
    };
  };
  return { record, finish };
}
