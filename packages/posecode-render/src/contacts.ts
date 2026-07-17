/** Semantic contact-orientation helpers shared by viewer and eval. */
import * as THREE from "three";
import { eulerRomFor, type PinTarget, type ReachTarget, type GripTarget } from "posecode-parser";
import type { Mannequin } from "./mannequin.js";
import { effectorBoneId } from "./reach.js";

const DOWN = new THREE.Vector3(0, -1, 0);
const FOREARM_AXIS = new THREE.Vector3(0, 1, 0);
const DEG = Math.PI / 180;
/** Strong palm-down cone with 10° margin inside eval's 55° contact limit. */
const PALM_DOWN_TARGET_DOT = Math.cos(45 * DEG);
/** Natural outward travel as an arm straightens toward an unconstrained floor. */
const HAND_FLOOR_OUTSET = 0.04;
const CONTACT_EULER = new THREE.Euler();

export type HandSide = "left" | "right";
export type HandContactKind = "palm" | "fist";

/**
 * Actual outward normal of the flattened procedural palm geometry. The palm
 * ellipsoid is shallow on local Z for both hands (see mannequin.addPalm).
 */
export const PALM_LOCAL_NORMAL = [0, 0, 1] as const;
/** Knuckle-bearing direction from wrist to the curled finger bases. */
export const FIST_LOCAL_NORMAL = [0, -1, 0] as const;

function strictClampToRom(node: THREE.Object3D, boneId: string): boolean {
  const rom = eulerRomFor(boneId);
  if (!rom) return false;
  CONTACT_EULER.setFromQuaternion(node.quaternion, "XYZ");
  const x = THREE.MathUtils.clamp(CONTACT_EULER.x, rom.x.min * DEG, rom.x.max * DEG);
  const y = THREE.MathUtils.clamp(CONTACT_EULER.y, rom.y.min * DEG, rom.y.max * DEG);
  const z = THREE.MathUtils.clamp(CONTACT_EULER.z, rom.z.min * DEG, rom.z.max * DEG);
  if (
    Math.abs(x - CONTACT_EULER.x) < 1e-10 &&
    Math.abs(y - CONTACT_EULER.y) < 1e-10 &&
    Math.abs(z - CONTACT_EULER.z) < 1e-10
  ) return false;
  CONTACT_EULER.set(x, y, z, "XYZ");
  node.quaternion.setFromEuler(CONTACT_EULER);
  return true;
}

/**
 * Final safety assertion for renderer-authored terminal corrections. It is
 * intentionally limited to wrists/ankles: timeline hip counter-rotation for a
 * pelvis hinge may legitimately sit outside a raw isolated hip box, whereas
 * contact wrist and ankle locals have no such coupled exception. All three
 * ankle axes are clamped, including the normally locked Y/Z axes.
 */
export function enforceContactRom(m: Mannequin): void {
  let changed = false;
  for (const side of ["left", "right"] as const) {
    for (const joint of [`wrist_${side}`, `ankle_${side}`]) {
      const node = m.bones.get(joint);
      if (node) changed = strictClampToRom(node, joint) || changed;
    }
  }
  if (changed) m.root.updateMatrixWorld(true);
}

function alignWristNormal(
  m: Mannequin,
  side: HandSide,
  normal: readonly [number, number, number],
  weight: number,
): boolean {
  const wristId = `wrist_${side}`;
  const wrist = m.bones.get(wristId);
  if (!wrist?.parent) return false;
  const world = wrist.getWorldQuaternion(new THREE.Quaternion());
  const current = new THREE.Vector3(...normal).applyQuaternion(world).normalize();
  const correction = new THREE.Quaternion().setFromUnitVectors(current, DOWN);
  const safeWeight = THREE.MathUtils.clamp(weight, 0, 1);
  if (safeWeight < 1) {
    correction.slerp(new THREE.Quaternion(), 1 - safeWeight);
  }
  const desiredWorld = correction.multiply(world);
  const parentWorld = wrist.parent.getWorldQuaternion(new THREE.Quaternion());
  wrist.quaternion.copy(parentWorld.invert().multiply(desiredWorld));
  // Contact correction is never allowed to buy contact with a broken wrist.
  strictClampToRom(wrist, wristId);
  return true;
}

