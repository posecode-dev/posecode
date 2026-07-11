import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { buildMannequin } from "../src/mannequin.js";
import { levelPlantedFeet } from "../src/contacts.js";
import { groundFigure } from "../src/groundlock.js";

const DEG = Math.PI / 180;

/** World-space sole normal (ankle local -Y) for a foot. */
function soleNormal(m: ReturnType<typeof buildMannequin>, side: "left" | "right") {
  const ankle = m.bones.get(`ankle_${side}`)!;
  const q = ankle.getWorldQuaternion(new THREE.Quaternion());
  return new THREE.Vector3(0, -1, 0).applyQuaternion(q).normalize();
}

describe("levelPlantedFeet", () => {
  it("levels a tilted planted foot so the sole faces down", () => {
    const m = buildMannequin();
    // Tilt the leg so the foot pitches within the ankle's dorsiflexion range
    // (deeper tilts legitimately lift the heel — capped by ROM), then plant it
    // on the floor as the frame loop's ground-lock does before leveling.
    m.bones.get("knee_left")!.rotation.x = 12 * DEG;
    m.root.updateMatrixWorld(true);
    groundFigure(m);
    const tiltedDot = soleNormal(m, "left").dot(new THREE.Vector3(0, -1, 0));
    levelPlantedFeet(m, ["feet"]);
    m.root.updateMatrixWorld(true);
    const n = soleNormal(m, "left");
    // Leveling makes the sole face world-down (dot ~ 1), flatter than the tilt.
    expect(n.dot(new THREE.Vector3(0, -1, 0))).toBeGreaterThan(0.98);
    expect(n.dot(new THREE.Vector3(0, -1, 0))).toBeGreaterThan(tiltedDot);
  });

  it("leaves an authored-plantarflex foot on its toes", () => {
    const m = buildMannequin();
    m.bones.get("ankle_left")!.rotation.x = 30 * DEG; // plantarflex (toe-down)
    m.root.updateMatrixWorld(true);
    const before = m.bones.get("ankle_left")!.quaternion.clone();
    levelPlantedFeet(m, ["feet"]);
    expect(m.bones.get("ankle_left")!.quaternion.angleTo(before)).toBeLessThan(1e-6);
  });

  it("does not touch a swing foot lifted off the floor", () => {
    const m = buildMannequin();
    // Lift the foot well above the floor by bending the knee back and raising hip.
    m.bones.get("hip_left")!.rotation.x = -60 * DEG;
    m.root.position.y = 0.5;
    m.root.updateMatrixWorld(true);
    const before = m.bones.get("ankle_left")!.quaternion.clone();
    levelPlantedFeet(m, ["feet"]);
    expect(m.bones.get("ankle_left")!.quaternion.angleTo(before)).toBeLessThan(1e-3);
  });
});
