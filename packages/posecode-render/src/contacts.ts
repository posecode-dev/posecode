/** Semantic contact-orientation helpers shared by viewer and eval. */
import * as THREE from "three";
import type { PinTarget, ReachTarget } from "posecode-parser";
import type { Mannequin } from "./mannequin.js";

const DOWN = new THREE.Vector3(0, -1, 0);

/** Rotate contacting wrists so the palm face normal points into the floor. */
export function alignFloorPalms(
  m: Mannequin,
  reaches: readonly ReachTarget[],
  pins: readonly PinTarget[],
): void {
  const sides = new Set<"left" | "right">();
  const collect = (effector: string, target: string) => {
    if (target !== "floor") return;
    if (effector === "hands" || effector === "hand_left") sides.add("left");
    if (effector === "hands" || effector === "hand_right") sides.add("right");
  };
  reaches.forEach((r) => collect(r.effector, r.target));
  pins.forEach((p) => collect(p.effector, p.anchor));

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
    const parentWorld = wrist.parent.getWorldQuaternion(new THREE.Quaternion());
    wrist.quaternion.copy(parentWorld.invert().multiply(desiredWorld));
  }
  if (sides.size > 0) m.root.updateMatrixWorld(true);
}
