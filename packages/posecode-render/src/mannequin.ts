/**
 * Procedural low-poly mannequin.
 *
 * Built from rigid capsule/sphere segments parented to an Object3D bone
 * hierarchy: the "wooden artist mannequin" look. No external assets, no
 * skinning: each bone is a joint node, and limb meshes hang off the proximal
 * bone so they follow its local rotation (forward kinematics).
 *
 * Bone ids and the local-axis convention match `posecode-parser/joints.ts`.
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

  // Fingers: one curl DOF each (flex), splayed in X and angled slightly
  // forward (+Z, palm-side). Offsets are the FINGERTIP position; the bone is
  // placed partway along at the knuckle (KNUCKLE_T) so the wrist-drawn segment
  // becomes the rigid palm/metacarpal and the bone carries its own digit mesh,
  // otherwise curling a finger rotates an empty node and the hand never moves.
  { id: "thumb_left", parent: "wrist_left", offset: [0.035, -0.04, 0.025], radius: 0.014 },
  { id: "index_left", parent: "wrist_left", offset: [0.025, -0.085, 0.012], radius: 0.013 },
  { id: "middle_left", parent: "wrist_left", offset: [0.008, -0.092, 0.012], radius: 0.013 },
  { id: "ring_left", parent: "wrist_left", offset: [-0.01, -0.088, 0.012], radius: 0.013 },
  { id: "pinky_left", parent: "wrist_left", offset: [-0.028, -0.075, 0.012], radius: 0.012 },

  { id: "thumb_right", parent: "wrist_right", offset: [-0.035, -0.04, 0.025], radius: 0.014 },
  { id: "index_right", parent: "wrist_right", offset: [-0.025, -0.085, 0.012], radius: 0.013 },
  { id: "middle_right", parent: "wrist_right", offset: [-0.008, -0.092, 0.012], radius: 0.013 },
  { id: "ring_right", parent: "wrist_right", offset: [0.01, -0.088, 0.012], radius: 0.013 },
  { id: "pinky_right", parent: "wrist_right", offset: [0.028, -0.075, 0.012], radius: 0.012 },
];

/** Fraction of the wrist→fingertip span where the knuckle (finger bone) sits. */
const KNUCKLE_T = 0.55;

function isFinger(id: string): boolean {
  return /^(thumb|index|middle|ring|pinky)_/.test(id);
}

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
  root.name = "posecode-mannequin";

  const bones = new Map<string, THREE.Object3D>();

  for (const spec of SKELETON) {
    const bone = new THREE.Object3D();
    bone.name = spec.id;
    // Finger bones sit at the knuckle; the offset names the fingertip.
    const offset = new THREE.Vector3(...spec.offset);
    if (isFinger(spec.id)) offset.multiplyScalar(KNUCKLE_T);
    bone.position.copy(offset);

    const parent = spec.parent ? bones.get(spec.parent) : root;
    (parent ?? root).add(bone);
    bones.set(spec.id, bone);

    // Draw the segment from the parent joint to this joint, on the parent.
    if (spec.parent && spec.radius) {
      const seg = makeSegment(offset.length(), spec.radius, mat);
      orientSegment(seg, offset);
      bones.get(spec.parent)!.add(seg);
    }
  }

  // Digit meshes ON the finger bones, spanning knuckle → fingertip, so a
  // finger curl visibly folds at the knuckle.
  for (const spec of SKELETON) {
    if (!isFinger(spec.id) || !spec.radius) continue;
    const full = new THREE.Vector3(...spec.offset);
    const span = full.clone().multiplyScalar(1 - KNUCKLE_T);
    const digit = makeSegment(span.length(), spec.radius * 0.92, mat);
    orientSegment(digit, span);
    bones.get(spec.id)!.add(digit);
  }

  // Head sphere + small hand/foot caps for readability.
  addBall(bones.get("head")!, 0.12, mat);
  addFace(bones.get("head")!);
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

/**
 * A minimal face (nose wedge + two eye studs) on the head's front (+Z).
 * The bare sphere hid which way the figure faces, making neck rotations and
 * turns unreadable; darker studs poke just past the head surface so facing
 * reads at a glance from any camera angle.
 */
function addFace(head: THREE.Object3D): void {
  const mat = new THREE.MeshStandardMaterial({ color: 0x39424e, roughness: 0.6 });
  const face = new THREE.Group();
  face.name = "face";

  // Head ball radius is 0.06 (see addBall(head, 0.12)).
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.013, 0.035, 10), mat);
  nose.rotation.x = Math.PI / 2; // cone +Y → +Z
  nose.position.set(0, -0.004, 0.064);
  face.add(nose);

  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.0095, 10, 8), mat);
    eye.position.set(sx * 0.024, 0.016, 0.054);
    face.add(eye);
  }

  head.add(face);
}

function addFoot(bone: THREE.Object3D, mat: THREE.Material): void {
  const geo = new THREE.BoxGeometry(0.07, 0.04, 0.16);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(0, -0.02, 0.05);
  bone.add(mesh);
}
