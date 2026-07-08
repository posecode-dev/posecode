/**
 * Floating-root ground-contact solving, independent of the viewer so both the
 * render loop and the headless eval harness (posecode-eval) use the identical
 * solver.
 *
 * "Ground-lock" = keep the declared effectors (hands/feet) planted while the
 * body moves, tuned per support type:
 *
 * - **Hands + feet (push-up / plank):** pivot the whole rigid body about the
 *   foot line (the toes stay planted) until the hands reach the floor. As the
 *   elbows fold (FK), the hands rise toward the shoulders, so the body tips
 *   down around the toes: the torso lowers in one straight line, a real
 *   push-up. Rotating about an X-axis through the foot midpoint keeps both
 *   feet exactly planted (they differ from the pivot only along X).
 * - **Feet only (squat / hinge / roll-down):** drop the body vertically so the
 *   feet stay planted while the legs keep their authored FK bend: the pelvis
 *   lowers. Legs are never CCD-solved (that would overwrite the pose).
 *   With `anchors`, grounded feet are also held HORIZONTALLY: FK leg motion
 *   (hip/knee) displaces the feet relative to the root, and without the
 *   correction the feet skate across the floor while the pelvis stays put —
 *   backwards from real movement, where planted feet stay fixed and the
 *   pelvis travels (a squat sits the hips back, a hinge shifts them behind
 *   the heels). Only feet near the floor anchor (a swing leg in a curl or
 *   march must stay free), and only the average delta is corrected so
 *   symmetric spreads (jumping jacks) don't fight the lock.
 *
 * Both paths ground the visible MESH (bounding boxes), not just bone origins:
 * an ankle bone sits ~0.04m above the sole, so anchoring bones alone left the
 * feet sunk into the floor.
 */

import * as THREE from "three";
import type { Mannequin } from "./mannequin.js";

const ROOT_X = new THREE.Vector3(1, 0, 0);

/**
 * Drop the whole figure so its lowest point rests on the floor. Using the
 * mesh bounding-box min (not just hand/foot joints) means ANY pose grounds
 * correctly: standing/plank rest on feet/hands, while supine/prone/seated
 * poses rest on the back, chest, or glutes.
 */
export function groundFigure(m: Mannequin): void {
  m.root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(m.root);
  if (Number.isFinite(box.min.y)) {
    m.root.position.y -= box.min.y;
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

/** A foot whose mesh bottom is within this height counts as planted. */
const PLANTED_MAX_Y = 0.05;

/**
 * Apply ground-lock for the phase's active effector groups (see module doc).
 * `anchors` (optional) maps effector bone ids to the world position each
 * planted foot should hold, already transformed by the phase's yaw/travel.
 */
export function applyGroundLock(
  m: Mannequin,
  active: string[],
  anchors?: ReadonlyMap<string, THREE.Vector3>,
): void {
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
    // The loop above zeroes the WRIST BONE's height, but the visible hand
    // (wrist ball + forearm capsule) and foot (mesh box) extend a bit below
    // their bones, leaving the mesh sunk into the floor by that offset. Catch
    // it with one final rigid-body vertical nudge (rotation already set the
    // correct tilt; this only corrects the residual bone-vs-mesh gap).
    m.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(m.root);
    if (box.min.y < 0) {
      m.root.position.y -= box.min.y;
      m.root.updateMatrixWorld(true);
    }
    return;
  }

  if (feet.length > 0) {
    // Ground the FOOT MESH's lowest point, not the ankle bone's origin: the
    // bone sits ~0.04m above the sole (foot box + capsule radius), so
    // anchoring the bone itself left the visible foot sunk into the floor.
    let minY = Infinity;
    for (const id of feet) {
      const node = m.bones.get(id);
      if (!node) continue;
      const box = new THREE.Box3().setFromObject(node);
      if (Number.isFinite(box.min.y)) minY = Math.min(minY, box.min.y);
    }
    if (Number.isFinite(minY)) {
      m.root.position.y -= minY;
      m.root.updateMatrixWorld(true);
    }
    if (anchors) plantFeetHorizontally(m, feet, anchors);
  }
}

/**
 * Translate the root in X/Z so grounded feet return to their anchors (see
 * module doc). Runs after vertical grounding so "near the floor" is judged in
 * the final vertical placement.
 */
function plantFeetHorizontally(
  m: Mannequin,
  feet: string[],
  anchors: ReadonlyMap<string, THREE.Vector3>,
): void {
  const p = new THREE.Vector3();
  let dx = 0;
  let dz = 0;
  let n = 0;
  for (const id of feet) {
    const anchor = anchors.get(id);
    const node = m.bones.get(id);
    if (!anchor || !node) continue;
    const box = new THREE.Box3().setFromObject(node);
    if (!Number.isFinite(box.min.y) || box.min.y > PLANTED_MAX_Y) continue; // swing foot
    node.getWorldPosition(p);
    dx += anchor.x - p.x;
    dz += anchor.z - p.z;
    n++;
  }
  if (n > 0) {
    m.root.position.x += dx / n;
    m.root.position.z += dz / n;
    m.root.updateMatrixWorld(true);
  }
}
