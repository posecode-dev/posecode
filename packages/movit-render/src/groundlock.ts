/**
 * Floating-root ground-contact solving, independent of the viewer so both the
 * render loop and the headless eval harness use the identical solver.
 *
 * "Ground-lock" = keep the declared effectors (hands/feet) planted while the
 * body moves, tuned per support type:
 *
 * - **Hands + feet (push-up / plank):** pivot the whole rigid body about the
 *   foot line (the toes stay planted) until the hands reach the floor. As the
 *   elbows fold (FK), the hands rise toward the shoulders, so the body tips
 *   down around the toes — the torso lowers in one straight line, a real
 *   push-up. Rotating about an X-axis through the foot midpoint keeps both
 *   feet exactly planted (they differ from the pivot only along X).
 * - **Feet only (squat / hinge / roll-down):** drop the body vertically so the
 *   feet stay planted while the legs keep their authored FK bend — the pelvis
 *   lowers. Legs are never CCD-solved (that would overwrite the pose).
 */

import * as THREE from "three";
import type { Mannequin } from "./mannequin.js";

const ROOT_X = new THREE.Vector3(1, 0, 0);

/** Drop the figure so its lowest hand/foot contact sits on the floor. */
export function groundFigure(m: Mannequin): void {
  m.root.updateMatrixWorld(true);
  let minY = Infinity;
  for (const id of ["wrist_left", "wrist_right", "ankle_left", "ankle_right"]) {
    const node = m.bones.get(id);
    if (!node) continue;
    minY = Math.min(minY, node.getWorldPosition(new THREE.Vector3()).y);
  }
  if (Number.isFinite(minY)) {
    m.root.position.y -= minY;
    m.root.updateMatrixWorld(true);
  }
}

/** Resolve active effector group names ("hands"/"feet") into bone ids. */
function activeEffectorIds(m: Mannequin, active: string[]): string[] {
  const ids = new Set<string>();
  for (const group of active) {
    for (const id of m.effectors[group] ?? []) ids.add(id);
  }
  return [...ids];
}

/** Average world position of a set of effector bones. */
function avgWorld(m: Mannequin, ids: string[]): THREE.Vector3 {
  const p = new THREE.Vector3();
  let n = 0;
  for (const id of ids) {
    const node = m.bones.get(id);
    if (!node) continue;
    p.add(node.getWorldPosition(new THREE.Vector3()));
    n++;
  }
  return n > 0 ? p.multiplyScalar(1 / n) : p;
}

/** Rotate the whole figure about a world-space pivot (X-axis through pivot). */
function rotateRootAboutPivot(m: Mannequin, pivot: THREE.Vector3, angle: number): void {
  const q = new THREE.Quaternion().setFromAxisAngle(ROOT_X, angle);
  m.root.position.sub(pivot).applyQuaternion(q).add(pivot);
  m.root.quaternion.premultiply(q);
  m.root.updateMatrixWorld(true);
}

/** Apply ground-lock for the phase's active effector groups (see module doc). */
export function applyGroundLock(m: Mannequin, active: string[]): void {
  if (active.length === 0) return;
  const ids = activeEffectorIds(m, active);
  const hands = ids.filter((id) => id.startsWith("wrist"));
  const feet = ids.filter((id) => id.startsWith("ankle"));

  if (hands.length > 0 && feet.length > 0) {
    const pivot = avgWorld(m, feet);
    // Newton iterations: rotate about the toes until avg hand height = 0.
    for (let i = 0; i < 8; i++) {
      const y0 = avgWorld(m, hands).y;
      if (Math.abs(y0) < 0.004) break;
      rotateRootAboutPivot(m, pivot, 0.01);
      const y1 = avgWorld(m, hands).y;
      rotateRootAboutPivot(m, pivot, -0.01);
      const deriv = (y1 - y0) / 0.01;
      if (Math.abs(deriv) < 1e-4) break;
      rotateRootAboutPivot(m, pivot, THREE.MathUtils.clamp(-y0 / deriv, -0.35, 0.35));
    }
    return;
  }

  if (feet.length > 0) {
    let sumY = 0;
    for (const id of feet) {
      const node = m.bones.get(id);
      if (node) sumY += node.getWorldPosition(new THREE.Vector3()).y;
    }
    m.root.position.y -= sumY / feet.length;
    m.root.updateMatrixWorld(true);
  }
}
