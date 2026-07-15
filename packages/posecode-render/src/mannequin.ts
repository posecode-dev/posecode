/**
 * Procedural stylized human figure.
 *
 * Built from rigid tapered-capsule segments and ellipsoid body volumes
 * parented to an Object3D bone hierarchy. No external assets, no skinning:
 * each bone is a joint node, and limb meshes hang off the proximal bone so
 * they follow its local rotation (forward kinematics).
 *
 * The look is "athletic figure" rather than "wooden mannequin": limbs taper
 * toward the distal joint, the torso has a ribcage/waist/hip silhouette,
 * deltoids round the shoulders, and a two-tone material split (skin vs.
 * athletic wear) makes the anatomy read at a glance.
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
  /** Body-part radii for the self-collision pass (metres). */
  collision: CollisionRadii;
}

/** Capsule/sphere radii approximating the visible body for self-collision. */
export interface CollisionRadii {
  torso: number;
  head: number;
  thigh: number;
  shin: number;
  arm: number;
}

/**
 * Overrides that rebuild the driver skeleton congruent with a loaded skinned
 * character: joint offsets measured from the character's calibrated rest pose,
 * plus the mesh extents that bounding-box grounding depends on.
 */
export interface Proportions {
  /** boneId → offset from parent joint (metres, parent rest frame). */
  offsets: Record<string, [number, number, number]>;
  /** Vertical extent of the visible foot below the ankle joint. */
  soleDrop?: number;
  /** Vertical extent of the head above the head joint (skull + hair). */
  headLength?: number;
  /** Collision radii matching the character's mesh. */
  collision?: CollisionRadii;
}

/** Radii for the chunky procedural figure (capsule segments + ellipsoids). */
const DEFAULT_COLLISION: CollisionRadii = {
  torso: 0.13,
  head: 0.105,
  thigh: 0.075,
  shin: 0.055,
  arm: 0.038,
};

/** Foot-mesh depth below the ankle bone in the default shoe (see addShoe). */
const DEFAULT_SOLE_DROP = 0.042;

interface BoneSpec {
  id: string;
  parent: string | null;
  /** Offset from parent joint, in metres, in the parent's rest frame. */
  offset: [number, number, number];
  /** Radius at the PROXIMAL end (parent joint) of the segment into this joint. */
  radius?: number;
  /** Radius at the DISTAL end (this joint). Defaults to `radius` (no taper). */
  radiusEnd?: number;
}

