/**
 * Headless kinematic probe.
 *
 * Runs a `.posecode` source through the REAL production pipeline (parser →
 * timeline → mannequin FK → root choreography (yaw/travel) → ground-lock →
 * floor clamp) without a WebGL context (three.js scene-graph math is pure),
 * and returns world-space bone positions at the end of every phase. This is
 * the ground truth the invariant checks score against.
 *
 * Floor, body-landmark, and built-in prop pins are deterministic, so the probe
 * resolves those exactly like the viewer. Reach-IK remains the one intentional
 * gap; phase orientations still receive semantic palm-contact alignment.
 */

import * as THREE from "three";
import { parse, type TimingMode, type ParseError, type PinTarget, type ReachTarget, type Warning } from "posecode-parser";
import {
  applyGroundLock,
  alignFloorPalms,
  buildMannequin,
  buildProps,
  buildTimeline,
  depenetrate,
  groundFigure,
  levelPlantedFeet,
  propContactExemptions,
  resolvePropContacts,
} from "posecode-render";

export type Vec3 = readonly [x: number, y: number, z: number];
export type Quat = readonly [x: number, y: number, z: number, w: number];

export interface PhasePose {
  /** Phase name from the document. */
  name: string;
  durationSec: number;
  easing: TimingMode;
  /** Effector groups ground-locked during this phase. */
  groundLock: readonly string[];
  pins: readonly PinTarget[];
  reaches: readonly ReachTarget[];
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
  /** True when the phase relies on pins/reach-IK the probe cannot solve. */
  usesSceneIk: boolean;
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
}

const DEG = Math.PI / 180;
const EPS = 1e-4;
const WORLD_Y = new THREE.Vector3(0, 1, 0);

/** Probe a movement: FK + root solving at each phase end, viewer-faithful. */
export function probeMovement(source: string): ProbeResult {
  const { ir, errors, warnings } = parse(source);
  if (!ir || errors.length > 0) {
    return { ok: false, errors, warnings, phases: [], propTypes: [] };
  }

  const m = buildMannequin();
  const tl = buildTimeline(ir);
  const propScene = buildProps(ir.props);

  // Mirror Viewer.load(): reset bones, apply the base-pose root, pose at t=0,
  // then drop the figure onto the floor and remember the grounded base root.
  for (const bone of m.bones.values()) bone.quaternion.identity();
  const base = tl.basePose.root;
  m.root.position.set(...(base?.position ?? [0, 0, 0]));
  const [rx, ry, rz] = base?.rotationDeg ?? [0, 0, 0];
  m.root.rotation.set(rx * DEG, ry * DEG, rz * DEG);
  tl.sample(0, m.bones);
  m.root.updateMatrixWorld(true);
  depenetrate(m);
  groundFigure(m);
  resolvePropContacts(m, propScene.colliders, propContactExemptions([
    ...(ir.phases[0]?.pins ?? []),
    ...(ir.phases[0]?.grips ?? []),
    ...(ir.phases[0]?.reaches ?? []).map((r) => ({ effector: r.effector, anchor: r.target })),
  ]));
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
  
  const getEffectorId = (eff: string) => {
    if (eff === "hand_left") return "wrist_left";
    if (eff === "hand_right") return "wrist_right";
    if (eff === "foot_left") return "ankle_left";
    if (eff === "foot_right") return "ankle_right";
    return eff;
  };

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

  // Sample the end of each phase, applying the viewer's per-frame root
  // pipeline: base root → yaw/travel → ground-lock → floor safety clamp.
  const yawQ = new THREE.Quaternion();
  const phases: PhasePose[] = tl.segments.map((seg, phaseIndex) => {
    const authored = ir.phases[phaseIndex]!;
    const info = tl.sample(seg.end - EPS, m.bones);
    m.root.position.copy(baseRootPos);
    m.root.quaternion.copy(baseRootQuat);
    if (info.rootYaw !== 0) {
      yawQ.setFromAxisAngle(WORLD_Y, info.rootYaw);
      m.root.quaternion.premultiply(yawQ);
    }
    m.root.position.x += info.rootOffset.x;
    m.root.position.z += info.rootOffset.z;
    m.root.updateMatrixWorld(true);
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
    // Resolve scene-independent pins. Unknown names here are prop anchors and
    // intentionally remain for browser-level coverage.
    if (info.pins.length > 0) {
      const delta = new THREE.Vector3();
      let pinCount = 0;
      for (const pin of info.pins) {
        const effectorId = pin.effector === "hand_left"
          ? "wrist_left"
          : pin.effector === "hand_right"
            ? "wrist_right"
            : pin.effector === "foot_left"
              ? "ankle_left"
              : pin.effector === "foot_right"
                ? "ankle_right"
                : pin.effector;
        const effector = m.bones.get(effectorId);
        if (!effector) continue;
        let target: THREE.Vector3 | null = null;
        if (pin.anchor === "floor") {
          const startPos = segmentStartEffectors[phaseIndex]?.get(effectorId);
          if (startPos) {
            target = startPos.clone();
            target.y = 0;
          } else {
            target = effector.getWorldPosition(new THREE.Vector3());
            target.y = 0;
          }
        } else if (propScene.anchors.has(pin.anchor)) {
          target = propScene.anchors.get(pin.anchor)!.clone();
        } else {
          const landmark = m.bones.get(pin.anchor);
          if (landmark) target = landmark.getWorldPosition(new THREE.Vector3());
        }
        if (!target) continue;
        delta.add(target.sub(effector.getWorldPosition(new THREE.Vector3())));
        pinCount++;
      }
      if (pinCount > 0) {
        m.root.position.add(delta.multiplyScalar(1 / pinCount));
        m.root.updateMatrixWorld(true);
      }
    }
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
    alignFloorPalms(m, info.reaches, info.pins);
    // Plantigrade correction (viewer parity): flatten planted soles. This lifts
    // the foot mesh a little, so it must run BEFORE the floor clamp reconciles.
    levelPlantedFeet(m, info.groundLock);
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
    const finalBox = new THREE.Box3().setFromObject(m.root);
    return {
      name: seg.name,
      durationSec: authored.durationSec,
      easing: authored.easing,
      groundLock: [...info.groundLock],
      pins: [...info.pins],
      reaches: [...info.reaches],
      rootOffset: [info.rootOffset.x, 0, info.rootOffset.z],
      rootYaw: info.rootYaw,
      propPush,
      usesSceneIk: info.pins.length > 0 || info.reaches.length > 0 || info.grips.length > 0,
      floorBound,
      meshMinY: Number.isFinite(finalBox.min.y) ? finalBox.min.y : 0,
      bones: snapshotBones(m.bones),
      boneQuaternions: snapshotBoneQuaternions(m.bones),
    };
  });

  return { ok: true, errors, warnings, phases, propTypes: [...ir.props] };
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