function quaternionIsInRom(q: THREE.Quaternion, boneId: string): boolean {
  const rom = eulerRomFor(boneId);
  if (!rom) return false;
  const euler = new THREE.Euler().setFromQuaternion(q, "XYZ");
  // CCD and world/local quaternion round-trips can leave locked axes a few
  // ten-thousandths of a degree off zero. Treat that as numerical noise, not
  // an authored ROM violation that disables the whole contact solver.
  const epsilon = 1e-4;
  return (
    euler.x >= rom.x.min * DEG - epsilon && euler.x <= rom.x.max * DEG + epsilon &&
    euler.y >= rom.y.min * DEG - epsilon && euler.y <= rom.y.max * DEG + epsilon &&
    euler.z >= rom.z.min * DEG - epsilon && euler.z <= rom.z.max * DEG + epsilon
  );
}

/**
 * Find the legal forearm-axis twist that gives the wrist the best attainable
 * palm-down frame. A post-multiplied local-Y twist leaves the elbow→wrist
 * offset ([0,-length,0]) unchanged, so this can re-orient a planted palm
 * without pulling its solved contact point away from the floor target.
 */
function bestPalmForearmTwist(m: Mannequin, side: HandSide): number | null {
  const elbowId = `elbow_${side}`;
  const wristId = `wrist_${side}`;
  const elbow = m.bones.get(elbowId);
  const wrist = m.bones.get(wristId);
  const wristRom = eulerRomFor(wristId);
  if (!elbow?.parent || wrist?.parent !== elbow || !wristRom) return null;

  m.root.updateMatrixWorld(true);
  const elbowParentWorld = elbow.parent.getWorldQuaternion(new THREE.Quaternion());
  const authoredElbow = elbow.quaternion.clone();
  const authoredWrist = wrist.quaternion.clone();
  const twist = new THREE.Quaternion();
  const candidateElbow = new THREE.Quaternion();
  const elbowWorld = new THREE.Quaternion();
  const wristWorld = new THREE.Quaternion();
  const correction = new THREE.Quaternion();
  const desiredWorld = new THREE.Quaternion();
  const desiredLocal = new THREE.Quaternion();
  const clampedWrist = new THREE.Quaternion();
  const finalWorld = new THREE.Quaternion();
  const wristEuler = new THREE.Euler();
  const candidateEuler = new THREE.Euler();
  const currentNormal = new THREE.Vector3();
  const finalNormal = new THREE.Vector3();
  const authoredEuler = new THREE.Euler().setFromQuaternion(authoredElbow, "XYZ");
  const desiredSupinationY = (side === "left" ? 1 : -1) * Math.abs(authoredEuler.y);

  const score = (radians: number): number | null => {
    twist.setFromAxisAngle(FOREARM_AXIS, radians);
    candidateElbow.copy(authoredElbow).multiply(twist);
    if (!quaternionIsInRom(candidateElbow, elbowId)) return null;

    elbowWorld.copy(elbowParentWorld).multiply(candidateElbow);
    wristWorld.copy(elbowWorld).multiply(authoredWrist);
    currentNormal.set(...PALM_LOCAL_NORMAL).applyQuaternion(wristWorld).normalize();
    correction.setFromUnitVectors(currentNormal, DOWN);
    desiredWorld.copy(correction).multiply(wristWorld);
    desiredLocal.copy(elbowWorld).invert().multiply(desiredWorld);

    // Simulate the exact wrist correction and hard ROM clamp used below. The
    // search therefore prefers a forearm twist the real wrist can finish.
    wristEuler.setFromQuaternion(desiredLocal, "XYZ");
    wristEuler.set(
      THREE.MathUtils.clamp(wristEuler.x, wristRom.x.min * DEG, wristRom.x.max * DEG),
      THREE.MathUtils.clamp(wristEuler.y, wristRom.y.min * DEG, wristRom.y.max * DEG),
      THREE.MathUtils.clamp(wristEuler.z, wristRom.z.min * DEG, wristRom.z.max * DEG),
      "XYZ",
    );
    clampedWrist.setFromEuler(wristEuler);
    finalWorld.copy(elbowWorld).multiply(clampedWrist);
    finalNormal.set(...PALM_LOCAL_NORMAL).applyQuaternion(finalWorld).normalize();
    return finalNormal.dot(DOWN);
  };

  let bestRadians = 0;
  let bestScore = score(0) ?? -Infinity;
  // Most palms need only the cheap wrist correction. In particular this keeps
  // plank/mountain-climber geometry unchanged and avoids a search per frame.
  if (bestScore >= PALM_DOWN_TARGET_DOT) return 0;
  let targetRadians: number | null = null;
  let targetYDistance = Infinity;
  const consider = (radians: number): void => {
    const candidateScore = score(radians);
    if (candidateScore === null) return;
    const scoreGain = candidateScore - bestScore;
    if (scoreGain > 1e-9 || (Math.abs(scoreGain) <= 1e-9 && Math.abs(radians) < Math.abs(bestRadians))) {
      bestScore = candidateScore;
      bestRadians = radians;
    }
    // A declared palm-floor contact overrides incompatible pronation with the
    // corresponding anatomical supination frame. Prefer that semantic mirror
    // over a mathematical maximum at the extreme edge of the ROM box.
    candidateEuler.setFromQuaternion(candidateElbow, "XYZ");
    const isSupinationHalf = side === "left" ? candidateEuler.y >= -1e-6 : candidateEuler.y <= 1e-6;
    const yDistance = Math.abs(candidateEuler.y - desiredSupinationY);
    if (candidateScore >= PALM_DOWN_TARGET_DOT && isSupinationHalf && yDistance < targetYDistance) {
      targetYDistance = yDistance;
      targetRadians = radians;
    }
  };

  // Coarse global search handles authored full pronation (±80°), whose
  // palm-down solution can lie roughly 160° away at the opposite ROM edge.
  const coarseStep = 5 * DEG;
  for (let radians = -Math.PI; radians <= Math.PI + 1e-8; radians += coarseStep) {
    consider(Math.min(Math.PI, radians));
  }
  // Refine locally so the semantic supination mirror is not quantized to the
  // coarse search step.
  const coarseBest = targetRadians ?? bestRadians;
  const fineStep = 0.25 * DEG;
  for (let radians = coarseBest - coarseStep; radians <= coarseBest + coarseStep + 1e-8; radians += fineStep) {
    consider(THREE.MathUtils.clamp(radians, -Math.PI, Math.PI));
  }
  return Number.isFinite(bestScore) ? targetRadians ?? bestRadians : null;
}

