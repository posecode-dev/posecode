/**
 * Procedural low-poly mannequin.
 *
 * Built from rigid capsule/sphere segments parented to an Object3D bone
 * hierarchy — the "wooden artist mannequin" look. No external assets, no
 * skinning: each bone is a joint node, and limb meshes hang off the proximal
 * bone so they follow its local rotation (forward kinematics).
 *
 * Bone ids and the local-axis convention match `movit-parser/joints.ts`.
 */

import * as THREE from "three";

export interface Mannequin {
  root: THREE.Group;
  /** boneId → joint node. Rotate these (local Euler, radians) to pose. */
  bones: Map<string, THREE.Object3D>;
  /** Effector group name → the distal joint nodes used for ground-lock. */
  effectors: Record<string, string[]>;
}

interface BoneSpec {
  id: string;
  parent: string | null;
  /** Offset from parent joint, in metres, in the parent's rest frame. */
  offset: [number, number, number];
  /** Radius of the limb segment leading INTO this joint from its parent. */
  radius?: number;
}

// Standing rest pose, Y-up, facing +Z. Roughly 1.75 m tall.
const SKELETON: BoneSpec[] = [
  { id: "pelvis", parent: null, offset: [0, 0.95, 0] },
  { id: "spine", parent: "pelvis", offset: [0, 0.14, 0], radius: 0.09 },
  { id: "chest", parent: "spine", offset: [0, 0.18, 0], radius: 0.1 },
  { id: "neck", parent: "chest", offset: [0, 0.16, 0], radius: 0.05 },
  { id: "head", parent: "neck", offset: [0, 0.1, 0], radius: 0.045 },

  { id: "shoulder_left", parent: "chest", offset: [0.18, 0.12, 0], radius: 0.045 },
  { id: "elbow_left", parent: "shoulder_left", offset: [0, -0.28, 0], radius: 0.04 },
  { id: "wrist_left", parent: "elbow_left", offset: [0, -0.26, 0], radius: 0.035 },

  { id: "shoulder_right", parent: "chest", offset: [-0.18, 0.12, 0], radius: 0.045 },
  { id: "elbow_right", parent: "shoulder_right", offset: [0, -0.28, 0], radius: 0.04 },
  { id: "wrist_right", parent: "elbow_right", offset: [0, -0.26, 0], radius: 0.035 },

  { id: "hip_left", parent: "pelvis", offset: [0.1, -0.06, 0], radius: 0.06 },
  { id: "knee_left", parent: "hip_left", offset: [0, -0.45, 0], radius: 0.05 },
  { id: "ankle_left", parent: "knee_left", offset: [0, -0.43, 0], radius: 0.04 },

  { id: "hip_right", parent: "pelvis", offset: [-0.1, -0.06, 0], radius: 0.06 },
  { id: "knee_right", parent: "hip_right", offset: [0, -0.45, 0], radius: 0.05 },
  { id: "ankle_right", parent: "knee_right", offset: [0, -0.43, 0], radius: 0.04 },
];

/** Build the mannequin. `material` lets the playground theme it. */
export function buildMannequin(material?: THREE.Material): Mannequin {
  const mat =
    material ??
    new THREE.MeshStandardMaterial({
      color: 0xc6ced8,
      roughness: 0.42,
      metalness: 0.0,
      flatShading: false,
    });

  const root = new THREE.Group();
  root.name = "movit-mannequin";

  const bones = new Map<string, THREE.Object3D>();

  for (const spec of SKELETON) {
    const bone = new THREE.Object3D();
    bone.name = spec.id;
    bone.position.set(...spec.offset);

    const parent = spec.parent ? bones.get(spec.parent) : root;
    (parent ?? root).add(bone);
    bones.set(spec.id, bone);

    // Draw the segment from the parent joint to this joint, on the parent.
    if (spec.parent && spec.radius) {
      const length = Math.hypot(...spec.offset);
      const seg = makeSegment(length, spec.radius, mat);
      orientSegment(seg, new THREE.Vector3(...spec.offset));
      bones.get(spec.parent)!.add(seg);
    }
  }

  // Head sphere + small hand/foot caps for readability.
  addBall(bones.get("head")!, 0.12, mat);
  addBall(bones.get("wrist_left")!, 0.05, mat);
  addBall(bones.get("wrist_right")!, 0.05, mat);
  addFoot(bones.get("ankle_left")!, mat);
  addFoot(bones.get("ankle_right")!, mat);
  addBall(bones.get("pelvis")!, 0.13, mat);

  return {
    root,
    bones,
    effectors: {
      hands: ["wrist_left", "wrist_right"],
      feet: ["ankle_left", "ankle_right"],
    },
  };
}

/** A capsule of the given segment length, oriented along +Y, centred at origin. */
function makeSegment(length: number, radius: number, mat: THREE.Material): THREE.Mesh {
  const body = Math.max(0.001, length - radius * 2);
  const geo = new THREE.CapsuleGeometry(radius, body, 4, 10);
  return new THREE.Mesh(geo, mat);
}

/** Position/orient a +Y capsule so it spans from the parent joint to `offset`. */
function orientSegment(seg: THREE.Mesh, offset: THREE.Vector3): void {
  const dir = offset.clone().normalize();
  const up = new THREE.Vector3(0, 1, 0);
  seg.quaternion.setFromUnitVectors(up, dir);
  seg.position.copy(offset.clone().multiplyScalar(0.5));
}

function addBall(bone: THREE.Object3D, diameter: number, mat: THREE.Material): void {
  const geo = new THREE.SphereGeometry(diameter / 2, 12, 10);
  bone.add(new THREE.Mesh(geo, mat));
}

function addFoot(bone: THREE.Object3D, mat: THREE.Material): void {
  const geo = new THREE.BoxGeometry(0.07, 0.04, 0.16);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(0, -0.02, 0.05);
  bone.add(mesh);
}
