/**
 * Headless kinematic probe.
 *
 * Runs a `.movit` source through the REAL production pipeline — parser →
 * timeline → mannequin FK → ground-lock solver — without a WebGL context
 * (three.js scene-graph math is pure), and returns world-space bone positions
 * at the end of every phase. This is the ground truth the invariant checks
 * score against.
 */

import * as THREE from "three";
import { parse, type ParseError, type Warning } from "movit-parser";
import {
  applyGroundLock,
  buildMannequin,
  buildTimeline,
  groundFigure,
} from "movit-render";

export type Vec3 = readonly [x: number, y: number, z: number];

export interface PhasePose {
  /** Phase name from the document. */
  name: string;
  /** Effector groups ground-locked during this phase. */
  groundLock: readonly string[];
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

/** Probe a movement: FK + ground-lock at each phase end, viewer-identical. */
export function probeMovement(source: string): ProbeResult {
  const { ir, errors, warnings } = parse(source);
  if (!ir || errors.length > 0) {
    return { ok: false, errors, warnings, phases: [] };
  }

  const m = buildMannequin();
  const tl = buildTimeline(ir);

  // Mirror Viewer.load(): reset bones, apply the base-pose root, pose at t=0,
  // then drop the figure onto the floor.
  for (const bone of m.bones.values()) bone.quaternion.identity();
  const base = tl.basePose.root;
  m.root.position.set(...(base?.position ?? [0, 0, 0]));
  const [rx, ry, rz] = base?.rotationDeg ?? [0, 0, 0];
  m.root.rotation.set(rx * DEG, ry * DEG, rz * DEG);
  tl.sample(0, m.bones);
  m.root.updateMatrixWorld(true);
  groundFigure(m);

  // Sample the end of each phase in sequence (root state carries across
  // phases exactly as it does frame-to-frame in the viewer).
  const phases: PhasePose[] = tl.segments.map((seg) => {
    const info = tl.sample(seg.end - EPS, m.bones);
    m.root.updateMatrixWorld(true);
    applyGroundLock(m, info.groundLock);
    return {
      name: seg.name,
      groundLock: [...info.groundLock],
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