function alignPalmNormal(m: Mannequin, side: HandSide, weight: number): boolean {
  const elbowId = `elbow_${side}`;
  const elbow = m.bones.get(elbowId);
  const bestTwist = bestPalmForearmTwist(m, side);
  if (!elbow || bestTwist === null) {
    return alignWristNormal(m, side, PALM_LOCAL_NORMAL, weight);
  }

  const safeWeight = THREE.MathUtils.clamp(weight, 0, 1);
  const weightedTwist = new THREE.Quaternion().setFromAxisAngle(
    FOREARM_AXIS,
    bestTwist * safeWeight,
  );
  const candidate = elbow.quaternion.clone().multiply(weightedTwist);
  // Both endpoints of the interpolation are legal in normal operation. Keep a
  // defensive fallback for unusual imported rigs/Euler singularities without
  // ever clamping the elbow in a way that could move the wrist endpoint.
  if (quaternionIsInRom(candidate, elbowId)) elbow.quaternion.copy(candidate);
  m.root.updateMatrixWorld(true);
  return alignWristNormal(m, side, PALM_LOCAL_NORMAL, weight);
}

function collectFloorHandContacts(
  reaches: readonly (ReachTarget & { weight?: number })[],
  pins: readonly PinTarget[],
  groundLock: readonly string[],
): Map<HandSide, { kind: HandContactKind; weight: number }> {
  const contacts = new Map<HandSide, { kind: HandContactKind; weight: number }>();
  const collect = (effector: string, target: string, weight = 1): void => {
    if (target !== "floor") return;
    const fistMatch = /^fist_(left|right)$/.exec(effector);
    const palmMatch = /^(?:hand|wrist)_(left|right)$/.exec(effector);
    const isFist = effector === "fists" || Boolean(fistMatch);
    const isPalm = effector === "hands" || Boolean(palmMatch);
    if (!isFist && !isPalm) return;
    const kind: HandContactKind = isFist ? "fist" : "palm";
    const add = (side: HandSide): void => {
      const previous = contacts.get(side);
      // An explicit fist wins over a simultaneous generic hand contact.
      if (!previous || kind === "fist" || previous.kind !== "fist") {
        contacts.set(side, {
          kind,
          weight: Math.max(previous?.weight ?? 0, weight),
        });
      }
    };
    if (effector === "hands" || effector === "fists" || fistMatch?.[1] === "left" || palmMatch?.[1] === "left") add("left");
    if (effector === "hands" || effector === "fists" || fistMatch?.[1] === "right" || palmMatch?.[1] === "right") add("right");
  };
  reaches.forEach((r) => collect(r.effector, r.target, r.weight));
  pins.forEach((p) => collect(p.effector, p.anchor));
  groundLock.forEach((effector) => collect(effector, "floor"));
  return contacts;
}

