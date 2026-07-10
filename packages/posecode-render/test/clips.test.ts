import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { retargetMocapClip, createClipLayer } from "../src/clips.js";

const DEG = Math.PI / 180;

/**
 * A minimal Mixamo-convention T-pose rig: enough bones to exercise name
 * mapping, hip travel stripping, and quaternion retargeting. World positions
 * given; locals are diffs since every rest rotation is identity.
 */
function makeRig(extraBone?: string): {
  scene: THREE.Group;
  bones: Map<string, THREE.Bone>;
} {
  const world = new Map<string, [number, number, number]>([
    ["Hips", [0, 1.0, 0]],
    ["Spine", [0, 1.2, 0]],
    ["LeftArm", [0.2, 1.4, 0]],
    ["LeftForeArm", [0.45, 1.4, 0]],
    ["LeftHand", [0.7, 1.4, 0]],
    ["LeftUpLeg", [0.1, 0.95, 0]],
    ["LeftLeg", [0.1, 0.5, 0]],
    ["LeftFoot", [0.1, 0.1, 0]],
  ]);
  const parents = new Map<string, string>([
    ["Spine", "Hips"],
    ["LeftArm", "Spine"],
    ["LeftForeArm", "LeftArm"],
    ["LeftHand", "LeftForeArm"],
    ["LeftUpLeg", "Hips"],
    ["LeftLeg", "LeftUpLeg"],
    ["LeftFoot", "LeftLeg"],
  ]);
  if (extraBone) {
    world.set(extraBone, [0, 1.0, -0.3]);
    parents.set(extraBone, "Hips");
  }
  const scene = new THREE.Group();
  const bones = new Map<string, THREE.Bone>();
  for (const [name, pos] of world) {
    const b = new THREE.Bone();
    b.name = `mixamorig${name}`;
    const parent = parents.get(name);
    const base = parent ? world.get(parent)! : [0, 0, 0];
    b.position.set(pos[0] - base[0], pos[1] - base[1], pos[2] - base[2]);
    (parent ? bones.get(parent)! : scene).add(b);
    bones.set(name, b);
  }
  scene.updateMatrixWorld(true);
  return { scene, bones };
}

/** Bind a bare SkinnedMesh to the rig so it can be a retarget target. */
function makeSkinnedTarget(rig: ReturnType<typeof makeRig>): THREE.SkinnedMesh {
  const mesh = new THREE.SkinnedMesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial(),
  );
  rig.scene.add(mesh);
  rig.scene.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton([...rig.bones.values()]));
  return mesh;
}

/** A 1s source clip: left arm raises 90° about Z, hips bob and travel. */
function makeSourceClip(): THREE.AnimationClip {
  const q0 = new THREE.Quaternion();
  const q1 = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 90 * DEG));
  return new THREE.AnimationClip("walk", 1, [
    new THREE.QuaternionKeyframeTrack(
      "mixamorigLeftArm.quaternion",
      [0, 1],
      [q0.x, q0.y, q0.z, q0.w, q1.x, q1.y, q1.z, q1.w],
    ),
    new THREE.VectorKeyframeTrack(
      "mixamorigHips.position",
      [0, 1],
      [0, 1.0, 0, 0.5, 1.1, 2.0],
    ),
  ]);
}

function retargeted(extraTargetBone?: string): {
  clip: THREE.AnimationClip;
  target: THREE.SkinnedMesh;
  rig: ReturnType<typeof makeRig>;
} {
  const source = makeRig();
  const rig = makeRig(extraTargetBone);
  const target = makeSkinnedTarget(rig);
  const clip = retargetMocapClip(target, source.scene, makeSourceClip());
  return { clip, target, rig };
}

function track(clip: THREE.AnimationClip, name: string): THREE.KeyframeTrack | undefined {
  return clip.tracks.find((t) => t.name === name);
}

