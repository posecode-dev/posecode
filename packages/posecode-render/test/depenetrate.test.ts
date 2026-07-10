import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { buildMannequin } from "../src/mannequin.js";
import { depenetrate } from "../src/depenetrate.js";

const DEG = Math.PI / 180;

/** Distance from a point to the pelvis→neck torso axis segment. */
function distToTorso(m: ReturnType<typeof buildMannequin>, p: THREE.Vector3): number {
  const a = m.bones.get("pelvis")!.getWorldPosition(new THREE.Vector3());
  const b = m.bones.get("neck")!.getWorldPosition(new THREE.Vector3());
  const ab = b.clone().sub(a);
  const t = THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / ab.lengthSq(), 0, 1);
  return p.distanceTo(a.addScaledVector(ab, t));
}

describe("self-collision de-penetration", () => {
  /** Min distance from any point along the forearm (elbow→wrist) to the torso axis. */
  function forearmClearance(m: ReturnType<typeof buildMannequin>): number {
    const e = m.bones.get("elbow_left")!.getWorldPosition(new THREE.Vector3());
    const w = m.bones.get("wrist_left")!.getWorldPosition(new THREE.Vector3());
    let min = Infinity;
    for (let t = 0; t <= 1; t += 0.1) {
      min = Math.min(min, distToTorso(m, e.clone().lerp(w, t)));
    }
    return min;
  }

  it("pushes a forearm swung across the chest back out to the surface", () => {
    const m = buildMannequin();
    // Swing the straight arm across the body in the frontal plane: the forearm
    // slices through the torso capsule. Probe both lateral signs so the test
    // doesn't depend on the adduction sign convention.
    let before = Infinity;
    for (const sz of [80, -80]) {
      m.bones.get("shoulder_left")!.rotation.set(0, 0, sz * DEG);
      m.bones.get("elbow_left")!.rotation.set(-25 * DEG, 0, 0);
      m.root.updateMatrixWorld(true);
      before = forearmClearance(m);
      if (before < m.collision.torso) break;
    }
    expect(before).toBeLessThan(m.collision.torso); // sanity: really penetrating

    depenetrate(m);
    m.root.updateMatrixWorld(true);
    expect(forearmClearance(m)).toBeGreaterThan(before + 0.02); // pushed outward
    // Elbow flexion is untouched: only the shoulder re-aims the arm.
    const elbow = new THREE.Euler().setFromQuaternion(m.bones.get("elbow_left")!.quaternion, "XYZ");
    expect(elbow.x).toBeCloseTo(-25 * DEG, 5);
  });

  it("leaves a clean pose untouched", () => {
    const m = buildMannequin();
    m.bones.get("shoulder_left")!.rotation.set(-90 * DEG, 0, 0); // arm straight forward
    m.root.updateMatrixWorld(true);
    const before = m.bones.get("shoulder_left")!.quaternion.clone();
    depenetrate(m);
    expect(m.bones.get("shoulder_left")!.quaternion.angleTo(before)).toBeLessThan(1e-6);
  });

  it("separates crossing shins", () => {
    const m = buildMannequin();
    // Swing the left leg across the right: ankles/shins overlap.
    m.bones.get("hip_left")!.rotation.set(-20 * DEG, 0, -35 * DEG);
    m.root.updateMatrixWorld(true);
    const gap = (): number => {
      const l = m.bones.get("ankle_left")!.getWorldPosition(new THREE.Vector3());
      const a = m.bones.get("knee_right")!.getWorldPosition(new THREE.Vector3());
      const b = m.bones.get("ankle_right")!.getWorldPosition(new THREE.Vector3());
      const ab = b.clone().sub(a);
      const t = THREE.MathUtils.clamp(l.clone().sub(a).dot(ab) / ab.lengthSq(), 0, 1);
      return l.distanceTo(a.addScaledVector(ab, t));
    };
    const before = gap();
    depenetrate(m);
    m.root.updateMatrixWorld(true);
    expect(gap()).toBeGreaterThanOrEqual(before);
  });
});
