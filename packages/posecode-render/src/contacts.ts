/** Semantic contact-orientation helpers shared by viewer and eval. */
import * as THREE from "three";
import { eulerRomFor, type PinTarget, type ReachTarget, type GripTarget } from "posecode-parser";
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

/** Finger curl (radians about the knuckle X axis) that wraps a gripping hand. */
export const FINGER_CURL = 1.35;
/** Thumb opposition curl (radians) toward the fingers. */
export const THUMB_CURL = 0.9;
const FINGERS = ["index", "middle", "ring", "pinky"] as const;

/**
 * Curl the fingers of each gripping hand around the bar. Grips are per-side
 * after resolution (`hand_left` / `hand_right`), so the side comes straight off
 * the effector. The four fingers flex at the knuckle and the thumb opposes,
 * turning the open reach pose into a closed grip on the bar.
 */
export function wrapGrip(m: Mannequin, grips: readonly GripTarget[]): void {
  let changed = false;
  for (const g of grips) {
    const side = /_(left|right)$/.exec(g.effector)?.[1];
    if (!side) continue;
    for (const f of FINGERS) {
      const bone = m.bones.get(`${f}_${side}`);
      if (bone) {
        bone.rotation.set(FINGER_CURL, 0, 0);
        changed = true;
      }
    }
    const thumb = m.bones.get(`thumb_${side}`);
    if (thumb) {
      // Thumb wraps from the opposite side: curl plus a sideways opposition.
      thumb.rotation.set(THUMB_CURL, 0, side === "left" ? -THUMB_CURL : THUMB_CURL);
      changed = true;
    }
  }
  if (changed) m.root.updateMatrixWorld(true);
}

/** Relaxed resting finger curl (radians) for an idle hand. */
export const REST_CURL = 0.32;

/**
 * Give idle hands a natural relaxed curl instead of a flat splayed palm. Applied
 * every frame to any hand that is NOT gripping this phase (those are wrapped by
 * `wrapGrip`) and whose fingers are NOT explicitly authored (make-a-fist,
 * finger-spell, hand-wave keep their pose). A mesh-only-style aliveness layer:
 * it writes only finger-bone locals, so it can never disturb the solved pose.
 */
export function relaxHands(
  m: Mannequin,
  gripSides: ReadonlySet<"left" | "right">,
  authoredFingers: ReadonlySet<string>,
): void {
  let changed = false;
  for (const side of ["left", "right"] as const) {
    if (gripSides.has(side)) continue;
    for (const f of FINGERS) {
      const id = `${f}_${side}`;
      if (authoredFingers.has(id)) continue;
      const bone = m.bones.get(id);
      if (bone) {
        bone.rotation.set(REST_CURL, 0, 0);
        changed = true;
      }
    }
    const thumbId = `thumb_${side}`;
    if (!authoredFingers.has(thumbId)) {
      const thumb = m.bones.get(thumbId);
      if (thumb) {
        thumb.rotation.set(REST_CURL * 0.6, 0, side === "left" ? -REST_CURL : REST_CURL);
        changed = true;
      }
    }
  }
  if (changed) m.root.updateMatrixWorld(true);
}
