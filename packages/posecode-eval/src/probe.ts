/**
 * Headless kinematic probe.
 *
 * Runs a `.posecode` source through the production authored-motion pipeline
 * (parser → timeline → mannequin FK → root choreography → contacts → floor
 * clamp) without a WebGL context and returns world-space phase endpoints.
 * Presentation-only breathing/blinking, free-arm ambience, camera behavior,
 * and optional mocap overlays are deliberately outside this deterministic
 * authoring gate; browser tests cover the shipped visible character.
 *
 * Contact solving reuses the production CCD/ground/contact primitives and
 * mirrors the viewer's reach, pin, and grip ordering. Every declared contact
 * is returned with an explicit residual (or an explicit unsupported status),
 * so a solver gap can never be mistaken for a successful movement.
 */

import * as THREE from "three";
import {
  parse,
  type GripTarget,
  type TimingMode,
  type ParseError,
  type PinTarget,
  type ReachTarget,
  type Warning,
} from "posecode-parser";
import {
  applyGroundLock,
  alignFloorContacts,
  alignGripFrames,
  buildMannequin,
  buildProps,
  buildTimeline,
  depenetrate,
  effectorBoneId,
  enforceContactRom,
  floorContactHeight,
  floorTargetForEffector,
  formFists,
  relaxHands,
  swingArms,
  aimHead,
  groundFigure,
  isDipBarGrip,
  levelPlantedFeet,
  prepareGripFrames,
  propContactExemptions,
  reachChain,
  resolvePropContacts,
  solveCCD,
  solveReachToPoint,
  wrapGrip,
  type Character,
  type Proportions,
} from "posecode-render";
import {
  DEFAULT_DIAGNOSTIC_SAMPLE_RATE_HZ,
  createClipDiagnosticsCollector,
  type ClipDiagnostics,
} from "./diagnostics.js";

export type Vec3 = readonly [x: number, y: number, z: number];
export type Quat = readonly [x: number, y: number, z: number, w: number];

export type ContactKind = "reach" | "pin" | "grip" | "ground-lock";
export type ContactStatus = "resolved" | "unsupported";

/** A declared contact measured against the final, fully solved phase pose. */
export interface ContactResidual {
  kind: ContactKind;
  effector: string;
  target: string;
  effectorBone: string;
  /** Contact activation weight (terminal declarations are 1; blended-out reaches approach 0). */
  weight: number;
  status: ContactStatus;
  /** Final world-space effector/target positions, when they can be resolved. */
  effectorPosition: Vec3 | null;
  targetPosition: Vec3 | null;
  /** Euclidean positional error in metres; null means the evaluator cannot solve it. */
  error: number | null;
  /** Explicit reason for an unsupported path. Never silently treated as a pass. */
  reason?: string;
}

export interface PhasePose {
  /** Phase name from the document. */
  name: string;
  durationSec: number;
  easing: TimingMode;
  /** Effector groups ground-locked during this phase. */
  groundLock: readonly string[];
  pins: readonly PinTarget[];
  reaches: readonly ReachTarget[];
  grips: readonly GripTarget[];
  /** Positional truth for every declared reach/pin/grip in this phase. */
  contactResiduals: readonly ContactResidual[];
  rootOffset: Vec3;
  rootYaw: number;
  /**
   * Horizontal body translation applied by the solid-prop contact solve
   * (resolvePropContacts): the feet legitimately glide by this much while the
   * body is pressed out of a prop (a wall-sit walks the feet forward as the
   * back slides down the wall), so skate metrics compensate for it like they
   * do for authored travel.
   */
  propPush: Vec3;
  /** Whether the phase should rest on the floor (no elevated prop/grip support). */
  floorBound: boolean;
  /**
   * Height of the lowest visible-mesh point above the floor after the full
   * contact solve. ~0 for a grounded pose; a positive value means the figure
   * floats (the bug that levelPlantedFeet used to cause on squat/deadlift).
   */
  meshMinY: number;
  /** World-space position of every bone at the END of this phase. */
  bones: ReadonlyMap<string, Vec3>;
  /** World-space orientation of every bone at the end of the phase. */
  boneQuaternions: ReadonlyMap<string, Quat>;
}

export interface ProbeResult {
  ok: boolean;
  errors: readonly ParseError[];
  warnings: readonly Warning[];
  phases: readonly PhasePose[];
  propTypes: readonly string[];
  /** Flattened contact residuals for scorecards/consumers that do not walk phases. */
  contactResiduals: readonly ContactResidual[];
  /** Constraint residuals aggregated over regularly sampled solved clip frames. */
  diagnostics: ClipDiagnostics;
}

export interface ProbeOptions {
  /** Sampling rate for clip-wide grounding/collision diagnostics. Defaults to 12Hz. */
  diagnosticSampleRateHz?: number;
}

const DEG = Math.PI / 180;
const EPS = 1e-4;
const WORLD_Y = new THREE.Vector3(0, 1, 0);

