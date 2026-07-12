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

/**
 * Relaxed resting finger curl (radians) for an idle hand in the air. A truly
 * relaxed hand is not flat: the fingers settle into a soft inward hook (~30°),
 * which reads as a natural cupped hand instead of a stiff splayed palm.
 */
export const REST_CURL = 0.55;
/** Slight finger adduction (radians) drawing splayed digits toward the middle
 * finger, so a relaxed hand closes softly rather than fanning like jazz-hands. */
export const REST_ADDUCT = 0.12;
/**
 * Near-flat curl (radians) for a hand pressed onto the floor (plank, push-up,
 * cobra). The palm lies flat with the fingers extended forward; the resting
 * inward hook would instead claw the fingertips into the ground.
 */
export const FLOOR_CURL = 0.06;

/**
 * Give idle hands a natural relaxed shape instead of a flat splayed palm.
 * Applied every frame to any hand that is NOT gripping this phase (those are
 * wrapped by `wrapGrip`) and whose fingers are NOT explicitly authored
 * (make-a-fist, finger-spell, hand-wave keep their pose).
 *
 * Two resting shapes by context:
 * - **Free hand** (arms swinging, a crunch, hands by the hips): a soft inward
 *   hook with the fingers drawn slightly together — a relaxed cupped hand.
 * - **Floor-planted hand** (`reach`/`pin: hands floor`): fingers stay extended
 *   and flat so the palm rests on the ground instead of clawing into it.
 *
 * A mesh-only-style aliveness layer: it writes only finger-bone locals, so it
 * can never disturb the solved pose.
 */
export function relaxHands(
  m: Mannequin,
  gripSides: ReadonlySet<"left" | "right">,
  authoredFingers: ReadonlySet<string>,
  floorSides: ReadonlySet<"left" | "right"> = new Set(),
): void {
  let changed = false;
  for (const side of ["left", "right"] as const) {
    if (gripSides.has(side)) continue;
    const planted = floorSides.has(side);
    const curl = planted ? FLOOR_CURL : REST_CURL;
    // Adduction sign: fingers on each hand draw toward the middle, i.e. toward
    // the thumb side, which is +Z on the left hand and -Z on the right.
    const adduct = planted ? 0 : side === "left" ? REST_ADDUCT : -REST_ADDUCT;
    for (const f of FINGERS) {
      const id = `${f}_${side}`;
      if (authoredFingers.has(id)) continue;
      const bone = m.bones.get(id);
      if (bone) {
        bone.rotation.set(curl, 0, adduct);
        changed = true;
      }
    }
    const thumbId = `thumb_${side}`;
    if (!authoredFingers.has(thumbId)) {
      const thumb = m.bones.get(thumbId);
      if (thumb) {
        // Planted: thumb lies alongside the flat palm. Free: opposes softly.
        const thumbCurl = planted ? FLOOR_CURL : REST_CURL * 0.6;
        const thumbOppose = planted ? 0 : REST_CURL;
        thumb.rotation.set(thumbCurl, 0, side === "left" ? -thumbOppose : thumbOppose);
        changed = true;
      }
    }
  }
  if (changed) m.root.updateMatrixWorld(true);
}

/** Fraction of the contralateral hip's sagittal angle carried into arm swing. */
export const SWING_GAIN = 0.4;
const SWING_EULER = new THREE.Euler();
const HIP_EULER = new THREE.Euler();

/**
 * Contralateral arm swing: during locomotion the arms counter-swing to the legs
 * (right leg forward ↔ left arm forward). Adds a swing to each free shoulder
 * proportional to the OPPOSITE hip's sagittal (local X) angle, so any move that
 * animates the hips (walk, march, box-step) gets natural arm swing for free.
 * Skips shoulders the document authors and any gripping side.
 */
export function swingArms(
  m: Mannequin,
  authoredShoulders: ReadonlySet<string>,
  gripSides: ReadonlySet<"left" | "right">,
): void {
  let changed = false;
  for (const side of ["left", "right"] as const) {
    if (gripSides.has(side)) continue;
    const shoulderId = `shoulder_${side}`;
    if (authoredShoulders.has(shoulderId)) continue;
    const shoulder = m.bones.get(shoulderId);
    const contraHip = m.bones.get(`hip_${side === "left" ? "right" : "left"}`);
    if (!shoulder || !contraHip) continue;
    HIP_EULER.setFromQuaternion(contraHip.quaternion, "XYZ");
    if (Math.abs(HIP_EULER.x) < 1e-3) continue; // legs still → no swing
    SWING_EULER.setFromQuaternion(shoulder.quaternion, "XYZ");
    // This pass runs every render frame. Assign the procedural channel instead
    // of adding to last frame's result, otherwise an unauthored shoulder keeps
    // accumulating rotation (most visibly the left arm in a forward lunge).
    SWING_EULER.x = HIP_EULER.x * SWING_GAIN;
    shoulder.quaternion.setFromEuler(SWING_EULER);
    changed = true;
  }
  if (changed) m.root.updateMatrixWorld(true);
}

/** Max head turn toward a look target (radians) so the neck never over-rotates. */
export const MAX_LOOK = 55 * (Math.PI / 180);
const LOOK_FWD = new THREE.Vector3(0, 0, 1);

/**
 * Turn the head toward a world focus point (look-at): aims the face (+Z) at the
 * target, clamped to MAX_LOOK so the head tracks the action (up at the bar in a
 * pull-up, down at the hands in a floor fold) without spinning unnaturally.
 */
export function aimHead(m: Mannequin, focus: THREE.Vector3): void {
  const head = m.bones.get("head");
  if (!head?.parent) return;
  const headPos = head.getWorldPosition(new THREE.Vector3());
  const desired = focus.clone().sub(headPos);
  if (desired.lengthSq() < 1e-6) return;
  desired.normalize();
  const world = head.getWorldQuaternion(new THREE.Quaternion());
  const currentZ = LOOK_FWD.clone().applyQuaternion(world).normalize();
  const full = new THREE.Quaternion().setFromUnitVectors(currentZ, desired);
  const angle = 2 * Math.acos(THREE.MathUtils.clamp(Math.abs(full.w), -1, 1));
  const correction =
    angle > MAX_LOOK
      ? new THREE.Quaternion().slerpQuaternions(new THREE.Quaternion(), full, MAX_LOOK / angle)
      : full;
  const desiredWorld = correction.multiply(world);
  const parentWorld = head.parent.getWorldQuaternion(new THREE.Quaternion());
  head.quaternion.copy(parentWorld.invert().multiply(desiredWorld));
  m.root.updateMatrixWorld(true);
}
