/** Semantic contact-orientation helpers shared by viewer and eval. */
import * as THREE from "three";
import { eulerRomFor, type PinTarget, type ReachTarget } from "posecode-parser";
import type { Mannequin } from "./mannequin.js";

const DOWN = new THREE.Vector3(0, -1, 0);
const DEG = Math.PI / 180;

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

const SOLE_LOCAL = new THREE.Vector3(0, -1, 0);
/** Foot mesh-bottom height at/below which the sole is fully leveled (m). */
export const PLANT_FADE = 0.06;
/** Authored plantarflex (ankle local +X) beyond this opts out of leveling (rad). */
export const PLANTARFLEX_SKIP = 15 * DEG;

const FOOT_SIDES: Array<"left" | "right"> = ["left", "right"];
const TMP_EULER = new THREE.Euler();

/**
 * Level each ground-locked foot: rotate the ankle so the sole normal points
 * world-down (the whole sole rests flat), weighted by how planted the foot is
 * and skipped when the ankle is authored into plantarflexion (tiptoe intent).
 * The plantigrade analogue of `alignFloorPalms` for feet: it fixes the
 * squat/lunge "balancing on the toes" artifact that ground-lock alone leaves,
 * where a leg-induced foot tilt makes the ball the lowest mesh point.
 */
export function levelPlantedFeet(m: Mannequin, activeGroundLock: readonly string[]): void {
  if (!activeGroundLock.includes("feet")) return;
  let changed = false;
  for (const side of FOOT_SIDES) {
    const ankle = m.bones.get(`ankle_${side}`);
    if (!ankle?.parent) continue;
    // Tiptoe opt-out: an ankle authored into plantarflexion (local +X) is a
    // deliberate relevé / calf-raise / demi-plié — leave it on its toes.
    TMP_EULER.setFromQuaternion(ankle.quaternion, "XYZ");
    const authoredX = TMP_EULER.x;
    const authoredZ = TMP_EULER.z;
    if (authoredX > PLANTARFLEX_SKIP) continue;
    // Planted-ness weight from the foot mesh bottom height: fully level when the
    // sole is on the floor, fading out as a swing foot lifts past PLANT_FADE.
    const box = new THREE.Box3().setFromObject(ankle);
    const y = Number.isFinite(box.min.y) ? box.min.y : 0;
    const weight = THREE.MathUtils.clamp((PLANT_FADE - y) / PLANT_FADE, 0, 1);
    if (weight <= 1e-3) continue;
    // Minimal rotation aligning the sole normal to world-down (preserves yaw).
    const world = ankle.getWorldQuaternion(new THREE.Quaternion());
    const current = SOLE_LOCAL.clone().applyQuaternion(world).normalize();
    const correction = new THREE.Quaternion().setFromUnitVectors(current, DOWN);
    if (weight < 1) correction.slerp(new THREE.Quaternion(), 1 - weight);
    const desiredWorld = correction.multiply(world);
    const parentWorld = ankle.parent.getWorldQuaternion(new THREE.Quaternion());
    const local = parentWorld.invert().multiply(desiredWorld);
    // Clamp the corrected ankle to its ROM, widened to admit the authored angle
    // so leveling can never push the joint past a healthy range.
    const rom = eulerRomFor(`ankle_${side}`);
    if (rom) {
      TMP_EULER.setFromQuaternion(local, "XYZ");
      const cx = THREE.MathUtils.clamp(
        TMP_EULER.x,
        Math.min(rom.x.min * DEG, authoredX),
        Math.max(rom.x.max * DEG, authoredX),
      );
      const cz = THREE.MathUtils.clamp(
        TMP_EULER.z,
        Math.min(rom.z.min * DEG, authoredZ),
        Math.max(rom.z.max * DEG, authoredZ),
      );
      TMP_EULER.set(cx, TMP_EULER.y, cz, "XYZ");
      local.setFromEuler(TMP_EULER);
    }
    ankle.quaternion.copy(local);
    changed = true;
  }
  if (changed) m.root.updateMatrixWorld(true);
}
