/**
 * Resolve an AST into the renderer-ready IR, applying ROM hard-clamping.
 *
 * This is the biomechanics-aware stage: it expands symmetric joint groups,
 * maps semantic actions to rotation axes (with left/right mirroring), and
 * clamps every angle into the configured rig bounds (§5.1). All inputs are
 * treated as immutable: a fresh IR is built and returned.
 */

import type {
  Axis,
  EulerDeg,
  GripTarget,
  JointTarget,
  PosecodeIR,
  ParseError,
  Phase,
  PinTarget,
  ReachTarget,
  Warning,
} from "./types.js";
import { POSECODE_VERSION } from "./types.js";
import type { AstDoc, AstJointTarget, AstStep } from "./parser.js";
import {
  BONES,
  actionAxis,
  boneType,
  expandEffector,
  expandJoint,
  flexionSign,
  isGroundLockEffector,
  isLeft,
} from "./joints.js";
import { actionsForJoint, clampAngle, romFor } from "./rom.js";
import { anchorsForProps, propForAnchor } from "./protocol.js";

export interface ResolveResult {
  ir: PosecodeIR;
  warnings: Warning[];
  errors: ParseError[];
}

const ZERO: EulerDeg = { x: 0, y: 0, z: 0 };
const AXES: Axis[] = ["x", "y", "z"];
const BODY_TARGETS = new Set<string>(BONES);

interface AuthoredEuler {
  euler: EulerDeg;
  axes: Set<Axis>;
}

export function resolve(ast: AstDoc): ResolveResult {
  const warnings: Warning[] = [];
  const errors: ParseError[] = [];
  const declaredAnchors = anchorsForProps(ast.props);
  const semanticState = initialSemanticState(ast.startPose);
  const phases: Phase[] = [];

  // Resolve in document order so cross-joint mechanics can be checked against
  // the pose carried from preceding phases. This matters for a hinge authored
  // after a deep hip flexion (and vice versa), not only when both share a step.
  for (const step of ast.steps) {
    const phase = resolveStep(step, declaredAnchors, warnings, errors);
    enforceHipHingeLimit(step, phase, semanticState, warnings);
    applyPhaseToState(semanticState, phase);
    phases.push(phase);
  }

  const ir: PosecodeIR = {
    version: POSECODE_VERSION,
    kind: ast.kind,
    name: ast.name,
    rig: ast.rig,
    ...(ast.startPose ? { startPose: ast.startPose } : {}),
    props: ast.props,
    ...(ast.clip ? { clip: ast.clip } : {}),
    repeat: ast.repeat,
    phases,
  };

  return { ir, warnings, errors };
}

