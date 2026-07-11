/** Semantic contact-orientation helpers shared by viewer and eval. */
import * as THREE from "three";
import type { PinTarget, ReachTarget } from "posecode-parser";
import type { Mannequin } from "./mannequin.js";

const DOWN = new THREE.Vector3(0, -1, 0);
const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, 1);

function contactSides(
  reaches: readonly ReachTarget[],
  pins: readonly PinTarget[],
  target: (name: string) => boolean,
  kind: "hand" | "foot",
): Set<"left" | "right"> {
  const sides = new Set<"left" | "right">();
  const collect = (effector: string, name: string) => {
    if (!target(name)) return;
    const group = kind === "hand" ? "hands" : "feet";
    if (effector === group || effector === `${kind}_left`) sides.add("left");
    if (effector === group || effector === `${kind}_right`) sides.add("right");
  };
  reaches.forEach((r) => collect(r.effector, r.target));
  pins.forEach((p) => collect(p.effector, p.anchor));
  return sides;
}

/** Set a bone's world orientation while preserving the rest of its chain. */
function setWorldQuaternion(node: THREE.Object3D, desiredWorld: THREE.Quaternion): void {
  if (!node.parent) return;
  const parentWorld = node.parent.getWorldQuaternion(new THREE.Quaternion());
  node.quaternion.copy(parentWorld.invert().multiply(desiredWorld));
}

/** Rotate contacting wrists so the palm face normal points into the floor. */
export function alignFloorPalms(
  m: Mannequin,
  reaches: readonly ReachTarget[],
  pins: readonly PinTarget[],
): void {
  const sides = contactSides(reaches, pins, (target) => target === "floor", "hand");

  for (const side of sides) {
    const wrist = m.bones.get(`wrist_${side}`);
    if (!wrist?.parent) continue;
    const world = wrist.getWorldQuaternion(new THREE.Quaternion());
    const localNormal = side === "left"
      ? new THREE.Vector3(1, 0, 0)
      : new THREE.Vector3(-1, 0, 0);
    const current = localNormal.applyQuaternion(world).normalize();
    const correction = new THREE.Quaternion().setFromUnitVectors(current, DOWN);
    const desiredWorld = correction.multiply(world);
    setWorldQuaternion(wrist, desiredWorld);
  }
  if (sides.size > 0) m.root.updateMatrixWorld(true);
}

/**
 * Keep contacting feet flat and facing with the body. The ankle joint remains
 * in place, so hip/knee motion and weight shift are preserved; only the sole's
 * terminal orientation is corrected.
 */
export function alignFloorSoles(
  m: Mannequin,
  groundLock: readonly string[],
  reaches: readonly ReachTarget[] = [],
  pins: readonly PinTarget[] = [],
): void {
  const sides = contactSides(reaches, pins, (target) => target === "floor", "foot");
  if (groundLock.includes("feet")) {
    sides.add("left");
    sides.add("right");
  }
  if (sides.size === 0) return;

  const rootForward = FORWARD.clone().applyQuaternion(
    m.root.getWorldQuaternion(new THREE.Quaternion()),
  );
  rootForward.y = 0;
  if (rootForward.lengthSq() < 1e-8) rootForward.copy(FORWARD);
  rootForward.normalize();
  const worldX = UP.clone().cross(rootForward).normalize();
  const desiredWorld = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(worldX, UP, rootForward),
  );
  for (const side of sides) {
    const ankle = m.bones.get(`ankle_${side}`);
    if (ankle) setWorldQuaternion(ankle, desiredWorld);
  }
  m.root.updateMatrixWorld(true);
}

/**
 * Orient bar-contacting wrists as an overhand grip: fingers point up toward
 * the bar and the palm faces away from the body. Finger curl remains authored
 * independently, so this composes with grip strength / release animation.
 */
export function alignBarGrips(
  m: Mannequin,
  reaches: readonly ReachTarget[],
  pins: readonly PinTarget[],
): void {
  const sides = contactSides(reaches, pins, (target) => target === "bar", "hand");
  for (const side of sides) {
    const wrist = m.bones.get(`wrist_${side}`);
    if (!wrist) continue;
    // Local palm normal is mirrored X; local -Y follows wrist→fingers.
    const worldX = side === "left" ? FORWARD.clone() : FORWARD.clone().negate();
    const worldY = UP.clone().negate();
    const worldZ = worldX.clone().cross(worldY).normalize();
    const desiredWorld = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(worldX, worldY, worldZ),
    );
    setWorldQuaternion(wrist, desiredWorld);
  }
  if (sides.size > 0) m.root.updateMatrixWorld(true);
}
