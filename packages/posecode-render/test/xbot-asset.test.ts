import fs from "node:fs";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { rigCharacter } from "../src/character.js";
import { buildMannequin } from "../src/mannequin.js";
import { groundFigure } from "../src/groundlock.js";
import { buildTimeline } from "../src/timeline.js";
import { parse } from "posecode-parser";

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

  it("matches the grounded driver's visible floor exactly", async () => {
    const character = rigCharacter(await loadXbot());
    const driver = buildMannequin(undefined, character.proportions);
    groundFigure(driver);
    character.sync(driver);

    const driverMin = new THREE.Box3().setFromObject(driver.root).min.y;
    const characterMin = character.getBounds().min.y;
    expect(driverMin).toBeCloseTo(0, 4);
    expect(characterMin).toBeCloseTo(driverMin, 3);
  });

  it("grounds Xbot's exact skinned surface in every floor-bound canonical phase", async () => {
    const character = rigCharacter(await loadXbot());
    const examples = new URL("../../../spec/examples/", import.meta.url);
    const files = fs.readdirSync(examples).filter((name) => name.endsWith(".posecode"));
    const failures: string[] = [];

    for (const file of files) {
      const { ir, errors } = parse(fs.readFileSync(new URL(file, examples), "utf8"));
      expect(errors, file).toEqual([]);
      if (!ir) continue;
      const timeline = buildTimeline(ir);
      const base = timeline.basePose.root;
      for (let phaseIndex = 0; phaseIndex < timeline.segments.length; phaseIndex++) {
        const authored = ir.phases[phaseIndex]!;
        const floorBound = authored.grips.length === 0 &&
          !authored.pins.some((pin) => pin.anchor !== "floor");
        if (!floorBound) continue;

        const driver = buildMannequin(undefined, character.proportions);
        driver.root.position.set(...(base?.position ?? [0, 0, 0]));
        const [rx, ry, rz] = base?.rotationDeg ?? [0, 0, 0];
        driver.root.rotation.set(
          THREE.MathUtils.degToRad(rx),
          THREE.MathUtils.degToRad(ry),
          THREE.MathUtils.degToRad(rz),
        );
        const segment = timeline.segments[phaseIndex]!;
        timeline.sample(segment.end - 1e-4, driver.bones);
        groundFigure(driver);
        character.sync(driver);
        character.reconcileFloor();
        const minY = character.getBounds().min.y;
        if (Math.abs(minY) >= 0.01) {
          failures.push(`${file}:${segment.name} minY=${minY.toFixed(4)}`);
        }
      }
    }

    expect(failures).toEqual([]);
  }, 20_000);
});