// Standing rest pose, Y-up, facing +Z. Roughly 1.75 m tall.
// NOTE: joint offsets are load-bearing (poses, IK, ground-lock, tests key off
// them); only the mesh radii/volumes below are cosmetic.
const SKELETON: BoneSpec[] = [
  { id: "pelvis", parent: null, offset: [0, 0.95, 0] },
  { id: "spine", parent: "pelvis", offset: [0, 0.14, 0], radius: 0.105, radiusEnd: 0.085 },
  { id: "chest", parent: "spine", offset: [0, 0.18, 0], radius: 0.085, radiusEnd: 0.1 },
  { id: "neck", parent: "chest", offset: [0, 0.16, 0], radius: 0.038, radiusEnd: 0.034 },
  { id: "head", parent: "neck", offset: [0, 0.1, 0], radius: 0.034 },

  { id: "shoulder_left", parent: "chest", offset: [0.18, 0.12, 0], radius: 0.042 },
  { id: "elbow_left", parent: "shoulder_left", offset: [0, -0.28, 0], radius: 0.05, radiusEnd: 0.038 },
  { id: "wrist_left", parent: "elbow_left", offset: [0, -0.26, 0], radius: 0.042, radiusEnd: 0.028 },

  { id: "shoulder_right", parent: "chest", offset: [-0.18, 0.12, 0], radius: 0.042 },
  { id: "elbow_right", parent: "shoulder_right", offset: [0, -0.28, 0], radius: 0.05, radiusEnd: 0.038 },
  { id: "wrist_right", parent: "elbow_right", offset: [0, -0.26, 0], radius: 0.042, radiusEnd: 0.028 },

  { id: "hip_left", parent: "pelvis", offset: [0.1, -0.06, 0], radius: 0.06 },
  { id: "knee_left", parent: "hip_left", offset: [0, -0.45, 0], radius: 0.078, radiusEnd: 0.056 },
  { id: "ankle_left", parent: "knee_left", offset: [0, -0.43, 0], radius: 0.052, radiusEnd: 0.032 },

  { id: "hip_right", parent: "pelvis", offset: [-0.1, -0.06, 0], radius: 0.06 },
  { id: "knee_right", parent: "hip_right", offset: [0, -0.45, 0], radius: 0.078, radiusEnd: 0.056 },
  { id: "ankle_right", parent: "knee_right", offset: [0, -0.43, 0], radius: 0.052, radiusEnd: 0.032 },

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

/** Two-tone palette: skin plus simple athletic wear. */
interface FigureMaterials {
  skin: THREE.Material;
  top: THREE.Material;
  shorts: THREE.Material;
  shoes: THREE.Material;
  hair: THREE.Material;
  face: THREE.Material;
  mouth: THREE.Material;
}

function defaultMaterials(): FigureMaterials {
  const std = (color: number, roughness: number): THREE.MeshStandardMaterial =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });
  return {
    skin: std(0xd9a98c, 0.55),
    top: std(0x35707e, 0.6),
    shorts: std(0x262c38, 0.7),
    shoes: std(0xe8e5de, 0.5),
    hair: std(0x2e2622, 0.65),
    face: std(0x22262e, 0.6),
    mouth: std(0xb5765f, 0.6),
  };
}

/** Segments dressed by the athletic top (drawn INTO these joints). */
const TOP_SEGMENTS = new Set(["spine", "chest", "neck"]);
/** Segments dressed by the shorts. */
const SHORTS_SEGMENTS = new Set(["knee_left", "knee_right"]);

/** Pick the material for the segment drawn from `parent` into `id`. */
function segmentMaterial(id: string, mats: FigureMaterials): THREE.Material {
  if (TOP_SEGMENTS.has(id)) return mats.top;
  if (SHORTS_SEGMENTS.has(id)) return mats.shorts;
  return mats.skin;
}

/**
 * Build the figure. `material` overrides the whole palette (embed theming).
 * `proportions` rebuilds the skeleton congruent with a loaded skinned
 * character (see character.ts); the procedural meshes are then hidden but keep
 * feeding the bounding-box grounding, so contact solving matches the mesh.
 */
export function buildMannequin(material?: THREE.Material, proportions?: Proportions): Mannequin {
  const mats = material
    ? {
        skin: material,
        top: material,
        shorts: material,
        shoes: material,
        hair: material,
        face: material,
        mouth: material,
      }
    : defaultMaterials();

  const root = new THREE.Group();
  root.name = "posecode-mannequin";

  const bones = new Map<string, THREE.Object3D>();

  for (const spec of SKELETON) {
    const bone = new THREE.Object3D();
    bone.name = spec.id;
    // Finger bones sit at the knuckle; the offset names the fingertip.
    const offset = new THREE.Vector3(...(proportions?.offsets[spec.id] ?? spec.offset));
    if (isFinger(spec.id)) offset.multiplyScalar(KNUCKLE_T);
    bone.position.copy(offset);

    const parent = spec.parent ? bones.get(spec.parent) : root;
    (parent ?? root).add(bone);
    bones.set(spec.id, bone);

    // Draw the segment from the parent joint to this joint, on the parent.
    if (spec.parent && spec.radius) {
      const mat = segmentMaterial(spec.id, mats);
      const seg = isFinger(spec.id)
        ? makeSegment(offset.length(), spec.radius, mats.skin)
        : makeTaperedSegment(offset.length(), spec.radius, spec.radiusEnd ?? spec.radius, mat);
      orientSegment(seg, offset);
      bones.get(spec.parent)!.add(seg);
    }
  }

  // Digit meshes ON the finger bones, spanning knuckle → fingertip, so a
  // finger curl visibly folds at the knuckle.
  for (const spec of SKELETON) {
    if (!isFinger(spec.id) || !spec.radius) continue;
    const full = new THREE.Vector3(...(proportions?.offsets[spec.id] ?? spec.offset));
    const span = full.clone().multiplyScalar(1 - KNUCKLE_T);
    const digit = makeSegment(span.length(), spec.radius * 0.92, mats.skin);
    orientSegment(digit, span);
    bones.get(spec.id)!.add(digit);
  }

  addTorso(bones, mats);
  addHead(bones.get("head")!, mats, proportions?.headLength);
  addPalm(bones.get("wrist_left")!, mats.skin);
  addPalm(bones.get("wrist_right")!, mats.skin);
  addShoe(bones.get("ankle_left")!, mats, proportions?.soleDrop);
  addShoe(bones.get("ankle_right")!, mats, proportions?.soleDrop);

  return {
    root,
    bones,
    effectors: {
      hands: ["wrist_left", "wrist_right"],
      hand_left: ["wrist_left"],
      hand_right: ["wrist_right"],
      forearms: ["elbow_left", "elbow_right"],
      elbow_left: ["elbow_left"],
      elbow_right: ["elbow_right"],
      feet: ["ankle_left", "ankle_right"],
      foot_left: ["ankle_left"],
      foot_right: ["ankle_right"],
    },
    collision: proportions?.collision ?? DEFAULT_COLLISION,
  };
}

