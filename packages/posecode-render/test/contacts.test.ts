import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { buildMannequin } from "../src/mannequin.js";
import { levelPlantedFeet, relaxHands, swingArms, aimHead } from "../src/contacts.js";
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

  it("levels only the selected per-side foot", () => {
    const m = buildMannequin();
    m.bones.get("knee_left")!.rotation.x = 12 * DEG;
    m.bones.get("knee_right")!.rotation.x = 12 * DEG;
    m.root.updateMatrixWorld(true);
    groundFigure(m);
    const leftBefore = m.bones.get("ankle_left")!.quaternion.clone();
    const rightBefore = m.bones.get("ankle_right")!.quaternion.clone();
    levelPlantedFeet(m, ["foot_left"]);
    expect(m.bones.get("ankle_left")!.quaternion.angleTo(leftBefore)).toBeGreaterThan(1e-3);
    expect(m.bones.get("ankle_right")!.quaternion.angleTo(rightBefore)).toBeLessThan(1e-6);
  });
});

describe("relaxHands (L4.1)", () => {
  it("curls the fingers of an idle, un-authored hand into a natural rest", () => {
    const m = buildMannequin();
    expect(m.bones.get("index_left")!.rotation.x).toBeCloseTo(0, 5); // flat at rest
    relaxHands(m, new Set(), new Set());
    expect(m.bones.get("index_left")!.rotation.x).toBeGreaterThan(0.1);
    expect(m.bones.get("middle_right")!.rotation.x).toBeGreaterThan(0.1);
  });

  it("leaves a gripping hand for wrapGrip (skips grip sides)", () => {
    const m = buildMannequin();
    relaxHands(m, new Set(["left"]), new Set());
    expect(m.bones.get("index_left")!.rotation.x).toBeCloseTo(0, 5); // untouched
    expect(m.bones.get("index_right")!.rotation.x).toBeGreaterThan(0.1); // right relaxed
  });

  it("does not override an explicitly authored finger", () => {
    const m = buildMannequin();
    m.bones.get("index_left")!.rotation.x = 1.4; // authored fist
    relaxHands(m, new Set(), new Set(["index_left"]));
    expect(m.bones.get("index_left")!.rotation.x).toBeCloseTo(1.4, 5);
  });

  it("keeps a floor-planted hand's fingers flat instead of clawing", () => {
    const m = buildMannequin();
    // A free hand takes the soft inward hook...
    relaxHands(m, new Set(), new Set(), new Set());
    const freeCurl = m.bones.get("index_left")!.rotation.x;
    expect(freeCurl).toBeGreaterThan(0.3);
    // ...but a hand pressed to the floor (plank/push-up) lies extended.
    relaxHands(m, new Set(), new Set(), new Set(["left"]));
    expect(m.bones.get("index_left")!.rotation.x).toBeLessThan(0.1); // flat
    expect(m.bones.get("index_right")!.rotation.x).toBeGreaterThan(0.3); // right still hooked
  });
});

describe("swingArms (L4.2)", () => {
  it("adds contralateral arm swing when a hip is flexed and the arm is free", () => {
    const m = buildMannequin();
    // Flex the right hip forward (walking: right leg forward → left arm forward).
    m.bones.get("hip_right")!.rotation.x = -0.6;
    const before = m.bones.get("shoulder_left")!.rotation.x;
    swingArms(m, new Set(), new Set());
    const after = m.bones.get("shoulder_left")!.rotation.x;
    expect(Math.abs(after - before)).toBeGreaterThan(0.05); // swung
    // swings the same sagittal direction as the contralateral hip (forward)
    expect(Math.sign(after - before)).toBe(Math.sign(-0.6));
  });

  it("respects an authored shoulder (no swing)", () => {
    const m = buildMannequin();
    m.bones.get("hip_right")!.rotation.x = -0.6;
    m.bones.get("shoulder_left")!.rotation.x = 0.9; // authored
    swingArms(m, new Set(["shoulder_left"]), new Set());
    expect(m.bones.get("shoulder_left")!.rotation.x).toBeCloseTo(0.9, 5);
  });

  it("skips a gripping side", () => {
    const m = buildMannequin();
    m.bones.get("hip_right")!.rotation.x = -0.6;
    const before = m.bones.get("shoulder_left")!.rotation.x;
    swingArms(m, new Set(), new Set(["left"]));
    expect(m.bones.get("shoulder_left")!.rotation.x).toBeCloseTo(before, 5);
  });

  it("is idempotent across render frames instead of accumulating a spin", () => {
    const m = buildMannequin();
    m.bones.get("hip_right")!.rotation.x = -0.6;
    swingArms(m, new Set(), new Set());
    const once = m.bones.get("shoulder_left")!.quaternion.clone();
    for (let frame = 0; frame < 120; frame++) swingArms(m, new Set(), new Set());
    expect(m.bones.get("shoulder_left")!.quaternion.angleTo(once)).toBeLessThan(1e-6);
  });
});

describe("aimHead (L4.3 look-at)", () => {
  it("turns the head toward a focus point (face +Z tracks the target)", () => {
    const m = buildMannequin();
    m.root.updateMatrixWorld(true);
    const head = m.bones.get("head")!;
    const headPos = head.getWorldPosition(new THREE.Vector3());
    const focus = headPos.clone().add(new THREE.Vector3(0, 1.2, 0.6));
    const faceDir = () =>
      new THREE.Vector3(0, 0, 1)
        .applyQuaternion(head.getWorldQuaternion(new THREE.Quaternion()))
        .normalize();
    const want = focus.clone().sub(headPos).normalize();
    const before = faceDir().dot(want);
    aimHead(m, focus);
    m.root.updateMatrixWorld(true);
    expect(faceDir().dot(want)).toBeGreaterThan(before);
  });

  it("clamps the look so the head never spins past its range", () => {
    const m = buildMannequin();
    m.root.updateMatrixWorld(true);
    const head = m.bones.get("head")!;
    const headPos = head.getWorldPosition(new THREE.Vector3());
    const behind = headPos.clone().add(new THREE.Vector3(0, 0, -2));
    aimHead(m, behind);
    const e = new THREE.Euler().setFromQuaternion(m.bones.get("head")!.quaternion, "XYZ");
    expect(Math.hypot(e.x, e.y, e.z)).toBeLessThan(1.2);
  });
});
