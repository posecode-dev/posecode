/**
 * Bounded prop-contact correction for selected blocking surfaces.
 *
 * Authored poses are pure joint rotations relative to the root, and the root
 * solvers (ground-lock, pins) only know about the floor and named anchors, so
 * nothing stopped a wall-sit's pelvis from hinging straight through the wall
 * or a sit-to-stand's torso from sinking into the chair's backrest. This pass
 * samples the body as capsules (torso, head, thighs, shins, forearms) against
 * selected declared faces (`FaceCollider`, see props.ts) and reduces sampled
 * overlap. This is deliberately not comprehensive collision detection:
 *
 * - **Body-resolved faces** (wall, backrest, seat edge) translate the WHOLE
 *   figure along the face normal — the physical resolution of leaning into a
 *   flat surface is that the body moves, exactly like a real wall-sit where
 *   the feet walk forward as the back slides down the wall. Running after
 *   ground-lock, the push composes with planted feet per frame (recomputed
 *   from the base root, so it never accumulates).
 * - **Limb-resolved faces** (box edge) rotate the offending leg's hip just
 *   enough to clear, ROM-clamped like every other solve, leaving the root —
 *   and with it any pinned support foot — untouched.
 *
 * Same principles as the self-collision pass (depenetrate.ts): minimal (a
 * pose with no overlap is untouched, contact settles ON the surface),
 * deterministic (pure function of the pose), and ROM-bounded.
 *
 * Runs after ground-lock / pins / grips (it must see the final root
 * placement) and before reach-IK (reached hands must not be dragged off
 * their world targets by a later root translation).
 */

import * as THREE from "three";
import type { Mannequin } from "./mannequin.js";
import type { BlockedPart, FaceCollider } from "./props.js";
import { rotateJoint, widenedLimits } from "./depenetrate.js";

const DEG = Math.PI / 180;

/** Max corrective hip rotation for a limb-resolved contact (radians). */
const MAX_LIMB_CORRECTION = 25 * DEG;
/** Per-iteration limb step cap: several small steps converge smoothly. */
const MAX_LIMB_STEP = 6 * DEG;
const LIMB_ITERATIONS = 8;
/** Passes over the body-resolved faces (pushes can unblock each other). */
const BODY_PASSES = 2;

interface BodySample {
  part: BlockedPart;
  /** Which side a limb sample belongs to; unset for torso/head. */
  side?: "left" | "right";
  point: THREE.Vector3;
  radius: number;
}

const TMP_D = new THREE.Vector3();

/**
 * Penetration depth of a sample sphere behind a face, or 0 when clear.
 * A sample is owned by the face only while it projects onto the patch
 * (within the tangent half-extents, widened by its radius) and sits no
 * deeper than `captureDepth` behind it.
 */
function faceDepth(c: FaceCollider, p: THREE.Vector3, r: number): number {
  TMP_D.subVectors(p, c.point);
  const d = TMP_D.dot(c.normal);
  if (d - r >= 0 || d < -c.captureDepth) return 0;
  if (Math.abs(TMP_D.dot(c.tangentU)) > c.halfU + r) return 0;
  if (Math.abs(TMP_D.dot(c.tangentV)) > c.halfV + r) return 0;
  return r - d;
}

/** World position helper (assumes matrices are current). */
function wp(m: Mannequin, id: string, out = new THREE.Vector3()): THREE.Vector3 {
  return m.bones.get(id)!.getWorldPosition(out);
}

/** Sample points along the segment a→b, plus an optional tip overhang. */
function segmentSamples(
  m: Mannequin,
  part: BlockedPart,
  aId: string,
  bId: string,
  radius: number,
  tipOverhang: number,
  out: BodySample[],
  side?: "left" | "right",
): void {
  const a = wp(m, aId);
  const b = wp(m, bId);
  const dir = b.clone().sub(a);
  for (const t of [0, 0.33, 0.66, 1]) {
    out.push({ part, side, point: a.clone().addScaledVector(dir, t), radius });
  }
  if (tipOverhang > 0 && dir.lengthSq() > 1e-10) {
    out.push({ part, side, point: b.clone().addScaledVector(dir.normalize(), tipOverhang), radius });
  }
}

/** All body samples the solid faces test against, at current matrices. */
function bodySamples(m: Mannequin): BodySample[] {
  const R = m.collision;
  const out: BodySample[] = [];
  segmentSamples(m, "torso", "pelvis", "neck", R.torso, 0, out);
  segmentSamples(m, "head", "neck", "head", R.head, 0.05, out);
  for (const side of ["left", "right"] as const) {
    segmentSamples(m, "thigh", `hip_${side}`, `knee_${side}`, R.thigh, 0, out, side);
    // Shin overhang covers the foot mesh beyond the ankle bone.
    segmentSamples(m, "shin", `knee_${side}`, `ankle_${side}`, R.shin, 0.06, out, side);
    segmentSamples(m, "arm", `shoulder_${side}`, `elbow_${side}`, R.arm, 0, out, side);
    segmentSamples(m, "arm", `elbow_${side}`, `wrist_${side}`, R.arm, 0.09, out, side);
  }
  return out;
}

