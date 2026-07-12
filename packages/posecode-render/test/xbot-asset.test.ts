import fs from "node:fs";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const ASSET = new URL("../../../playground/public/models/xbot.glb", import.meta.url);

async function loadXbot(): Promise<THREE.Object3D> {
  const bytes = fs.readFileSync(ASSET);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return await new Promise((resolve, reject) => {
    new GLTFLoader().parse(buffer, "", (gltf) => resolve(gltf.scene), reject);
  });
}

describe("normalized Xbot runtime asset", () => {
  it("ships two meshes on one meter-scale Mixamo skeleton", async () => {
    const scene = await loadXbot();
    const meshes: THREE.SkinnedMesh[] = [];
    scene.traverse((node) => {
      if ((node as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(node as THREE.SkinnedMesh);
    });

    expect(meshes.map((mesh) => mesh.name).sort()).toEqual(["Beta_Joints", "Beta_Surface"]);
    expect(meshes[0]!.skeleton.bones).toHaveLength(65);
    expect(new Set(meshes[0]!.skeleton.bones.map((bone) => bone.name)).size).toBe(65);
    // Both skins must reference the same bone objects, not Mixamo's duplicated
    // nested skeleton that previously made retargeting ambiguous and unstable.
    expect(meshes[1]!.skeleton.bones[0]).toBe(meshes[0]!.skeleton.bones[0]);

    const bounds = new THREE.Box3().setFromObject(scene);
    const height = bounds.getSize(new THREE.Vector3()).y;
    expect(height).toBeGreaterThan(1.7);
    expect(height).toBeLessThan(1.8);
    const vertices = meshes.reduce(
      (sum, mesh) => sum + mesh.geometry.getAttribute("position").count,
      0,
    );
    expect(vertices).toBeLessThan(30_000);
  });
});