type TargetReference =
  | { kind: "fixed"; point: THREE.Vector3 }
  | { kind: "floor"; point: THREE.Vector3 }
  | { kind: "landmark"; boneId: string };

interface PendingContact {
  kind: ContactKind;
  effector: string;
  target: string;
  effectorBone: string;
  weight: number;
  targetRef: TargetReference | null;
  reason?: string;
}

function fistSidesOf(
  reaches: readonly ReachTarget[],
  pins: readonly PinTarget[],
  groundLock: readonly string[],
): Set<"left" | "right"> {
  const sides = new Set<"left" | "right">();
  const add = (effector: string): void => {
    if (effector === "fists" || effector === "fist_left") sides.add("left");
    if (effector === "fists" || effector === "fist_right") sides.add("right");
  };
  for (const reach of reaches) add(reach.effector);
  for (const pin of pins) add(pin.effector);
  for (const effector of groundLock) add(effector);
  return sides;
}

function gripSidesOf(grips: readonly { effector: string }[]): Set<"left" | "right"> {
  const sides = new Set<"left" | "right">();
  for (const grip of grips) {
    if (grip.effector.endsWith("_left") || grip.effector === "hands") sides.add("left");
    if (grip.effector.endsWith("_right") || grip.effector === "hands") sides.add("right");
  }
  return sides;
}

function contactHandSidesOf(
  reaches: readonly { effector: string }[],
  pins: readonly { effector: string }[],
  grips: readonly { effector: string }[],
  groundLock: readonly string[],
): Set<"left" | "right"> {
  const sides = gripSidesOf(grips);
  const add = (effector: string): void => {
    if (/^(?:hand|fist|elbow)_left$/.test(effector)
      || effector === "hands" || effector === "fists" || effector === "forearms") sides.add("left");
    if (/^(?:hand|fist|elbow)_right$/.test(effector)
      || effector === "hands" || effector === "fists" || effector === "forearms") sides.add("right");
  };
  reaches.forEach((contact) => add(contact.effector));
  pins.forEach((contact) => add(contact.effector));
  groundLock.forEach(add);
  return sides;
}

function floorHandSidesOf(
  reaches: readonly { effector: string; target: string }[],
  pins: readonly { effector: string; anchor: string }[],
  groundLock: readonly string[],
): Set<"left" | "right"> {
  const sides = new Set<"left" | "right">();
  const add = (effector: string): void => {
    if (effector === "hands" || effector === "hand_left") sides.add("left");
    if (effector === "hands" || effector === "hand_right") sides.add("right");
  };
  reaches.filter((reach) => reach.target === "floor").forEach((reach) => add(reach.effector));
  pins.filter((pin) => pin.anchor === "floor").forEach((pin) => add(pin.effector));
  groundLock.forEach(add);
  return sides;
}

function unionHandSides(
  a: ReadonlySet<"left" | "right">,
  b: ReadonlySet<"left" | "right">,
): Set<"left" | "right"> {
  return new Set([...a, ...b]);
}

