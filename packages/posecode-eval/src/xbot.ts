/** Node-only loader for the same XBot proportions used by the web playground. */
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { rigCharacter, type Character, type Proportions } from "posecode-render";

export async function loadXbotCharacter(asset: URL): Promise<Character> {
  const bytes = readFileSync(asset);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const scene = await new Promise<THREE.Object3D>((resolve, reject) => {
    new GLTFLoader().parse(buffer, "", (gltf) => resolve(gltf.scene), reject);
  });
  return rigCharacter(scene);
}

export async function loadXbotProportions(asset: URL): Promise<Proportions> {
  const character = await loadXbotCharacter(asset);
  const proportions = character.proportions;
  character.dispose();
  return proportions;
}
