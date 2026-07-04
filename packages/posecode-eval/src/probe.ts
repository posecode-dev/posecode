/**
 * Headless kinematic probe.
 *
 * Runs a `.posecode` source through the REAL production pipeline — parser →
 * timeline → mannequin FK → root choreography (yaw/travel) → ground-lock →
 * floor clamp — without a WebGL context (three.js scene-graph math is pure),
 * and returns world-space bone positions at the end of every phase. This is
 * the ground truth the invariant checks score against.
 *
 * Known gap vs the viewer: contact pins and reach-IK are scene-dependent
 * (their anchors can live on props), so the probe skips them; pinned/reaching
 * movements are covered by the parse/clamp invariants only.
 */

import * as THREE from "three";
import { parse, type ParseError, type Warning } from "posecode-parser";
import {
  applyGroundLock,
  buildMannequin,
  buildTimeline,
  groundFigure,
} from "posecode-render";

export type Vec3 = readonly [x: number, y: number, z: number];

export interface PhasePose {
  /** Phase name from the document. */
  name: string;
  /** Effector groups ground-locked during this phase. */
  groundLock: readonly string[];
  /** True when the phase relies on pins/reach-IK the probe cannot solve. */
  usesSceneIk: boolean;
  /** World-space position of every bone at the END of this phase. */
  bones: ReadonlyMap<string, Vec3>;
}

export interface ProbeResult {
  ok: boolean;
  errors: readonly ParseError[];
  warnings: readonly Warning[];
  phases: readonly PhasePose[];
}

const DEG = Math.PI / 180;
const EPS = 1e-4;
const WORLD_Y = new THREE.Vector3(0, 1, 0);

/** Probe a movement: FK + root solving at each phase end, viewer-faithful. */
export function probeMovement(source: string): ProbeResult {
  const { ir, errors, warnings } = parse(source);
  if (!ir || errors.length > 0) {
    return { ok: false, errors, warnings, phases: [] };
  }

  const m = buildMannequin();
  const tl = buildTimeline(ir);

  // Mirror Viewer.load(): reset bones, apply the base-pose root, pose at t=0,
  // then drop the figure onto the floor and remember the grounded base root.
  for (const bone of m.bones.values()) bone.quaternion.identity();
  const base = tl.basePose.root;
  m.root.position.set(...(base?.position ?? [0, 0, 0]));
  const [rx, ry, rz] = base?.rotationDeg ?? [0, 0, 0];
  m.root.rotation.set(rx * DEG, ry * DEG, rz * DEG);
  tl.sample(0, m.bones);
  m.root.updateMatrixWorld(true);
  groundFigure(m);
  const baseRootPos = m.root.position.clone();
  const baseRootQuat = m.root.quaternion.clone();

  // Sample the end of each phase, applying the viewer's per-frame root
  // pipeline: base root → yaw/travel → ground-lock → floor safety clamp.
  const yawQ = new THREE.Quaternion();
  const phases: PhasePose[] = tl.segments.map((seg) => {
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
    applyGroundLock(m, info.groundLock);
    // Viewer safety net: never leave the lowest mesh point below the floor.
    m.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(m.root);
    if (box.min.y < 0) {
      m.root.position.y -= box.min.y;
      m.root.updateMatrixWorld(true);
    }
    return {
      name: seg.name,
      groundLock: [...info.groundLock],
      usesSceneIk: info.pins.length > 0 || info.reaches.length > 0,
      bones: snapshotBones(m.bones),
    };
  });

  return { ok: true, errors, warnings, phases };
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