/** Probe a movement: FK + root solving at each phase end, viewer-faithful. */
export function probeMovement(
  source: string,
  proportions?: Proportions,
  character?: Character,
  options: ProbeOptions = {},
): ProbeResult {
  const { ir, errors, warnings } = parse(source);
  const requestedDiagnosticSampleRate = options.diagnosticSampleRateHz;
  const diagnosticSampleRateHz = Math.max(
    1,
    Math.min(
      120,
      requestedDiagnosticSampleRate !== undefined && Number.isFinite(requestedDiagnosticSampleRate)
        ? requestedDiagnosticSampleRate
        : DEFAULT_DIAGNOSTIC_SAMPLE_RATE_HZ,
    ),
  );
  if (!ir || errors.length > 0) {
    return {
      ok: false,
      errors,
      warnings,
      phases: [],
      propTypes: [],
      contactResiduals: [],
      diagnostics: createClipDiagnosticsCollector(diagnosticSampleRateHz).finish(),
    };
  }

  const m = buildMannequin(undefined, proportions);
  const tl = buildTimeline(ir);
  // Gait clip: authors root travel AND alternates its floor foot-pins between
  // both feet. There a floor foot-pin is a stance foot (body travels, leg
  // reaches back to the plant) rather than a vertical support / weight-shift
  // that translates the whole body onto its anchor. Mirrors Viewer.load().
  const clipHasTravel = ir.phases.some(
    (phase) =>
      phase.travel !== undefined &&
      (Math.abs(phase.travel.x) > EPS || Math.abs(phase.travel.z) > EPS),
  );
  const pinnedFootSides = new Set<string>();
  for (const phase of ir.phases) {
    for (const pin of phase.pins) {
      if (pin.anchor !== "floor") continue;
      const bone = effectorBoneId(pin.effector);
      if (bone.startsWith("ankle_")) {
        pinnedFootSides.add(bone.endsWith("_left") ? "left" : "right");
      }
    }
  }
  const clipIsGait = clipHasTravel && pinnedFootSides.size >= 2;
  const propScene = buildProps(ir.props);
  const authoredFingers = new Set(tl.bonesUsed.filter((id) =>
    /^(thumb|index|middle|ring|pinky)_(left|right)$/.test(id),
  ));
  const authoredShoulders = new Set(tl.bonesUsed.filter((id) => id.startsWith("shoulder_")));
  const authoredHead = tl.bonesUsed.some((id) => id === "head" || id === "neck");

  // Mirror Viewer.load(): reset bones, apply the base-pose root, pose at t=0,
  // then drop the figure onto the floor and remember the grounded base root.
  for (const bone of m.bones.values()) bone.quaternion.identity();
  const base = tl.basePose.root;
  m.root.position.set(...(base?.position ?? [0, 0, 0]));
  const [rx, ry, rz] = base?.rotationDeg ?? [0, 0, 0];
  m.root.rotation.set(rx * DEG, ry * DEG, rz * DEG);
  tl.sample(0, m.bones);
  m.root.updateMatrixWorld(true);
  const initialPhase = ir.phases[0];
  const initialFistSides = fistSidesOf(
    initialPhase?.reaches ?? [],
    initialPhase?.pins ?? [],
    initialPhase?.groundLock ?? [],
  );
  const initialGripSides = gripSidesOf(initialPhase?.grips ?? []);
  const initialConstrainedHandSides = contactHandSidesOf(
    initialPhase?.reaches ?? [],
    initialPhase?.pins ?? [],
    initialPhase?.grips ?? [],
    initialPhase?.groundLock ?? [],
  );
  formFists(m, initialFistSides, authoredFingers);
  relaxHands(
    m,
    unionHandSides(initialGripSides, initialFistSides),
    authoredFingers,
    floorHandSidesOf(
      initialPhase?.reaches ?? [],
      initialPhase?.pins ?? [],
      initialPhase?.groundLock ?? [],
    ),
  );
  alignFloorContacts(
    m,
    ir.phases[0]?.reaches ?? [],
    ir.phases[0]?.pins ?? [],
    ir.phases[0]?.groundLock ?? [],
  );
  depenetrate(m);
  groundFigure(m);
  resolvePropContacts(m, propScene.colliders, propContactExemptions([
    ...(ir.phases[0]?.pins ?? []),
    ...(ir.phases[0]?.grips ?? []),
    ...(ir.phases[0]?.reaches ?? []).map((r) => ({ effector: r.effector, anchor: r.target })),
  ]));
  levelPlantedFeet(m, initialPhase?.groundLock ?? []);
  swingArms(m, authoredShoulders, initialConstrainedHandSides);
  enforceContactRom(m);
  const baseRootPos = m.root.position.clone();
  const baseRootQuat = m.root.quaternion.clone();

  // Mirror Viewer.captureGroundTargets(): the grounded base-pose effector
  // positions are the anchors horizontal foot planting holds feet to.
  const groundTargets = new Map<string, THREE.Vector3>();
  for (const ids of Object.values(m.effectors)) {
    for (const id of ids) {
      const node = m.bones.get(id);
      if (node) groundTargets.set(id, node.getWorldPosition(new THREE.Vector3()));
    }
  }

  // Precompute world positions of all effectors at start of each segment
  const segmentStartEffectors: Map<string, THREE.Vector3>[] = [];
  const tempYawQ = new THREE.Quaternion();
  
  const getEffectorId = (eff: string) => effectorBoneId(eff);

  let prevEffectorsMap: Map<string, THREE.Vector3> | null = null;
  let prevPins: typeof ir.phases[number]["pins"] = [];

  for (let i = 0; i < tl.segments.length; i++) {
    const seg = tl.segments[i]!;
    for (const bone of m.bones.values()) bone.quaternion.identity();
    const info = tl.sample(seg.start, m.bones);
    
    const wasPinned = (id: string) => prevPins.some(p => getEffectorId(p.effector) === id && p.anchor === "floor");
    const isPinned = (id: string) => info.pins.some(p => getEffectorId(p.effector) === id && p.anchor === "floor");

    m.root.position.copy(baseRootPos);
    m.root.quaternion.copy(baseRootQuat);
    if (info.rootYaw !== 0) {
      tempYawQ.setFromAxisAngle(WORLD_Y, info.rootYaw);
      m.root.quaternion.premultiply(tempYawQ);
    }
    m.root.position.x += info.rootOffset.x;
    m.root.position.z += info.rootOffset.z;
    m.root.updateMatrixWorld(true);
    depenetrate(m);

    const effectorsMap = new Map<string, THREE.Vector3>();
    for (const ids of Object.values(m.effectors)) {
      for (const id of ids) {
        const node = m.bones.get(id);
        if (node) {
          if (i > 0 && wasPinned(id) && isPinned(id) && prevEffectorsMap && prevEffectorsMap.has(id)) {
            effectorsMap.set(id, prevEffectorsMap.get(id)!);
          } else {
            effectorsMap.set(id, node.getWorldPosition(new THREE.Vector3()));
          }
        }
      }
    }
    segmentStartEffectors.push(effectorsMap);
    prevEffectorsMap = effectorsMap;
    prevPins = info.pins;
  }

  // Restore initial state
  for (const bone of m.bones.values()) bone.quaternion.identity();
  tl.sample(0, m.bones);
  m.root.position.copy(baseRootPos);
  m.root.quaternion.copy(baseRootQuat);
  m.root.updateMatrixWorld(true);
  depenetrate(m);
  groundFigure(m);

  const resolveTarget = (
    target: string,
    effectorName: string,
  ): { point: THREE.Vector3; ref: TargetReference } | null => {
    if (target === "floor") {
      const point = floorTargetForEffector(m, effectorName);
      if (!point) return null;
      return { point, ref: { kind: "floor", point: point.clone() } };
    }
    const prop = propScene.anchors.get(target);
    if (prop) {
      const point = prop.clone();
      return { point, ref: { kind: "fixed", point: point.clone() } };
    }
    const landmark = m.bones.get(target);
    if (landmark) {
      return {
        point: landmark.getWorldPosition(new THREE.Vector3()),
        ref: { kind: "landmark", boneId: target },
      };
    }
    return null;
  };

  const applyLookAt = (info: {
    grips: readonly GripTarget[];
    reaches: readonly ReachTarget[];
  }): void => {
    if (authoredHead) return;
    const points: THREE.Vector3[] = [];
    const collect = (effector: string, target: string): void => {
      const resolved = resolveTarget(target, effector)
        ?? resolveTarget(target.replace(/_(left|right)$/, ""), effector);
      if (resolved) points.push(resolved.point);
    };
    info.grips.forEach((grip) => collect(grip.effector, grip.anchor));
    info.reaches.forEach((reach) => collect(reach.effector, reach.target));
    if (points.length === 0) return;
    const focus = new THREE.Vector3();
    points.forEach((point) => focus.add(point));
    aimHead(m, focus.multiplyScalar(1 / points.length));
  };

  const unsupported = (
    kind: ContactKind,
    effector: string,
    target: string,
    effectorBone: string,
    reason: string,
    weight = 1,
  ): PendingContact => ({ kind, effector, target, effectorBone, weight, targetRef: null, reason });

  const applyPins = (pins: readonly PinTarget[], phaseIndex: number): PendingContact[] => {
    const dipBarPins = pins.filter((pin) => isDipBarGrip(pin.anchor));
    prepareGripFrames(m, dipBarPins);
    const contacts: PendingContact[] = [];
    const solvable: Array<{ contact: PendingContact; effector: THREE.Object3D; point: THREE.Vector3 }> = [];
    const stancePlants: Array<{ effector: string; point: THREE.Vector3 }> = [];
    for (const pin of pins) {
      const effectorBone = getEffectorId(pin.effector);
      const effector = m.bones.get(effectorBone);
      if (!effector) {
        contacts.push(unsupported("pin", pin.effector, pin.anchor, effectorBone, `unknown effector bone "${effectorBone}"`));
        continue;
      }
      let resolved: { point: THREE.Vector3; ref: TargetReference } | null = null;
      if (pin.anchor === "floor") {
        const start = segmentStartEffectors[phaseIndex]?.get(effectorBone);
        if (start) {
          const point = start.clone();
          point.y = floorTargetForEffector(m, pin.effector)?.y ?? 0;
          resolved = { point, ref: { kind: "floor", point: point.clone() } };
        }
      }
      resolved ??= resolveTarget(pin.anchor, pin.effector);
      if (!resolved) {
        contacts.push(unsupported("pin", pin.effector, pin.anchor, effectorBone, `unknown anchor "${pin.anchor}"`));
        continue;
      }
      const contact: PendingContact = {
        kind: "pin",
        effector: pin.effector,
        target: pin.anchor,
        effectorBone,
        weight: 1,
        targetRef: resolved.ref,
      };
      contacts.push(contact);
      // In a locomotion clip a planted foot is a stance foot: solve it by leg IK
      // after the body has travelled, not by translating the body onto the
      // anchor (which would cancel the authored travel). Mirrors Viewer.frame().
      if (clipIsGait && pin.anchor === "floor" && effectorBone.startsWith("ankle_")) {
        stancePlants.push({ effector: pin.effector, point: resolved.point });
      } else {
        solvable.push({ contact, effector, point: resolved.point });
      }
    }
    if (solvable.length > 0) {
      const delta = new THREE.Vector3();
      for (const item of solvable) {
        delta.add(item.point.clone().sub(item.effector.getWorldPosition(new THREE.Vector3())));
      }
      m.root.position.add(delta.multiplyScalar(1 / solvable.length));
      m.root.updateMatrixWorld(true);
    }
    for (const plant of stancePlants) {
      solveReachToPoint(m, plant.effector, "floor", plant.point, 1);
    }
    alignGripFrames(m, dipBarPins);
    return contacts;
  };

  const applyGrips = (grips: readonly GripTarget[]): PendingContact[] => {
    prepareGripFrames(m, grips);
    const contacts: PendingContact[] = [];
    const solvable: Array<{
      contact: PendingContact;
      effector: THREE.Object3D;
      point: THREE.Vector3;
    }> = [];
    for (const grip of grips) {
      const effectorBone = getEffectorId(grip.effector);
      const effector = m.bones.get(effectorBone);
      if (!effector) {
        contacts.push(unsupported("grip", grip.effector, grip.anchor, effectorBone, `unknown effector bone "${effectorBone}"`));
        continue;
      }
      const resolved = resolveTarget(grip.anchor, grip.effector)
        ?? resolveTarget(grip.anchor.replace(/_(left|right)$/, ""), grip.effector);
      if (!resolved) {
        contacts.push(unsupported("grip", grip.effector, grip.anchor, effectorBone, `unknown anchor "${grip.anchor}"`));
        continue;
      }
      const contact: PendingContact = {
        kind: "grip",
        effector: grip.effector,
        target: grip.anchor,
        effectorBone,
        weight: 1,
        targetRef: resolved.ref,
      };
      contacts.push(contact);
      solvable.push({ contact, effector, point: resolved.point });
    }
    if (solvable.length > 0) {
      const delta = new THREE.Vector3();
      for (const item of solvable) {
        delta.add(item.point.clone().sub(item.effector.getWorldPosition(new THREE.Vector3())));
      }
      m.root.position.add(delta.multiplyScalar(1 / solvable.length));
      m.root.updateMatrixWorld(true);
    }
    for (const item of solvable) {
      const { joints, limits } = reachChain(m, item.contact.effector);
      if (joints.length === 0) {
        item.contact.reason = "production IK unsupported: unsupported effector";
        item.contact.targetRef = null;
        continue;
      }
      if (isDipBarGrip(item.contact.target)) {
        // Viewer parity: keep the elbow's axial solution fixed so a dip-bar
        // palm cannot flip between or away from the parallel rails.
        for (let i = 0; i < joints.length; i++) {
          if (!joints[i]!.name.startsWith("elbow_")) continue;
          const limit = limits[i];
          if (limit) limits[i] = { ...limit, y: [0, 0] };
        }
      }
      solveCCD({ joints, limits, effector: item.effector, target: item.point }, 12);
    }
    alignGripFrames(m, grips);
    wrapGrip(m, grips);
    m.root.updateMatrixWorld(true);
    return contacts;
  };

  const applyReaches = (
    reaches: readonly (ReachTarget & { weight: number })[],
  ): PendingContact[] => {
    const contacts: PendingContact[] = [];
    for (const reach of reaches) {
      const effectorBone = getEffectorId(reach.effector);
      const effector = m.bones.get(effectorBone);
      if (!effector) {
        contacts.push(unsupported("reach", reach.effector, reach.target, effectorBone, `unknown effector bone "${effectorBone}"`, reach.weight));
        continue;
      }
      const resolved = resolveTarget(reach.target, reach.effector);
      if (!resolved) {
        contacts.push(unsupported("reach", reach.effector, reach.target, effectorBone, `unknown target "${reach.target}"`, reach.weight));
        continue;
      }
      const solved = solveReachToPoint(
        m,
        reach.effector,
        reach.target,
        resolved.point,
        reach.weight,
      );
      if (solved.distance === null) {
        contacts.push(unsupported(
          "reach",
          reach.effector,
          reach.target,
          effectorBone,
          `production IK unsupported: ${solved.reason ?? "unknown reason"}`,
          reach.weight,
        ));
        continue;
      }
      contacts.push({
        kind: "reach",
        effector: reach.effector,
        target: reach.target,
        effectorBone,
        weight: reach.weight,
        targetRef: resolved.ref,
      });
    }
    return contacts;
  };

  const finalizeContacts = (pending: readonly PendingContact[]): ContactResidual[] =>
    pending.map((contact) => {
      // Contact targets are defined against the calibrated production driver
      // surfaces (sole/glute/knuckle offsets differ from raw skinned joint
      // origins). The visible character is sampled separately below for actual
      // skeleton geometry and exact skinned-mesh floor bounds.
      const effectorPoint = m.bones.get(contact.effectorBone)
        ?.getWorldPosition(new THREE.Vector3()) ?? null;
      let targetPoint: THREE.Vector3 | null = null;
      if (contact.targetRef?.kind === "fixed") {
        targetPoint = contact.targetRef.point.clone();
      } else if (contact.targetRef?.kind === "landmark") {
        targetPoint = m.bones.get(contact.targetRef.boneId)
          ?.getWorldPosition(new THREE.Vector3()) ?? null;
      } else if (contact.targetRef?.kind === "floor" && effectorPoint) {
        const height = floorContactHeight(m, contact.effector);
        if (height !== null) {
          targetPoint = contact.targetRef.point.clone().setY(effectorPoint.y - height);
        }
      }
      const status: ContactStatus = contact.reason || !effectorPoint || !targetPoint
        ? "unsupported"
        : "resolved";
      return {
        kind: contact.kind,
        effector: contact.effector,
        target: contact.target,
        effectorBone: contact.effectorBone,
        weight: contact.weight,
        status,
        effectorPosition: effectorPoint ? vectorTuple(effectorPoint) : null,
        targetPosition: targetPoint ? vectorTuple(targetPoint) : null,
        error: status === "resolved" ? effectorPoint!.distanceTo(targetPoint!) : null,
        ...(contact.reason ? { reason: contact.reason } : {}),
      };
    });

  const measureGroundLocks = (active: readonly string[]): ContactResidual[] => {
    const bones = new Set<string>();
    for (const name of active) {
      const expanded = m.effectors[name];
      if (expanded) expanded.forEach((id) => bones.add(id));
      else bones.add(effectorBoneId(name));
    }
    return [...bones].map((boneId) => {
      const effector = m.bones.get(boneId);
      const point = effector?.getWorldPosition(new THREE.Vector3()) ?? null;
      const height = floorContactHeight(m, boneId);
      const target = point && height !== null
        ? point.clone().setY(point.y - height)
        : null;
      const side = boneId.endsWith("_left") ? "left" : "right";
      const semantic = boneId.startsWith("ankle_")
        ? `foot_${side}`
        : boneId.startsWith("wrist_")
          ? `hand_${side}`
          : boneId.startsWith("elbow_")
            ? `elbow_${side}`
            : boneId;
      const status: ContactStatus = point && target && height !== null ? "resolved" : "unsupported";
      return {
        kind: "ground-lock" as const,
        effector: semantic,
        target: "floor",
        effectorBone: boneId,
        weight: 1,
        status,
        effectorPosition: point ? vectorTuple(point) : null,
        targetPosition: target ? vectorTuple(target) : null,
        error: status === "resolved" ? Math.abs(height!) : null,
        ...(status === "unsupported" ? { reason: "ground-lock surface could not be evaluated" } : {}),
      };
    });
  };

  // Sample the end of each phase, applying the viewer's per-frame root
  // pipeline: base root → yaw/travel → ground-lock → floor safety clamp.
  const yawQ = new THREE.Quaternion();
  let previousSolvedEffectors: Map<string, THREE.Vector3> | null = null;
  const activeFloorPinTargets = new Map<string, THREE.Vector3>();
  const phases: PhasePose[] = tl.segments.map((seg, phaseIndex) => {
    const authored = ir.phases[phaseIndex]!;
    const info = tl.sample(seg.end - EPS, m.bones);
    const currentFloorPins = new Set(
      info.pins
        .filter((pin) => pin.anchor === "floor")
        .map((pin) => effectorBoneId(pin.effector)),
    );
    for (const boneId of [...activeFloorPinTargets.keys()]) {
      if (!currentFloorPins.has(boneId)) activeFloorPinTargets.delete(boneId);
    }
    for (const boneId of currentFloorPins) {
      let target = activeFloorPinTargets.get(boneId);
      if (!target) {
        target = previousSolvedEffectors?.get(boneId)?.clone()
          ?? segmentStartEffectors[phaseIndex]?.get(boneId)?.clone();
        if (target) activeFloorPinTargets.set(boneId, target);
      }
      if (target) segmentStartEffectors[phaseIndex]?.set(boneId, target.clone());
    }
    m.root.position.copy(baseRootPos);
    m.root.quaternion.copy(baseRootQuat);
    if (info.rootYaw !== 0) {
      yawQ.setFromAxisAngle(WORLD_Y, info.rootYaw);
      m.root.quaternion.premultiply(yawQ);
    }
    m.root.position.x += info.rootOffset.x;
    m.root.position.z += info.rootOffset.z;
    m.root.updateMatrixWorld(true);
    formFists(
      m,
      fistSidesOf(info.reaches, info.pins, info.groundLock),
      authoredFingers,
    );
    alignFloorContacts(m, info.reaches, info.pins, info.groundLock);
    // Self-collision resolution, then contact solving (same order as the viewer).
    depenetrate(m);
    // Mirror the viewer's per-frame anchors: captured targets carried along
    // by this phase's yaw/travel so planting composes with choreography.
    const anchors = new Map<string, THREE.Vector3>();
    for (const [id, captured] of groundTargets) {
      const v = captured.clone();
      if (info.rootYaw !== 0) {
        v.sub(baseRootPos).applyAxisAngle(WORLD_Y, info.rootYaw).add(baseRootPos);
      }
      v.x += info.rootOffset.x;
      v.z += info.rootOffset.z;
      anchors.set(id, v);
    }
    applyGroundLock(m, info.groundLock, anchors);
    // Same production ordering as Viewer.frame(): whole-body pins, bar grips,
    // solid-prop correction, then ROM-constrained per-limb reach IK.
    const pendingContacts: PendingContact[] = [
      ...applyPins(info.pins, phaseIndex),
      ...applyGrips(info.grips),
    ];
    let reachContacts: PendingContact[] = [];
    // Props are solid (viewer parity): after the root solvers place the body,
    // push it back out of any prop face it crossed and bend swing legs clear.
    // Limbs pinned/gripped to a prop anchor are declared support, exempt.
    const prePush = m.root.position.clone();
    resolvePropContacts(m, propScene.colliders, propContactExemptions([
      ...info.pins,
      ...info.grips,
      ...info.reaches.map((r) => ({ effector: r.effector, anchor: r.target })),
    ]));
    const propPush: Vec3 = [m.root.position.x - prePush.x, 0, m.root.position.z - prePush.z];
    reachContacts = applyReaches(info.reaches);
    alignFloorContacts(m, info.reaches, info.pins, info.groundLock);
    // Plantigrade correction (viewer parity): flatten planted soles. This lifts
    // the foot mesh a little, so it must run BEFORE the floor clamp reconciles.
    levelPlantedFeet(m, info.groundLock);
    enforceContactRom(m);
    // Production bounded multi-contact refinement: a limb reach runs after
    // ground-lock and can alter which mesh point is lowest. Replant the root
    // support, then solve the independent limbs once more before floor safety.
    if (info.groundLock.length > 0 && info.reaches.length > 0) {
      for (let refinement = 0; refinement < 3; refinement++) {
        applyGroundLock(m, info.groundLock, anchors);
        reachContacts = applyReaches(info.reaches);
        alignFloorContacts(m, info.reaches, info.pins, info.groundLock);
        enforceContactRom(m);
      }
    }
    // Viewer safety net: a ground-locked phase is planted, so clamp both ways
    // (its lowest point sits exactly on the floor); an unlocked phase may be
    // airborne, so only rescue parts that dip below y=0. Mirror index.ts.
    m.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(m.root);
    const floorBound = info.grips.length === 0 && !info.pins.some((pin) => pin.anchor !== "floor");
    if (box.min.y < 0 || (floorBound && box.min.y > 0)) {
      m.root.position.y -= box.min.y;
      m.root.updateMatrixWorld(true);
    }
    // Production visible-rig path: retarget the solved driver, then reconcile
    // the exact skinned surface with the floor exactly as Viewer.frame does.
    if (character) {
      character.sync(m);
      if (floorBound) character.reconcileFloor();
    }
    const finalBox = character
      ? character.getBounds()
      : new THREE.Box3().setFromObject(m.root);
    // At an endpoint, timeline blending retains the previous phase's reach at
    // a vanishing weight. It is executed for viewer continuity but is not a
    // contact declaration of this phase and must not create a false failure.
    const contactResiduals = [
      ...finalizeContacts(
        [...pendingContacts, ...reachContacts]
          .filter((contact) => contact.kind !== "reach" || contact.weight >= 0.99),
      ),
      ...measureGroundLocks(info.groundLock),
    ];
    previousSolvedEffectors = new Map();
    for (const ids of Object.values(m.effectors)) {
      for (const id of ids) {
        const node = m.bones.get(id);
        if (node) previousSolvedEffectors.set(id, node.getWorldPosition(new THREE.Vector3()));
      }
    }
    return {
      name: seg.name,
      durationSec: authored.durationSec,
      easing: authored.easing,
      groundLock: [...info.groundLock],
      pins: [...authored.pins],
      reaches: [...authored.reaches],
      grips: [...authored.grips],
      contactResiduals,
      rootOffset: [info.rootOffset.x, 0, info.rootOffset.z],
      rootYaw: info.rootYaw,
      propPush,
      floorBound,
      meshMinY: Number.isFinite(finalBox.min.y) ? finalBox.min.y : 0,
      bones: character
        ? snapshotCharacterBones(m.bones.keys(), character)
        : snapshotBones(m.bones),
      boneQuaternions: character
        ? snapshotCharacterQuaternions(m.bones.keys(), character)
        : snapshotBoneQuaternions(m.bones),
    };
  });

  // Endpoint probes above power semantic movement checks. Separately sample
  // the solved clip between endpoints so a heel lift or collision that appears
  // only mid-transition cannot hide behind two valid terminal poses.
  const diagnosticsCollector = createClipDiagnosticsCollector(diagnosticSampleRateHz);
  for (let phaseIndex = 0; phaseIndex < tl.segments.length; phaseIndex++) {
    const seg = tl.segments[phaseIndex]!;
    const steps = Math.max(1, Math.ceil((seg.end - seg.start) * diagnosticSampleRateHz));
    const firstStep = phaseIndex === 0 ? 0 : 1;
    for (let step = firstStep; step <= steps; step++) {
      const fraction = step / steps;
      const rawTime = seg.start + (seg.end - seg.start) * fraction;
      const sampleTime = Math.min(rawTime, seg.end - EPS);
      for (const bone of m.bones.values()) bone.quaternion.identity();
      const info = tl.sample(sampleTime, m.bones);
      m.root.position.copy(baseRootPos);
      m.root.quaternion.copy(baseRootQuat);
      if (info.rootYaw !== 0) {
        yawQ.setFromAxisAngle(WORLD_Y, info.rootYaw);
        m.root.quaternion.premultiply(yawQ);
      }
      m.root.position.x += info.rootOffset.x;
      m.root.position.z += info.rootOffset.z;
      m.root.updateMatrixWorld(true);
      const fistSides = fistSidesOf(info.reaches, info.pins, info.groundLock);
      const gripSides = gripSidesOf(info.grips);
      const constrainedHandSides = contactHandSidesOf(
        info.reaches,
        info.pins,
        info.grips,
        info.groundLock,
      );
      formFists(m, fistSides, authoredFingers);
      relaxHands(
        m,
        unionHandSides(gripSides, fistSides),
        authoredFingers,
        floorHandSidesOf(info.reaches, info.pins, info.groundLock),
      );
      alignFloorContacts(m, info.reaches, info.pins, info.groundLock);
      depenetrate(m);

      const anchors = new Map<string, THREE.Vector3>();
      for (const [id, captured] of groundTargets) {
        const point = captured.clone();
        if (info.rootYaw !== 0) {
          point.sub(baseRootPos).applyAxisAngle(WORLD_Y, info.rootYaw).add(baseRootPos);
        }
        point.x += info.rootOffset.x;
        point.z += info.rootOffset.z;
        anchors.set(id, point);
      }
      applyGroundLock(m, info.groundLock, anchors);
      applyPins(info.pins, phaseIndex);
      applyGrips(info.grips);

      const prePush = m.root.position.clone();
      resolvePropContacts(m, propScene.colliders, propContactExemptions([
        ...info.pins,
        ...info.grips,
        ...info.reaches.map((reach) => ({ effector: reach.effector, anchor: reach.target })),
      ]));
      const propPush: Vec3 = [
        m.root.position.x - prePush.x,
        0,
        m.root.position.z - prePush.z,
      ];
      applyReaches(info.reaches);
      alignFloorContacts(m, info.reaches, info.pins, info.groundLock);
      levelPlantedFeet(m, info.groundLock);
      swingArms(m, authoredShoulders, constrainedHandSides);
      applyLookAt(info);
      enforceContactRom(m);
      if (info.groundLock.length > 0 && info.reaches.length > 0) {
        for (let refinement = 0; refinement < 3; refinement++) {
          applyGroundLock(m, info.groundLock, anchors);
          applyReaches(info.reaches);
          alignFloorContacts(m, info.reaches, info.pins, info.groundLock);
          enforceContactRom(m);
        }
      }
      m.root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(m.root);
      const floorBound = info.grips.length === 0
        && !info.pins.some((pin) => pin.anchor !== "floor");
      if (box.min.y < 0 || (floorBound && box.min.y > 0)) {
        m.root.position.y -= box.min.y;
        m.root.updateMatrixWorld(true);
      }
      diagnosticsCollector.record(m, {
        timeSec: sampleTime,
        phaseName: seg.name,
        groundLock: info.groundLock,
        pins: info.pins,
        rootOffset: [info.rootOffset.x, 0, info.rootOffset.z],
        rootYaw: info.rootYaw,
        propPush,
      });
    }
  }
  const diagnostics = diagnosticsCollector.finish();

  return {
    ok: true,
    errors,
    warnings,
    phases,
    propTypes: [...ir.props],
    contactResiduals: phases.flatMap((phase) => [...phase.contactResiduals]),
    diagnostics,
  };
}