/**
 * Limbs whose end-effector is pinned / reached / gripped to a NON-floor
 * anchor this phase. That contact is intentional prop contact (a foot
 * standing on the box top, hands gripping the bar or pressing the seat), so
 * the contact pass must not "clear" the limb off its own support. Accepts
 * the phase's declarations in any effector spelling (`feet`, `foot_left`,
 * `hands`, `wrist_right`, …); pass reach targets as `anchor`.
 */
export function propContactExemptions(
  contacts: readonly { effector: string; anchor: string }[],
): PropContactExemptions {
  const legs = new Set<"left" | "right">();
  const arms = new Set<"left" | "right">();
  for (const c of contacts) {
    if (c.anchor === "floor") continue;
    for (const side of ["left", "right"] as const) {
      if (
        c.effector === "feet" ||
        c.effector === "knees" ||
        c.effector === `foot_${side}` ||
        c.effector === `ankle_${side}` ||
        c.effector === `knee_${side}`
      ) legs.add(side);
      if (
        c.effector === "hands" ||
        c.effector === "fists" ||
        c.effector === `hand_${side}` ||
        c.effector === `fist_${side}` ||
        c.effector === `wrist_${side}`
      ) arms.add(side);
    }
  }
  return { legs, arms };
}

export interface PropContactExemptions {
  legs: ReadonlySet<"left" | "right">;
  arms: ReadonlySet<"left" | "right">;
}

const NO_EXEMPTIONS: PropContactExemptions = { legs: new Set(), arms: new Set() };

/**
 * Resolve body-vs-prop contact in place (see module doc). Call with the
 * root's matrix world current; leaves matrices current. `exempt` lists limbs
 * intentionally contacting a prop anchor (see propContactExemptions).
 */
export function resolvePropContacts(
  m: Mannequin,
  colliders: readonly FaceCollider[],
  exempt: PropContactExemptions = NO_EXEMPTIONS,
): void {
  if (colliders.length === 0) return;
  const bodyFaces = colliders.filter((c) => c.resolve === "body");
  const limbFaces = colliders.filter((c) => c.resolve === "limb");

  // A sample from an exempt limb never drives a correction: its contact with
  // the prop is the movement's declared support.
  const exemptSample = (s: BodySample): boolean =>
    (s.part === "shin" && exempt.legs.has(s.side!)) ||
    (s.part === "thigh" && exempt.legs.has(s.side!)) ||
    (s.part === "arm" && exempt.arms.has(s.side!));

  // --- Whole-body push-out, one face at a time (samples re-read after each
  // move so same-direction faces compose instead of double-pushing). ---
  for (let pass = 0; pass < BODY_PASSES && bodyFaces.length > 0; pass++) {
    let moved = false;
    for (const c of bodyFaces) {
      let depth = 0;
      for (const s of bodySamples(m)) {
        if (!c.blocks.includes(s.part) || exemptSample(s)) continue;
        depth = Math.max(depth, faceDepth(c, s.point, s.radius));
      }
      if (depth <= 1e-4) continue;
      m.root.position.addScaledVector(c.normal, depth);
      m.root.updateMatrixWorld(true);
      moved = true;
    }
    if (!moved) break;
  }

  // --- Per-leg clearing for limb-resolved faces (box edge): rotate the hip
  // so the shin/foot lifts over the face, mirroring depenetrate's leg pass. ---
  if (limbFaces.length === 0) return;
  const TMP_LEVER = new THREE.Vector3();
  for (const side of ["left", "right"] as const) {
    if (exempt.legs.has(side)) continue;
    const hip = m.bones.get(`hip_${side}`);
    if (!hip) continue;
    const hipLimits = widenedLimits(`hip_${side}`, hip);
    let applied = 0;
    for (let i = 0; i < LIMB_ITERATIONS && applied < MAX_LIMB_CORRECTION; i++) {
      const R = m.collision;
      const samples: BodySample[] = [];
      segmentSamples(m, "shin", `knee_${side}`, `ankle_${side}`, R.shin, 0.06, samples);
      let deepest = 0;
      let point: THREE.Vector3 | null = null;
      let push: THREE.Vector3 | null = null;
      for (const c of limbFaces) {
        if (!c.blocks.includes("shin")) continue;
        for (const s of samples) {
          const depth = faceDepth(c, s.point, s.radius);
          if (depth > deepest) {
            deepest = depth;
            point = s.point;
            push = c.normal;
          }
        }
      }
      if (deepest <= 1e-4 || !point || !push) break;
      const pivot = wp(m, `hip_${side}`);
      TMP_LEVER.subVectors(point, pivot);
      const lever = TMP_LEVER.length();
      if (lever < 0.05) break;
      const axis = TMP_LEVER.clone().cross(push);
      if (axis.lengthSq() < 1e-8) break;
      axis.normalize();
      const step = Math.min(deepest / lever, MAX_LIMB_STEP, MAX_LIMB_CORRECTION - applied);
      rotateJoint(hip, axis, step, hipLimits);
      applied += step;
    }
  }
}
