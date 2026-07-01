/**
 * Resolve an AST into the renderer-ready IR, applying ROM hard-clamping.
 *
 * This is the biomechanics-aware stage: it expands symmetric joint groups,
 * maps semantic actions to rotation axes (with left/right mirroring), and
 * clamps every angle into its safe Range of Motion (§5.1). All inputs are
 * treated as immutable — a fresh IR is built and returned.
 */

import type {
  EulerDeg,
  JointTarget,
  MovitIR,
  ParseError,
  Phase,
  Warning,
} from "./types.js";
import { MOVIT_VERSION } from "./types.js";
import type { AstDoc, AstStep } from "./parser.js";
import { actionAxis, boneType, expandJoint, flexionSign, isLeft } from "./joints.js";
import { clampAngle, romFor } from "./rom.js";

export interface ResolveResult {
  ir: MovitIR;
  warnings: Warning[];
  errors: ParseError[];
}

const ZERO: EulerDeg = { x: 0, y: 0, z: 0 };

export function resolve(ast: AstDoc): ResolveResult {
  const warnings: Warning[] = [];
  const errors: ParseError[] = [];

  const phases: Phase[] = ast.steps.map((step) =>
    resolveStep(step, warnings, errors),
  );

  const ir: MovitIR = {
    version: MOVIT_VERSION,
    kind: ast.kind,
    name: ast.name,
    rig: ast.rig,
    ...(ast.startPose ? { startPose: ast.startPose } : {}),
    props: ast.props,
    repeat: ast.repeat,
    phases,
  };

  return { ir, warnings, errors };
}

function resolveStep(
  step: AstStep,
  warnings: Warning[],
  errors: ParseError[],
): Phase {
  // Accumulate per-bone Euler so multiple action lines on the same joint merge.
  const byBone = new Map<string, EulerDeg>();

  for (const target of step.targets) {
    const bones = expandJoint(target.joint);
    if (bones.length === 0) {
      errors.push({ line: target.line, message: `unknown joint: "${target.joint}"` });
      continue;
    }

    // `hold <pose>` keeps the joint at neutral.
    if (target.action === "hold") {
      for (const bone of bones) ensure(byBone, bone);
      continue;
    }

    const aa = actionAxis(target.action);
    if (!aa) {
      errors.push({ line: target.line, message: `unknown action: "${target.action}"` });
      continue;
    }
    if (target.degrees === null) {
      errors.push({
        line: target.line,
        message: `action "${target.action}" requires an angle`,
      });
      continue;
    }

    for (const bone of bones) {
      const clamped = clampAngle(bone, target.action, target.degrees);
      if (clamped !== target.degrees) {
        const limit = romFor(bone, target.action)!;
        warnings.push({
          line: target.line,
          phase: step.name,
          joint: bone,
          action: target.action,
          requested: target.degrees,
          clamped,
          limit,
        });
      }
      const flexFlip =
        target.action === "flex" || target.action === "extend"
          ? flexionSign(boneType(bone))
          : 1;
      const mirror = isLeft(bone) && aa.axis !== "x" ? -1 : 1;
      const sign = aa.sign * flexFlip * mirror;
      const euler = ensure(byBone, bone);
      euler[aa.axis] = sign * clamped;
    }
  }

  const targets: JointTarget[] = [...byBone.entries()].map(([boneId, euler]) => ({
    boneId,
    euler,
  }));

  // Travel is clamped to a sane studio footprint (±TRAVEL_MAX m) so a stray
  // large value can't fling the figure off the ground plane / out of frame.
  const travel = step.travel
    ? {
        x: clampNum(step.travel.x, -TRAVEL_MAX, TRAVEL_MAX),
        z: clampNum(step.travel.z, -TRAVEL_MAX, TRAVEL_MAX),
      }
    : undefined;

  return {
    name: step.name,
    durationSec: step.durationSec,
    easing: step.easing as Phase["easing"],
    targets,
    groundLock: step.groundLock,
    reaches: step.reaches,
    pins: step.pins,
    ...(step.turn !== undefined ? { turnDeg: step.turn } : {}),
    ...(travel ? { travel } : {}),
    ...(step.cue ? { cue: step.cue } : {}),
  };
}

/** Max travel offset from the load spot, metres, in any single axis. */
const TRAVEL_MAX = 3;

function clampNum(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function ensure(map: Map<string, EulerDeg>, bone: string): EulerDeg {
  let euler = map.get(bone);
  if (!euler) {
    euler = { ...ZERO };
    map.set(bone, euler);
  }
  return euler;
}