/**
 * Orient floor contacts by their real geometry: a palm presents its flattened
 * +Z face, while a fist presents the wrist→knuckle (-Y) direction. The two are
 * intentionally distinct. Palm contacts may also redistribute orientation
 * into a legal forearm-axis twist; fists remain wrist-only so knuckle and grip
 * semantics are unaffected. Every wrist correction is strict-ROM-clamped.
 */
export function alignFloorContacts(
  m: Mannequin,
  reaches: readonly (ReachTarget & { weight?: number })[],
  pins: readonly PinTarget[],
  groundLock: readonly string[] = [],
): void {
  const contacts = collectFloorHandContacts(reaches, pins, groundLock);
  let changed = false;
  for (const [side, contact] of contacts) {
    changed = contact.kind === "palm"
      ? alignPalmNormal(m, side, contact.weight) || changed
      : alignWristNormal(m, side, FIST_LOCAL_NORMAL, contact.weight) || changed;
  }
  if (changed) m.root.updateMatrixWorld(true);
}

/** Backwards-compatible name retained for eval/embedders; now handles fists too. */
export function alignFloorPalms(
  m: Mannequin,
  reaches: readonly (ReachTarget & { weight?: number })[],
  pins: readonly PinTarget[],
  groundLock: readonly string[] = [],
): void {
  alignFloorContacts(m, reaches, pins, groundLock);
}

/**
 * Bone-origin target whose corresponding visible contact surface rests on y=0.
 * Joint effectors (knee/elbow) use their local contact radius instead of the
 * whole descendant subtree—otherwise a knee target incorrectly measures the
 * shin/foot and folds the knee upward while still claiming floor contact.
 */
export function floorTargetForEffector(
  m: Mannequin,
  effectorName: string,
): THREE.Vector3 | null {
  const effector = m.bones.get(effectorBoneId(effectorName));
  if (!effector) return null;
  const p = effector.getWorldPosition(new THREE.Vector3());
  if (effectorName === "pelvis") {
    p.y = pelvisFloorDrop(m);
    return p;
  }
  if (effectorName.startsWith("knee_")) {
    // Measure only the two rounded caps meeting at the knee. A subtree would
    // wrongly include the whole shin/foot, while a fixed proxy radius misses
    // the vertical extent as the bent limb changes orientation.
    const side = effectorName.endsWith("_left") ? "left" : "right";
    p.y = jointSurfaceDrop(
      m,
      `knee_${side}`,
      m.contactSurfaces[`knee_${side}`],
      Math.max(m.collision.shin, m.collision.thigh),
    );
    return p;
  }
  if (effectorName.startsWith("elbow_")) {
    p.y = m.collision.arm;
    return p;
  }
  // Fists are fixed knuckle contacts (e.g. superhero landing), not sliding
  // open palms, so they deliberately retain their authored X/Z target.
  const handMatch = /^(?:hand|wrist)_(left|right)$/.exec(effectorName);
  if (handMatch) {
    // A floor is an infinite contact plane, not a fixed X/Z landmark. Lowering
    // a nearly straight arm naturally carries the hand a few centimetres away
    // from the shoulder; targeting the wrist's old vertical projection makes
    // safe elbow ROM miss Cobra's otherwise reachable landing point.
    const shoulder = m.bones.get(`shoulder_${handMatch[1]}`);
    if (shoulder) {
      const shoulderPosition = shoulder.getWorldPosition(new THREE.Vector3());
      const outward = new THREE.Vector3(
        p.x - shoulderPosition.x,
        0,
        p.z - shoulderPosition.z,
      );
      if (outward.lengthSq() > 1e-8) p.add(outward.normalize().multiplyScalar(HAND_FLOOR_OUTSET));
    }
  }
  const box = new THREE.Box3().setFromObject(effector);
  p.y = Number.isFinite(box.min.y) ? Math.max(0, p.y - box.min.y) : 0;
  return p;
}