function vectorTuple(v: THREE.Vector3): Vec3 {
  return [v.x, v.y, v.z];
}

function snapshotBoneQuaternions(bones: Map<string, THREE.Object3D>): Map<string, Quat> {
  const out = new Map<string, Quat>();
  const q = new THREE.Quaternion();
  for (const [id, node] of bones) {
    node.getWorldQuaternion(q);
    out.set(id, [q.x, q.y, q.z, q.w]);
  }
  return out;
}

function snapshotBones(bones: Map<string, THREE.Object3D>): Map<string, Vec3> {
  const out = new Map<string, Vec3>();
  const v = new THREE.Vector3();
  for (const [id, node] of bones) {
    node.getWorldPosition(v);
    out.set(id, [v.x, v.y, v.z]);
  }
  return out;
}

function snapshotCharacterBones(ids: Iterable<string>, character: Character): Map<string, Vec3> {
  const out = new Map<string, Vec3>();
  for (const id of ids) {
    const v = character.getJointWorldPosition(id);
    if (v) out.set(id, vectorTuple(v));
  }
  return out;
}

function snapshotCharacterQuaternions(ids: Iterable<string>, character: Character): Map<string, Quat> {
  const out = new Map<string, Quat>();
  for (const id of ids) {
    const q = character.getJointDriverQuaternion(id);
    if (q) out.set(id, [q.x, q.y, q.z, q.w]);
  }
  return out;
}