/** A capsule of the given segment length, oriented along +Y, centred at origin. */
function makeSegment(length: number, radius: number, mat: THREE.Material): THREE.Mesh {
  const body = Math.max(0.001, length - radius * 2);
  const geo = new THREE.CapsuleGeometry(radius, body, 4, 10);
  return new THREE.Mesh(geo, mat);
}

/**
 * A limb segment that tapers from `rProx` at the parent joint to `rDist` at
 * the child joint, with rounded hemisphere caps at both ends so elbows/knees
 * stay smooth mid-flex. Oriented along +Y (proximal end at -Y), centred at
 * origin so `orientSegment` places it exactly like a capsule.
 */
function makeTaperedSegment(
  length: number,
  rProx: number,
  rDist: number,
  mat: THREE.Material,
): THREE.Object3D {
  const group = new THREE.Group();
  // +Y end maps to the CHILD joint after orientSegment (dir = offset).
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(rDist, rProx, length, 22, 1), mat);
  group.add(shaft);
  const capDist = new THREE.Mesh(new THREE.SphereGeometry(rDist, 22, 16), mat);
  capDist.position.y = length / 2;
  group.add(capDist);
  const capProx = new THREE.Mesh(new THREE.SphereGeometry(rProx, 22, 16), mat);
  capProx.position.y = -length / 2;
  group.add(capProx);
  return group;
}

/** Position/orient a +Y segment so it spans from the parent joint to `offset`. */
function orientSegment(seg: THREE.Object3D, offset: THREE.Vector3): void {
  const dir = offset.clone().normalize();
  const up = new THREE.Vector3(0, 1, 0);
  seg.quaternion.setFromUnitVectors(up, dir);
  seg.position.copy(offset.clone().multiplyScalar(0.5));
}

/** A sphere scaled into an ellipsoid: the basic body-volume building block. */
function addEllipsoid(
  bone: THREE.Object3D,
  radius: number,
  scale: [number, number, number],
  position: [number, number, number],
  mat: THREE.Material,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 24, 18), mat);
  mesh.scale.set(...scale);
  mesh.position.set(...position);
  bone.add(mesh);
  return mesh;
}

/**
 * Torso volumes: hips on the pelvis, a ribcage spanning the chest, and
 * deltoid caps on the shoulder joints. Together with the tapered waist
 * segment these give the figure a human silhouette instead of a bead chain.
 */