/** Signed height of an effector's actual contact surface above the floor. */
export function floorContactHeight(m: Mannequin, effectorName: string): number | null {
  const effector = m.bones.get(effectorBoneId(effectorName));
  if (!effector) return null;
  const originY = effector.getWorldPosition(new THREE.Vector3()).y;
  if (effectorName.startsWith("elbow_")) return originY - m.collision.arm;
  if (effectorName.startsWith("knee_")) {
    const side = effectorName.endsWith("_left") ? "left" : "right";
    return originY - jointSurfaceDrop(
      m,
      `knee_${side}`,
      m.contactSurfaces[`knee_${side}`],
      Math.max(m.collision.shin, m.collision.thigh),
    );
  }
  if (effectorName === "pelvis") return originY - pelvisFloorDrop(m);
  const minY = new THREE.Box3().setFromObject(effector).min.y;
  return Number.isFinite(minY) ? minY : null;
}

function jointSurfaceDrop(
  m: Mannequin,
  boneId: string,
  surfaces: readonly THREE.Object3D[],
  fallback: number,
): number {
  const bone = m.bones.get(boneId);
  if (!bone) return fallback;
  const originY = bone.getWorldPosition(new THREE.Vector3()).y;
  let minY = Infinity;
  for (const surface of surfaces) {
    const y = new THREE.Box3().setFromObject(surface).min.y;
    if (Number.isFinite(y)) minY = Math.min(minY, y);
  }
  return Number.isFinite(minY) ? Math.max(0.001, originY - minY) : fallback;
}

/** Current trunk-surface drop below the pelvis origin (translation invariant). */
function pelvisFloorDrop(m: Mannequin): number {
  const pelvis = m.bones.get("pelvis");
  if (!pelvis) return Math.max(0.08, m.collision.torso * 0.85);
  const originY = pelvis.getWorldPosition(new THREE.Vector3()).y;
  let minY = Infinity;
  for (const surface of m.contactSurfaces.pelvis) {
    const y = new THREE.Box3().setFromObject(surface).min.y;
    if (Number.isFinite(y)) minY = Math.min(minY, y);
  }
  return Number.isFinite(minY)
    ? Math.max(0.08, originY - minY)
    : Math.max(0.08, m.collision.torso * 0.85);
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
  const plantedSides = FOOT_SIDES.filter((side) =>
    activeGroundLock.includes("feet") || activeGroundLock.includes(`foot_${side}`),
  );
  if (plantedSides.length === 0) return;
  let changed = false;
  for (const side of plantedSides) {
    const ankle = m.bones.get(`ankle_${side}`);
    if (!ankle?.parent) continue;
    // Tiptoe opt-out: an ankle authored into plantarflexion (local +X) is a
    // deliberate relevé / calf-raise / demi-plié — leave it on its toes.
    TMP_EULER.setFromQuaternion(ankle.quaternion, "XYZ");
    const authoredX = TMP_EULER.x;
    if (authoredX > PLANTARFLEX_SKIP) {
      // Preserve deliberate tiptoe pitch, but still assert the ankle's locked
      // axial/frontal axes and configured plantarflexion ceiling.
      changed = strictClampToRom(ankle, `ankle_${side}`) || changed;
      continue;
    }
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
    ankle.quaternion.copy(local);
    // Clamp X/Y/Z strictly. In particular, ankle Y/Z are locked axes; leaving
    // either component from the world-space correction created twisted soles.
    strictClampToRom(ankle, `ankle_${side}`);
    changed = true;
  }
  if (changed) m.root.updateMatrixWorld(true);
}

/** Finger curl (radians about the knuckle X axis) that wraps a gripping hand. */
export const FINGER_CURL = -1.35;
/** Thumb opposition curl (radians) toward the fingers. */
export const THUMB_CURL = -0.9;
/** Sideways thumb opposition kept inside the thumb's adduction ROM. */
export const THUMB_OPPOSE = 0.5;
/** Closed-fist finger curl, still inside the 100deg finger-flexion limit. */
export const FIST_CURL = -1.5;
export const FIST_THUMB_CURL = -1.15;
export const FIST_THUMB_OPPOSE = 0.45;
const FINGERS = ["index", "middle", "ring", "pinky"] as const;

/** True for the parallel-rail anchors belonging to the dip-bars prop. */
export function isDipBarGrip(anchor: string): boolean {
  return anchor === "bars" || anchor.startsWith("bars_");
}

