import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { rigCharacter } from "../src/character.js";
import { buildMannequin } from "../src/mannequin.js";

const DEG = Math.PI / 180;

/**
 * A minimal Mixamo-convention skeleton in a T-pose (arms straight out along
 * ±X, palms notionally down, legs straight down, facing +Z). World positions
 * below; locals are the diffs since every rest rotation is identity.
 */
function makeTposeSkeleton(): THREE.Object3D {
  const world = new Map<string, [number, number, number]>([
    ["Hips", [0, 1.0, 0]],
    ["Spine", [0, 1.1, 0]],
    ["Spine1", [0, 1.2, 0]],
    ["Spine2", [0, 1.3, 0]],
    ["Neck", [0, 1.45, 0]],
    ["Head", [0, 1.5, 0]],
    ["HeadTop_End", [0, 1.65, 0]],
  ]);
  const parents = new Map<string, string>([
    ["Spine", "Hips"],
    ["Spine1", "Spine"],
    ["Spine2", "Spine1"],
    ["Neck", "Spine2"],
    ["Head", "Neck"],
    ["HeadTop_End", "Head"],
  ]);
  for (const [S, sx] of [
    ["Left", 1],
    ["Right", -1],
  ] as const) {
    const put = (name: string, parent: string, p: [number, number, number]): void => {
      world.set(`${S}${name}`, [sx * p[0], p[1], p[2]]);
      parents.set(`${S}${name}`, /^(Shoulder|UpLeg)$/.test(name) ? parent : `${S}${parent}`);
    };
    put("Shoulder", "Spine2", [0.05, 1.4, 0]);
    put("Arm", "Shoulder", [0.15, 1.4, 0]);
    put("ForeArm", "Arm", [0.4, 1.4, 0]);
    put("Hand", "ForeArm", [0.65, 1.4, 0]);
    for (const [fing, y, z] of [
      ["Thumb", 1.37, 0.03],
      ["Index", 1.4, 0.025],
      ["Middle", 1.4, 0.008],
      ["Ring", 1.4, -0.008],
      ["Pinky", 1.4, -0.025],
    ] as const) {
      put(`Hand${fing}1`, "Hand", [0.72, y, z]);
      put(`Hand${fing}2`, `Hand${fing}1`, [0.75, y, z]);
      put(`Hand${fing}3`, `Hand${fing}2`, [0.78, y, z]);
    }
    put("UpLeg", "Hips", [0.1, 0.95, 0]);
    put("Leg", "UpLeg", [0.1, 0.5, 0]);
    put("Foot", "Leg", [0.1, 0.1, 0]);
    put("ToeBase", "Foot", [0.1, 0.02, 0.12]);
  }

  const scene = new THREE.Group();
  const nodes = new Map<string, THREE.Bone>();
  for (const [name, pos] of world) {
    const b = new THREE.Bone();
    b.name = `mixamorig${name}`;
    const parent = parents.get(name);
    const base = parent ? world.get(parent)! : [0, 0, 0];
    b.position.set(pos[0] - base[0], pos[1] - base[1], pos[2] - base[2]);
    (parent ? nodes.get(parent)! : scene).add(b);
    nodes.set(name, b);
  }
  scene.updateMatrixWorld(true);
  return scene;
}

/** World-position distance between a driver bone and its character bone. */
function jointGap(
  driver: ReturnType<typeof buildMannequin>,
  char: ReturnType<typeof rigCharacter>,
  driverId: string,
  mixamoName: string,
): number {
  const d = driver.bones.get(driverId)!.getWorldPosition(new THREE.Vector3());
  const c = char.group
    .getObjectByName(`mixamorig${mixamoName}`)!
    .getWorldPosition(new THREE.Vector3());
  return d.distanceTo(c);
}

const CHECKS: [string, string][] = [
  ["pelvis", "Hips"],
  ["chest", "Spine2"],
  ["head", "Head"],
  ["shoulder_left", "LeftArm"],
  ["elbow_left", "LeftForeArm"],
  ["wrist_left", "LeftHand"],
  ["elbow_right", "RightForeArm"],
  ["wrist_right", "RightHand"],
  ["hip_left", "LeftUpLeg"],
  ["knee_right", "RightLeg"],
  ["ankle_left", "LeftFoot"],
  ["ankle_right", "RightFoot"],
];

describe("character retargeting", () => {
  it("calibrates a T-pose rig into the driver rest pose (arms down)", () => {
    const char = rigCharacter(makeTposeSkeleton());
    const driver = buildMannequin(undefined, char.proportions);
    driver.root.updateMatrixWorld(true);
    char.sync(driver);
    for (const [driverId, mixamo] of CHECKS) {
      expect(jointGap(driver, char, driverId, mixamo), `${driverId}↔${mixamo}`).toBeLessThan(1e-3);
    }
    // Arms really came down: the character hand hangs below its elbow.
    const hand = char.group
      .getObjectByName("mixamorigLeftHand")!
      .getWorldPosition(new THREE.Vector3());
    const elbow = char.group
      .getObjectByName("mixamorigLeftForeArm")!
      .getWorldPosition(new THREE.Vector3());
    expect(hand.y).toBeLessThan(elbow.y - 0.1);
  });

  it("keeps the skeletons congruent under an arbitrary posed frame", () => {
    const char = rigCharacter(makeTposeSkeleton());
    const driver = buildMannequin(undefined, char.proportions);

    // A messy asymmetric pose incl. root motion (as ground-lock would apply).
    driver.root.position.set(0.3, -0.12, 0.5);
    driver.root.rotation.set(20 * DEG, 45 * DEG, 0);
    const set = (id: string, x: number, y: number, z: number): void => {
      driver.bones.get(id)!.rotation.set(x * DEG, y * DEG, z * DEG);
    };
    set("pelvis", -30, 0, 0);
    set("chest", 10, 15, 0);
    set("shoulder_left", -120, 0, 20);
    set("elbow_left", -90, 0, 0);
    set("shoulder_right", 0, 0, -80);
    set("hip_left", -85, 0, 8);
    set("knee_left", 70, 0, 0);
    set("ankle_right", -20, 0, 0);
    driver.root.updateMatrixWorld(true);

    char.sync(driver);
    for (const [driverId, mixamo] of CHECKS) {
      expect(jointGap(driver, char, driverId, mixamo), `${driverId}↔${mixamo}`).toBeLessThan(2e-3);
    }
  });

  it("derives driver proportions from the character (sole depth, scale)", () => {
    const char = rigCharacter(makeTposeSkeleton());
    const p = char.proportions;
    // Skeleton is ~1.77m raw (1.65 head-top + 0.12 allowance): scale ≈ 1.
    expect(p.offsets["pelvis"]![1]).toBeGreaterThan(0.9);
    expect(p.offsets["pelvis"]![1]).toBeLessThan(1.1);
    // Limb segments are straight down after calibration.
    expect(p.offsets["knee_left"]![0]).toBeCloseTo(0, 5);
    expect(p.offsets["elbow_left"]![0]).toBeCloseTo(0, 5);
    expect(p.offsets["elbow_left"]![1]).toBeLessThan(-0.2);
    // The ankle rides well above the sole (character feet, not the default shoe).
    expect(p.soleDrop).toBeGreaterThan(0.05);
  });
});