function addTorso(bones: Map<string, THREE.Object3D>, mats: FigureMaterials): void {
  // Hips: wide, slightly flattened, dressed in shorts.
  addEllipsoid(bones.get("pelvis")!, 0.09, [1.4, 1.0, 1.05], [0, -0.02, 0], mats.shorts);
  // Ribcage: broad across the shoulders, shallow front-to-back. Named so the
  // viewer's life layer can swell it for breathing (a mesh-only effect that
  // can never disturb the skeleton or the solved pose).
  const ribcage = addEllipsoid(bones.get("chest")!, 0.1, [1.5, 1.22, 0.82], [0, 0.03, 0], mats.top);
  ribcage.name = "ribcage";
  // Deltoids round off the shoulder line.
  addEllipsoid(bones.get("shoulder_left")!, 0.057, [1.02, 1.12, 1.02], [-0.006, -0.012, 0], mats.top);
  addEllipsoid(bones.get("shoulder_right")!, 0.057, [1.02, 1.12, 1.02], [0.006, -0.012, 0], mats.top);
}

/**
 * Head: an ellipsoid skull with a hair cap and a simple face (eyes + nose)
 * on the front (+Z). The face keeps head yaw/turns readable from any angle;
 * the hair breaks the "billiard ball" look and marks up-vs-down in inversions.
 */
function addHead(head: THREE.Object3D, mats: FigureMaterials, headLength?: number): void {
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.062, 20, 16), mats.skin);
  // With `headLength`, stretch the skull so its top matches a character's real
  // head extent: supine/prone grounding then rests the visible head correctly.
  const scaleY = headLength ? Math.max(1.12, (headLength - 0.01) / 0.062) : 1.12;
  skull.scale.set(0.92, scaleY, 0.98);
  skull.position.y = 0.01;
  head.add(skull);

  // Hair: a slightly larger partial sphere hugging the top/back of the skull.
  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(0.0655, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.55),
    mats.hair,
  );
  hair.scale.set(0.95, 1.08, 1.02);
  hair.position.set(0, 0.016, -0.008);
  hair.rotation.x = -0.12;
  head.add(hair);

  const face = new THREE.Group();
  face.name = "face";

  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.011, 0.028, 10), mats.skin);
  nose.rotation.x = Math.PI / 2; // cone +Y → +Z
  nose.position.set(0, -0.002, 0.062);
  face.add(nose);

  // Eyes are named so the viewer's life layer can find and blink them.
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.0085, 10, 8), mats.face);
    eye.name = sx < 0 ? "eye_left" : "eye_right";
    eye.position.set(sx * 0.023, 0.018, 0.052);
    face.add(eye);
  }

  // A muted mouth line completes the face without cartooning it.
  const mouth = new THREE.Mesh(new THREE.CapsuleGeometry(0.0038, 0.016, 4, 8), mats.mouth);
  mouth.rotation.z = Math.PI / 2;
  mouth.scale.set(1, 1, 0.55);
  mouth.position.set(0, -0.024, 0.055);
  face.add(mouth);

  head.add(face);
}

/** A flattened palm instead of a ball: hands read as hands, not maracas. */
function addPalm(wrist: THREE.Object3D, mat: THREE.Material): void {
  addEllipsoid(wrist, 0.045, [0.85, 1.05, 0.5], [0, -0.02, 0.004], mat);
}

/**
 * A sneaker-shaped foot: rounded upper + thin sole. Sole depth matches the
 * old foot box (bottom ≈ -0.04) so ground contact height is unchanged. With
 * `soleDrop`, the whole shoe shifts down so its bottom sits that far below the
 * ankle joint: characters carry their ankle higher above the floor, and the
 * bounding-box grounding must plant THEIR sole, not the default one.
 */
function addShoe(ankle: THREE.Object3D, mats: FigureMaterials, soleDrop?: number): void {
  const dy = soleDrop !== undefined ? -(soleDrop - DEFAULT_SOLE_DROP) : 0;
  addEllipsoid(ankle, 0.05, [0.75, 0.55, 1.9], [0, -0.012 + dy, 0.05], mats.shoes);
  const sole = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.012, 0.185), mats.face);
  sole.position.set(0, -0.036 + dy, 0.05);
  ankle.add(sole);
}