/**
 * Establish a deterministic dip-bar forearm frame before body translation/IK.
 * Removing inherited elbow axial twist makes the palm face available for the
 * downward support contact instead of leaving each hand turned toward a thigh.
 */
export function prepareGripFrames(
  m: Mannequin,
  grips: readonly { effector: string; anchor: string }[],
): void {
  let changed = false;
  for (const grip of grips) {
    if (!isDipBarGrip(grip.anchor)) continue;
    const match = /_(left|right)$/.exec(grip.effector);
    if (!match) continue;
    const side = match[1] as HandSide;
    const elbowId = `elbow_${side}`;
    const elbow = m.bones.get(elbowId);
    if (!elbow) continue;
    CONTACT_EULER.setFromQuaternion(elbow.quaternion, "XYZ");
    CONTACT_EULER.y = 0;
    elbow.quaternion.setFromEuler(CONTACT_EULER);
    strictClampToRom(elbow, elbowId);
    changed = true;
  }
  if (changed) m.root.updateMatrixWorld(true);
}

/**
 * Finish the stable dip-bar frame after IK: the flattened palm presses down on
 * the rail while wrist flexion/extension remains strictly ROM-safe.
 */
export function alignGripFrames(
  m: Mannequin,
  grips: readonly { effector: string; anchor: string }[],
): void {
  let changed = false;
  for (const grip of grips) {
    if (!isDipBarGrip(grip.anchor)) continue;
    const match = /_(left|right)$/.exec(grip.effector);
    if (!match) continue;
    changed = alignWristNormal(
      m,
      match[1] as HandSide,
      PALM_LOCAL_NORMAL,
      1,
    ) || changed;
  }
  if (changed) m.root.updateMatrixWorld(true);
}

/**
 * Close semantic fist effectors without overwriting explicitly authored digit
 * bones. Wrist/contact corrections never touch these locals, so the curl is
 * preserved while the knuckles are oriented onto a target.
 */
export function formFists(
  m: Mannequin,
  sides: ReadonlySet<HandSide>,
  authoredFingers: ReadonlySet<string> = new Set(),
): void {
  let changed = false;
  for (const side of sides) {
    for (const finger of FINGERS) {
      const id = `${finger}_${side}`;
      if (authoredFingers.has(id)) continue;
      const bone = m.bones.get(id);
      if (!bone) continue;
      bone.rotation.set(FIST_CURL, 0, 0);
      changed = true;
    }
    const thumbId = `thumb_${side}`;
    if (!authoredFingers.has(thumbId)) {
      const thumb = m.bones.get(thumbId);
      if (thumb) {
        thumb.rotation.set(
          FIST_THUMB_CURL,
          0,
          side === "left" ? -FIST_THUMB_OPPOSE : FIST_THUMB_OPPOSE,
        );
        changed = true;
      }
    }
  }
  if (changed) m.root.updateMatrixWorld(true);
}

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
      thumb.rotation.set(THUMB_CURL, 0, side === "left" ? -THUMB_OPPOSE : THUMB_OPPOSE);
      changed = true;
    }
  }
  if (changed) m.root.updateMatrixWorld(true);
}

/**
 * Relaxed resting finger curl (radians) for an idle hand in the air. A truly
 * relaxed hand is not flat: the fingers settle into a soft inward hook (~18°),
 * which reads as a natural cupped hand instead of a stiff splayed palm.
 */
export const REST_CURL = -0.32;
/** Gentle thumb opposition for a relaxed hand, within adduction ROM. */
export const REST_THUMB_OPPOSE = 0.26;
/** Finger bones are intentionally single-DOF; their authored rest offsets
 * provide natural spacing without inventing an out-of-ROM lateral rotation. */
export const REST_ADDUCT = 0;
/**
 * Near-flat curl (radians) for a hand pressed onto the floor (plank, push-up,
 * cobra). The palm lies flat with the fingers extended forward; the resting
 * inward hook would instead claw the fingertips into the ground.
 */
export const FLOOR_CURL = -0.06;

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
        const thumbOppose = planted ? 0 : REST_THUMB_OPPOSE;
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
 * Skips shoulders the document authors and any contact-constrained hand side.
 */
export function swingArms(
  m: Mannequin,
  authoredShoulders: ReadonlySet<string>,
  protectedSides: ReadonlySet<"left" | "right">,
): void {
  let changed = false;
  for (const side of ["left", "right"] as const) {
    if (protectedSides.has(side)) continue;
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
