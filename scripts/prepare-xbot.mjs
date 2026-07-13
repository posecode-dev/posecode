#!/usr/bin/env node
/**
 * Normalize Mixamo's Xbot FBX into the single-skeleton GLB used at runtime.
 *
 * Mixamo exports Beta_Surface and Beta_Joints with separate copies of the same
 * skeleton. Posecode needs one unambiguous bone tree, so the runtime character
 * uses the complete Beta_Surface mesh/skeleton. The decorative joint shell is
 * deliberately omitted; it can return later as a rigid overlay after the core
 * retarget path is stable.
 *
 * Usage: node scripts/prepare-xbot.mjs <input.fbx> [output.glb]
 */
import fs from "node:fs";
import path from "node:path";
import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

globalThis.ProgressEvent ??= class ProgressEvent {};
globalThis.FileReader ??= class FileReader {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((result) => {
      this.result = result;
      this.onloadend?.();
    }, (error) => this.onerror?.(error));
  }

  readAsDataURL(blob) {
    blob.arrayBuffer().then((result) => {
      this.result = `data:${blob.type};base64,${Buffer.from(result).toString("base64")}`;
      this.onloadend?.();
    }, (error) => this.onerror?.(error));
  }
};

const input = process.argv[2];
const output = process.argv[3] ?? "playground/public/models/xbot.glb";
if (!input) throw new Error("usage: node scripts/prepare-xbot.mjs <input.fbx> [output.glb]");

const bytes = fs.readFileSync(input);
const scene = new FBXLoader().parse(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  `${path.dirname(input)}/`,
);

let surface = null;
let joints = null;
const remove = [];
scene.traverse((node) => {
  if (node.isSkinnedMesh && node.name === "Beta_Surface") surface = node;
  if (node.isSkinnedMesh && node.name === "Beta_Joints") joints = node;
  // The second skeleton is nested under the primary Hips in Mixamo's Xbot.
  if (node.isBone && /Hips$/.test(node.name) && node.parent?.isBone) remove.push(node);
});
if (!surface) throw new Error("Xbot normalization: Beta_Surface was not found");
if (!joints) throw new Error("Xbot normalization: Beta_Joints was not found");
for (const node of remove) node.removeFromParent();

const boneNames = new Set(surface.skeleton.bones.map((bone) => bone.name));
if (boneNames.size !== surface.skeleton.bones.length) {
  throw new Error("Xbot normalization: primary skeleton still has duplicate bone names");
}

// Re-index the decorative joint shell onto the primary skeleton. Both meshes
// use the same Mixamo names but export separate bone objects (and Beta_Joints
// omits one terminal bone), so indices must be translated by name first.
const primaryIndex = new Map(surface.skeleton.bones.map((bone, index) => [bone.name, index]));
const jointToPrimary = joints.skeleton.bones.map((bone) => {
  const index = primaryIndex.get(bone.name);
  if (index === undefined) throw new Error(`Xbot normalization: unmapped joint bone ${bone.name}`);
  return index;
});
const jointSkinIndex = joints.geometry.getAttribute("skinIndex");
for (let vertex = 0; vertex < jointSkinIndex.count; vertex++) {
  for (let lane = 0; lane < jointSkinIndex.itemSize; lane++) {
    const source = jointSkinIndex.getComponent(vertex, lane);
    jointSkinIndex.setComponent(vertex, lane, jointToPrimary[source]);
  }
}
jointSkinIndex.needsUpdate = true;

// Bake Mixamo centimeters into Posecode meters. Scaling the wrapper around a
// live skin makes Xbot's bone matrices participate in that scale as well; bake
// it into vertices + joint translations and rebuild inverse binds instead.
scene.updateMatrixWorld(true);
const bounds = new THREE.Box3().setFromObject(surface);
const unitScale = 1.75 / bounds.getSize(new THREE.Vector3()).y;
surface.geometry.scale(unitScale, unitScale, unitScale);
joints.geometry.scale(unitScale, unitScale, unitScale);
surface.geometry = mergeVertices(surface.geometry, 1e-4);
joints.geometry = mergeVertices(joints.geometry, 1e-4);
for (const bone of surface.skeleton.bones) bone.position.multiplyScalar(unitScale);
scene.updateMatrixWorld(true);
surface.bind(surface.skeleton);
surface.normalizeSkinWeights();
joints.bind(surface.skeleton);
joints.normalizeSkinWeights();

// FBX legacy materials import almost black on Posecode's dark stage. Produce a
// stable runtime PBR material rather than depending on converter heuristics.
const oldMaterials = Array.isArray(surface.material) ? surface.material : [surface.material];
for (const material of oldMaterials) material?.dispose();
surface.material = new THREE.MeshStandardMaterial({
  color: 0xb9c0cc,
  metalness: 0.08,
  roughness: 0.68,
});
const oldJointMaterials = Array.isArray(joints.material) ? joints.material : [joints.material];
for (const material of oldJointMaterials) material?.dispose();
joints.material = new THREE.MeshStandardMaterial({
  color: 0x48515f,
  metalness: 0.12,
  roughness: 0.62,
});

const glb = await new GLTFExporter().parseAsync(scene, {
  animations: [],
  binary: true,
  onlyVisible: true,
});
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, Buffer.from(glb));
console.log(`Prepared ${output}: ${surface.skeleton.bones.length} bones, ${surface.geometry.attributes.position.count + joints.geometry.attributes.position.count} vertices, scale ${unitScale.toFixed(6)}`);