function resolveStep(
  step: AstStep,
  declaredAnchors: ReadonlySet<string>,
  warnings: Warning[],
  errors: ParseError[],
): Phase {
  // `ground-lock`, `pin`, and `grip` each solve the floating root. Combining
  // those solver families in one phase makes the later pass invalidate the
  // earlier contact (for example, a knee pin sliding a ground-locked foot).
  // Express multi-point support with one root anchor plus per-limb `reach`s.
  if (step.groundLock.length > 0 && step.pins.length > 0) {
    errors.push({
      line: step.pins[0]!.line,
      message: "`pin` cannot be combined with `ground-lock` in one step; use one primary pin plus `reach` for additional contacts",
    });
  }
  if (step.groundLock.length > 0 && step.grips.length > 0) {
    errors.push({
      line: step.grips[0]!.line,
      message: "`grip` cannot be combined with `ground-lock` in one step; use one root-support family per step",
    });
  }
  if (step.pins.length > 0 && step.grips.length > 0) {
    errors.push({
      line: step.grips[0]!.line,
      message: "`grip` cannot be combined with `pin` in one step; use the grip as the primary support plus `reach` for additional contacts",
    });
  }
  if (step.pins.length > 1) {
    errors.push({
      line: step.pins[1]!.line,
      message: "a step may declare only one primary `pin`; use a grouped effector or per-limb `reach` constraints for additional contacts",
    });
  }

  // Accumulate per-bone Euler so multiple action lines on the same joint merge.
  const byBone = new Map<string, AuthoredEuler>();

  for (const target of step.targets) {
    const bones = expandJoint(target.joint);
    if (bones.length === 0) {
      errors.push({ line: target.line, message: `unknown joint: "${target.joint}"` });
      continue;
    }

    // `hold <pose>` keeps the joint at neutral.
    if (target.action === "hold") {
      for (const bone of bones) {
        const authored = ensure(byBone, bone);
        authored.euler = { ...ZERO };
        for (const axis of AXES) authored.axes.add(axis);
      }
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

    const unsupported = bones.filter((bone) => romFor(bone, target.action) === null);
    if (unsupported.length > 0) {
      const allowed = actionsForJoint(target.joint);
      errors.push({
        line: target.line,
        message:
          `action "${target.action}" is not supported for ${target.joint}; ` +
          `expected one of ${[...allowed, "hold"].join(", ")}`,
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
      const authored = ensure(byBone, bone);
      authored.euler[aa.axis] = sign * clamped;
      authored.axes.add(aa.axis);
    }
  }

  const targets: JointTarget[] = [...byBone.entries()].map(([boneId, authored]) => ({
    boneId,
    euler: authored.euler,
    axes: AXES.filter((axis) => authored.axes.has(axis)),
  }));

  const groundLock: string[] = [];
  for (const effector of step.groundLock) {
    if (!isGroundLockEffector(effector)) {
      errors.push({
        line: step.groundLockLine ?? step.line,
        message: `unknown ground-lock effector: "${effector}"`,
      });
      continue;
    }
    groundLock.push(effector);
  }

  // Reach / pin effectors: expand symmetric groups (`hands` → both hands) and
  // reject unknown names, since a typo'd effector would otherwise be silently
  // ignored by the renderer, invisible to the authoring LLM.
  const reaches: ReachTarget[] = [];
  for (const r of step.reaches) {
    const sides = expandEffector(r.effector);
    if (sides.length === 0) {
      errors.push({ line: r.line, message: `unknown reach effector: "${r.effector}"` });
      continue;
    }
    if (sides.includes("pelvis")) {
      errors.push({
        line: r.line,
        message: 'reach effector "pelvis" is unsupported; use `pin: pelvis <anchor>`',
      });
      continue;
    }
    if (!validateReachTarget(r.target, r.line, declaredAnchors, errors)) {
      continue;
    }
    if (sides.some((effector) => contactBoneId(effector) === r.target)) {
      errors.push({
        line: r.line,
        message: `reach effector "${r.effector}" cannot target its own joint "${r.target}"`,
      });
      continue;
    }
    for (const effector of sides) reaches.push({ effector, target: r.target });
  }
  const pins: PinTarget[] = [];
  for (const p of step.pins) {
    const sides = expandEffector(p.effector);
    if (sides.length === 0) {
      errors.push({ line: p.line, message: `unknown pin effector: "${p.effector}"` });
      continue;
    }
    if (!validatePinAnchor(p.anchor, p.line, declaredAnchors, errors)) {
      continue;
    }
    for (const effector of sides) pins.push({ effector, anchor: p.anchor });
  }

  // Grip contacts: like pins, but each hand gets its OWN two-point anchor. A
  // bare anchor (`bar`) is rewritten per side to `bar_left`/`bar_right` so the
  // two hands grip shoulder-width apart; an already-sided anchor is kept as-is.
  const grips: GripTarget[] = [];
  for (const g of step.grips) {
    const sides = expandEffector(g.effector);
    if (sides.length === 0) {
      errors.push({ line: g.line, message: `unknown grip effector: "${g.effector}"` });
      continue;
    }
    if (sides.some((effector) => !effector.startsWith("hand_"))) {
      errors.push({
        line: g.line,
        message: `grip effector "${g.effector}" must resolve to a hand`,
      });
      continue;
    }
    if (!validateGripAnchor(g.anchor, g.line, declaredAnchors, errors)) {
      continue;
    }
    const writtenSide = /_(left|right)$/.exec(g.anchor)?.[1];
    if (writtenSide && sides.length > 1) {
      errors.push({
        line: g.line,
        message: `grouped grip effector "${g.effector}" requires a bare anchor such as "${g.anchor.replace(/_(left|right)$/, "")}"`,
      });
      continue;
    }
    if (writtenSide && sides[0] && !sides[0].endsWith(`_${writtenSide}`)) {
      errors.push({
        line: g.line,
        message: `grip anchor "${g.anchor}" does not match effector "${sides[0]}"`,
      });
      continue;
    }
    for (const effector of sides) {
      grips.push({ effector, anchor: sideAnchor(g.anchor, effector) });
    }
  }

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
    groundLock,
    reaches,
    pins,
    grips,
    ...(step.turn !== undefined ? { turnDeg: step.turn } : {}),
    ...(travel ? { travel } : {}),
    ...(step.cue ? { cue: step.cue } : {}),
  };
}

/** Reach accepts the floor, body landmarks, and declared prop anchors. */
function validateReachTarget(
  value: string,
  line: number,
  declaredAnchors: ReadonlySet<string>,
  errors: ParseError[],
): boolean {
  if (value === "floor" || BODY_TARGETS.has(value) || declaredAnchors.has(value)) {
    return true;
  }
  const prop = propForAnchor(value);
  errors.push({
    line,
    message: prop
      ? `reach target "${value}" requires declared prop "${prop}"`
      : `unknown reach target: "${value}"`,
  });
  return false;
}

/** Pins are world/root anchors. A body landmark moves with the root and cannot anchor it. */
function validatePinAnchor(
  value: string,
  line: number,
  declaredAnchors: ReadonlySet<string>,
  errors: ParseError[],
): boolean {
  if (value === "floor" || declaredAnchors.has(value)) return true;
  if (BODY_TARGETS.has(value)) {
    errors.push({
      line,
      message: `pin anchor "${value}" is body-relative and moves with the root; use floor or a declared prop anchor`,
    });
    return false;
  }
  const prop = propForAnchor(value);
  errors.push({
    line,
    message: prop
      ? `pin anchor "${value}" requires declared prop "${prop}"`
      : `unknown pin anchor: "${value}"`,
  });
  return false;
}

/** Grips only have contact frames on the built-in overhead bar and dip rails. */
function validateGripAnchor(
  value: string,
  line: number,
  declaredAnchors: ReadonlySet<string>,
  errors: ParseError[],
): boolean {
  const prop = propForAnchor(value);
  if (prop !== "bar" && prop !== "dip-bars") {
    errors.push({
      line,
      message: `grip anchor "${value}" must be an overhead-bar or dip-rail anchor`,
    });
    return false;
  }
  if (!declaredAnchors.has(value)) {
    errors.push({ line, message: `grip anchor "${value}" requires declared prop "${prop}"` });
    return false;
  }
  return true;
}

function contactBoneId(effector: string): string {
  return effector
    .replace(/^hand_/, "wrist_")
    .replace(/^fist_/, "wrist_")
    .replace(/^foot_/, "ankle_");
}

/**
 * Keep the renderer's coupled local hip angle inside the flexion ceiling.
 * Runtime local hip X is `semantic hip X - pelvis hinge X`; independently-safe
 * authored values can therefore add to an impossible angle (110° + 50°).
 */
function enforceHipHingeLimit(
  step: AstStep,
  phase: Phase,
  previous: ReadonlyMap<string, EulerDeg>,
  warnings: Warning[],
): void {
  const candidate = cloneState(previous);
  applyPhaseToState(candidate, phase);

  let pelvisX = candidate.get("pelvis")?.x ?? 0;
  const hips = ["hip_left", "hip_right"] as const;
  const pelvisSource = sourceForAxis(step, "pelvis", "x");
  let pelvisWarning: Warning | null = null;
  const clampPelvisTo = (safeValue: number): void => {
    if (!pelvisSource || pelvisX <= safeValue) return;
    const requestedPelvisX = pelvisX;
    const clamped = Math.max(0, safeValue);
    setPhaseAxis(phase, "pelvis", "x", clamped);
    ensureState(candidate, "pelvis").x = clamped;
    pelvisX = clamped;
    if (pelvisWarning) {
      pelvisWarning.clamped = clamped;
      pelvisWarning.limit = { min: 0, max: clamped };
      return;
    }
    pelvisWarning = {
      line: pelvisSource.line,
      phase: step.name,
      joint: "pelvis",
      action: pelvisSource.action,
      requested: pelvisSource.degrees ?? requestedPelvisX,
      clamped,
      limit: { min: 0, max: clamped },
    };
    warnings.push(pelvisWarning);
  };

  // When a newly-authored hinge meets a hip carried from an earlier phase,
  // the hinge must yield first. Doing this before clamping same-step hips
  // avoids needless left/right asymmetry in mixed carried/authored poses.
  const carriedHipLimits = hips
    .filter((hip) => sourceForAxis(step, hip, "x") === null)
    .map((hip) => (candidate.get(hip)?.x ?? 0) + COMBINED_HIP_FLEX_MAX);
  if (carriedHipLimits.length > 0) {
    clampPelvisTo(Math.min(120, ...carriedHipLimits));
  }

  for (const hip of hips) {
    const hipX = candidate.get(hip)?.x ?? 0;
    if (hipX - pelvisX >= -COMBINED_HIP_FLEX_MAX) continue;

    const source = sourceForAxis(step, hip, "x");
    if (!source) continue;
    const safeHipX = pelvisX - COMBINED_HIP_FLEX_MAX;
    setPhaseAxis(phase, hip, "x", safeHipX);
    ensureState(candidate, hip).x = safeHipX;
    const maxDegrees = Math.max(0, COMBINED_HIP_FLEX_MAX - pelvisX);
    warnings.push({
      line: source.line,
      phase: step.name,
      joint: hip,
      action: source.action,
      requested: source.degrees ?? Math.abs(hipX),
      clamped: maxDegrees,
      limit: { min: 0, max: maxDegrees },
    });
  }

  // If the hips were carried from a previous phase, the newly-authored hinge
  // is the channel that must yield. Use the most restrictive side.
  const safePelvisX = Math.min(
    120,
    ...hips.map((hip) => (candidate.get(hip)?.x ?? 0) + COMBINED_HIP_FLEX_MAX),
  );
  clampPelvisTo(safePelvisX);
}

const COMBINED_HIP_FLEX_MAX = 135;

function sourceForAxis(
  step: AstStep,
  bone: string,
  axis: Axis,
): AstJointTarget | null {
  for (let i = step.targets.length - 1; i >= 0; i--) {
    const target = step.targets[i]!;
    if (!expandJoint(target.joint).includes(bone)) continue;
    if (target.action === "hold" || actionAxis(target.action)?.axis === axis) return target;
  }
  return null;
}

function setPhaseAxis(phase: Phase, bone: string, axis: Axis, value: number): void {
  const target = phase.targets.find((entry) => entry.boneId === bone);
  if (!target) return;
  target.euler[axis] = value;
  if (target.axes && !target.axes.includes(axis)) target.axes.push(axis);
}

function initialSemanticState(startPose: string | undefined): Map<string, EulerDeg> {
  const state = new Map<string, EulerDeg>();
  if (startPose === "seated") {
    state.set("hip_left", { x: -90, y: 0, z: 0 });
    state.set("hip_right", { x: -90, y: 0, z: 0 });
  }
  return state;
}

function applyPhaseToState(state: Map<string, EulerDeg>, phase: Phase): void {
  for (const target of phase.targets) {
    const current = ensureState(state, target.boneId);
    for (const axis of target.axes ?? AXES) current[axis] = target.euler[axis];
  }
}

function cloneState(state: ReadonlyMap<string, EulerDeg>): Map<string, EulerDeg> {
  return new Map([...state].map(([bone, euler]) => [bone, { ...euler }]));
}

function ensureState(map: Map<string, EulerDeg>, bone: string): EulerDeg {
  let euler = map.get(bone);
  if (!euler) {
    euler = { ...ZERO };
    map.set(bone, euler);
  }
  return euler;
}

/** Max travel offset from the load spot, metres, in any single axis. */
const TRAVEL_MAX = 3;

function clampNum(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/**
 * Rewrite a grip anchor to the effector's side: a bare anchor (`bar`) becomes
 * `bar_left`/`bar_right` so two hands grip shoulder-width apart. An anchor that
 * is already sided, or an effector without a side, is returned unchanged. The
 * renderer falls back to the bare anchor if a sided one isn't declared.
 */
function sideAnchor(anchor: string, effector: string): string {
  if (/_(left|right)$/.test(anchor)) return anchor;
  if (effector.endsWith("_left")) return `${anchor}_left`;
  if (effector.endsWith("_right")) return `${anchor}_right`;
  return anchor;
}

function ensure(map: Map<string, AuthoredEuler>, bone: string): AuthoredEuler {
  let authored = map.get(bone);
  if (!authored) {
    authored = { euler: { ...ZERO }, axes: new Set<Axis>() };
    map.set(bone, authored);
  }
  return authored;
}