describe("retargetMocapClip", () => {
  it("emits mixer-ready .bones[] tracks for bones the source animates", () => {
    const { clip } = retargeted();
    expect(track(clip, ".bones[mixamorigLeftArm].quaternion")).toBeDefined();
    expect(track(clip, ".bones[mixamorigHips].position")).toBeDefined();
    expect(clip.duration).toBeCloseTo(1, 2);
  });

  it("drops tracks for target bones with no source counterpart", () => {
    const { clip } = retargeted("Tail");
    expect(track(clip, ".bones[mixamorigTail].quaternion")).toBeUndefined();
    expect(track(clip, ".bones[mixamorigTail].position")).toBeUndefined();
  });

  it("preserves the target's calibrated bone locals (bake must not disturb the pose)", () => {
    const source = makeRig();
    const rig = makeRig();
    const target = makeSkinnedTarget(rig);
    // Simulate the character calibration: a non-bind rest on the arm.
    const arm = rig.bones.get("LeftArm")!;
    arm.quaternion.setFromEuler(new THREE.Euler(0, 0, -80 * DEG));
    rig.scene.updateMatrixWorld(true);
    const before = new Map(
      [...rig.bones.values()].map((b) => [
        b.name,
        { pos: b.position.clone(), quat: b.quaternion.clone() },
      ]),
    );
    retargetMocapClip(target, source.scene, makeSourceClip());
    for (const [name, rest] of before) {
      const bone = [...rig.bones.values()].find((b) => b.name === name)!;
      expect(bone.position.distanceTo(rest.pos)).toBeLessThan(1e-6);
      expect(Math.abs(bone.quaternion.dot(rest.quat))).toBeGreaterThan(1 - 1e-6);
    }
  });

  it("pins hip X/Z to the rest stance but keeps the vertical bob", () => {
    const { clip, rig } = retargeted();
    const pos = track(clip, ".bones[mixamorigHips].position")!;
    const rest = rig.bones.get("Hips")!.position;
    const v = pos.values;
    const frames = v.length / 3;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < frames; i++) {
      expect(v[i * 3]).toBeCloseTo(rest.x, 5);
      expect(v[i * 3 + 2]).toBeCloseTo(rest.z, 5);
      minY = Math.min(minY, v[i * 3 + 1]!);
      maxY = Math.max(maxY, v[i * 3 + 1]!);
    }
    // Source bobs 0.1 up over the clip; rigs are congruent so the delta carries.
    expect(maxY - minY).toBeCloseTo(0.1, 2);
    expect(minY).toBeCloseTo(rest.y, 5);
  });
});

describe("createClipLayer", () => {
  function layerSetup(): {
    rig: ReturnType<typeof makeRig>;
    layer: ReturnType<typeof createClipLayer>;
  } {
    const { clip, target, rig } = retargeted();
    // Pretend the procedural sync drives only the arm; hips are clip-only.
    const syncDriven = new Set<THREE.Object3D>([rig.bones.get("LeftArm")!]);
    const layer = createClipLayer(target, clip, syncDriven);
    return { rig, layer };
  }

  it("poses clip-driven bones exactly at full weight", () => {
    const { rig, layer } = layerSetup();
    layer.apply(0.5, 1);
    const arm = rig.bones.get("LeftArm")!;
    const angle = new THREE.Euler().setFromQuaternion(arm.quaternion, "XYZ").z / DEG;
    expect(angle).toBeCloseTo(45, 0);
  });

  it("blends halfway between the current pose and the clip at weight 0.5", () => {
    const { rig, layer } = layerSetup();
    layer.apply(0.5, 0.5);
    const arm = rig.bones.get("LeftArm")!;
    const angle = new THREE.Euler().setFromQuaternion(arm.quaternion, "XYZ").z / DEG;
    expect(angle).toBeCloseTo(22.5, 0);
  });

  it("restores non-sync bones to rest when the weight reaches zero", () => {
    const { rig, layer } = layerSetup();
    const hips = rig.bones.get("Hips")!;
    const rest = hips.position.clone();
    // Mid-clip (t=1 would wrap to the bob-free first frame under LoopRepeat).
    layer.apply(0.5, 1);
    expect(hips.position.distanceTo(rest)).toBeGreaterThan(0.01);
    layer.apply(0.5, 0);
    expect(hips.position.distanceTo(rest)).toBeLessThan(1e-6);
  });

  it("keeps procedural bones untouched at zero weight", () => {
    const { rig, layer } = layerSetup();
    const arm = rig.bones.get("LeftArm")!;
    arm.quaternion.setFromEuler(new THREE.Euler(0, 0, 10 * DEG));
    layer.apply(0.5, 0);
    const angle = new THREE.Euler().setFromQuaternion(arm.quaternion, "XYZ").z / DEG;
    expect(angle).toBeCloseTo(10, 3);
  });
});
