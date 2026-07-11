/**
 * Skinned character layer: a realistic rigged human (Mixamo-convention GLB)
 * driven by the invisible procedural driver skeleton.
 *
 * The driver rig stays the single source of truth for ALL solving (FK poses,
 * ground-lock, pins, reach-IK, self-collision): its joint offsets are rebuilt
 * from the character's own joint positions so both skeletons are exactly
 * congruent, then every frame the character copies the driver's world-space
 * rotation deltas bone-for-bone (fingers included). Because the driver's rest
 * pose has identity rotations on every bone, the retarget reduces to:
 *
 *   charBone.world = driverBone.world * charBone.calibratedRestWorld
 *
 * Calibration happens once at load: the GLB ships in a T-pose, so the arms are
 * rotated down (palms forward, matching the driver's anatomical rest) and each
 * limb segment is aimed exactly along the driver's rest direction. After that
 * the two skeletons agree joint-for-joint in every pose, so floor contact and
 * prop pins solved on the driver are exact on the character too.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { Mannequin, Proportions } from "./mannequin.js";

/** Driver bone id → Mixamo bone name (without the "mixamorig" prefix). */
const BONE_MAP: Record<string, string> = {
  pelvis: "Hips",
  spine: "Spine",
  chest: "Spine2",
  neck: "Neck",
  head: "Head",
  shoulder_left: "LeftArm",
  elbow_left: "LeftForeArm",
  wrist_left: "LeftHand",
  shoulder_right: "RightArm",
  elbow_right: "RightForeArm",
  wrist_right: "RightHand",
  hip_left: "LeftUpLeg",
  knee_left: "LeftLeg",
  ankle_left: "LeftFoot",
  hip_right: "RightUpLeg",
  knee_right: "RightLeg",
  ankle_right: "RightFoot",
  thumb_left: "LeftHandThumb1",
  index_left: "LeftHandIndex1",
  middle_left: "LeftHandMiddle1",
  ring_left: "LeftHandRing1",
  pinky_left: "LeftHandPinky1",
  thumb_right: "RightHandThumb1",
  index_right: "RightHandIndex1",
  middle_right: "RightHandMiddle1",
  ring_right: "RightHandRing1",
  pinky_right: "RightHandPinky1",
};

/** Distal phalanges that mirror a driver finger's curl (bone → curl factor). */
const PHALANX_FOLLOW: [suffix: string, factor: number][] = [
  ["2", 0.9],
  ["3", 0.7],
];

/** Driver rest height the character is scaled to (matches the procedural rig). */
const DRIVER_HEIGHT = 1.75;
/** Fraction of the wrist→fingertip span where the driver knuckle sits. */
const KNUCKLE_T = 0.55;

export interface Character {
  /** Scene-level wrapper (scaled). Add this next to the mannequin root. */
  group: THREE.Group;
  /** Driver-skeleton overrides making the driver congruent with this mesh. */
  proportions: Proportions;
  /** Copy the driver's current pose onto the character skeleton. */
  sync(driver: Mannequin): void;
  /** Restore solved terminal contacts after a mocap layer has overwritten them. */
  correctContacts(driver: Mannequin, boneIds: readonly string[]): void;
  /**
   * The character's first skinned mesh, the retarget target for mocap clips
   * (see clips.ts). Null on bare skeletons, which then can't play clips.
   */
  skinnedMesh: THREE.SkinnedMesh | null;
  /** Bones `sync` writes every frame; the mocap layer blends against these. */
  drivenNodes: ReadonlySet<THREE.Object3D>;
  /** Free GPU resources. */
  dispose(): void;
}

const Y_UP = new THREE.Vector3(0, 1, 0);
const Y_DOWN = new THREE.Vector3(0, -1, 0);
const Z_FWD = new THREE.Vector3(0, 0, 1);

/**
 * Strip the mixamo namespace: "mixamorig:LeftArm", "mixamorigLeftArm", and
 * numbered re-exports like "mixamorig1:LeftArm" all → "LeftArm". (Colons are
 * already removed by GLTFLoader's name sanitizer at runtime.)
 */
function plainName(name: string): string {
  return name.replace(/^mixamorig\d*:?/i, "");
}

interface MappedBone {
  driverId: string;
  node: THREE.Object3D;
  /** Bone world quaternion at the calibrated rest, wrapper at identity. */
  restWorld: THREE.Quaternion;
  /** Bone local quaternion at the calibrated rest. */
  restLocal: THREE.Quaternion;
}

/**
 * Load a character GLB. Resolves once geometry + textures are ready; rejects on
 * network/parse failure (callers fall back to the procedural figure).
 */
export async function loadCharacter(url: string): Promise<Character> {
  const gltf = await new GLTFLoader().loadAsync(url);
  return rigCharacter(gltf.scene);
}

/**
 * Calibrate and wrap an already-loaded character scene. Exposed separately from
 * `loadCharacter` so the retarget math is testable without GLTF parsing.
 */
export function rigCharacter(charScene: THREE.Object3D): Character {
  const group = new THREE.Group();
  group.name = "posecode-character";
  group.add(charScene);

  // Index the skeleton by plain mixamo name.
  const byName = new Map<string, THREE.Object3D>();
  charScene.traverse((n) => {
    if ((n as THREE.Bone).isBone) byName.set(plainName(n.name), n);
  });

  const bone = (driverId: string): THREE.Object3D => {
    const n = byName.get(BONE_MAP[driverId]!);
    if (!n) throw new Error(`character: missing bone ${BONE_MAP[driverId]} (${driverId})`);
    return n;
  };
  // Every driver bone must exist before we touch anything.
  for (const id of Object.keys(BONE_MAP)) bone(id);

  charScene.updateMatrixWorld(true);

  // ---- Calibration: pose the T-pose rig into the driver's rest pose. ----
  // Aim constraints per bone: rotate (in world space) so the direction to the
  // named child joint matches the driver rest direction, and a roll reference
  // vector maps to the driver's forward. Torso/legs aim straight up/down with
  // forward staying +Z; arms aim straight down with the T-pose palm (world -Y)
  // turned to face forward (+Z), the driver's anatomical rest.
  const aim = (
    node: THREE.Object3D,
    childWorld: THREE.Vector3,
    aimTo: THREE.Vector3,
    rollFrom: THREE.Vector3,
    rollTo: THREE.Vector3,
  ): void => {
    node.updateWorldMatrix(true, false);
    const nodeWorld = node.getWorldPosition(new THREE.Vector3());
    const curAim = childWorld.clone().sub(nodeWorld).normalize();
    const rot = twoAxisRotation(curAim, rollFrom, aimTo, rollTo);
    // Apply the world-space rotation on the bone's local quaternion.
    const parentWorldQ = node.parent!.getWorldQuaternion(new THREE.Quaternion());
    node.quaternion.copy(
      parentWorldQ.clone().invert().multiply(rot).multiply(parentWorldQ).multiply(node.quaternion),
    );
    node.updateMatrixWorld(true);
  };

  const worldPos = (n: THREE.Object3D): THREE.Vector3 => {
    n.updateWorldMatrix(true, false);
    return n.getWorldPosition(new THREE.Vector3());
  };

  // The T-pose palm normal (world -Y) becomes the roll reference for arm
  // chains; torso/leg chains keep facing forward.
  const armRollFrom = Y_DOWN;

  // Torso chain: hips→spine→…→head aim +Y, forward stays +Z.
  const torsoAims: [string, string][] = [
    ["pelvis", "Spine"],
    ["spine", "Spine1"],
    ["chest", "Neck"],
    ["neck", "Head"],
    ["head", "HeadTop_End"],
  ];
  for (const [driverId, aimChild] of torsoAims) {
    const child = byName.get(aimChild);
    if (!child) continue; // HeadTop_End is optional in some rigs
    aim(bone(driverId), worldPos(child), Y_UP, Z_FWD, Z_FWD);
  }

  for (const side of ["left", "right"] as const) {
    const S = side === "left" ? "Left" : "Right";
    // Arms: T-pose (out along ±X, palm down) → straight down, palm forward.
    aim(bone(`shoulder_${side}`), worldPos(bone(`elbow_${side}`)), Y_DOWN, armRollFrom, Z_FWD);
    aim(bone(`elbow_${side}`), worldPos(bone(`wrist_${side}`)), Y_DOWN, armRollFrom, Z_FWD);
    aim(bone(`wrist_${side}`), worldPos(byName.get(`${S}HandMiddle1`)!), Y_DOWN, armRollFrom, Z_FWD);
    // Fingers: aim each first phalanx along its own knuckle direction so the
    // driver's digit pivot matches, but leave the distal phalanges at their
    // designed rest curl: fully straightened fingers read as spider hands.
    const wristPos = worldPos(bone(`wrist_${side}`));
    for (const fing of ["thumb", "index", "middle", "ring", "pinky"]) {
      const f1 = bone(`${fing}_${side}`);
      const dir = worldPos(f1).sub(wristPos).normalize();
      const next = f1.children.find((c) => (c as THREE.Bone).isBone);
      if (next) aim(f1, worldPos(next), dir, armRollFrom, Z_FWD);
    }
    // Legs: straight down, forward stays +Z. The foot then returns to its own
    // designed stance (heel down, toes forward) below.
    const footRest = bone(`ankle_${side}`).getWorldQuaternion(new THREE.Quaternion());
    aim(bone(`hip_${side}`), worldPos(bone(`knee_${side}`)), Y_DOWN, Z_FWD, Z_FWD);
    aim(bone(`knee_${side}`), worldPos(bone(`ankle_${side}`)), Y_DOWN, Z_FWD, Z_FWD);
    // Restore the foot's original world orientation (leg straightening tilted it).
    const ankle = bone(`ankle_${side}`);
    const parentQ = ankle.parent!.getWorldQuaternion(new THREE.Quaternion());
    ankle.quaternion.copy(parentQ.invert().multiply(footRest));
  }
  charScene.updateMatrixWorld(true);

  // ---- Measure the calibrated rest: scale, offsets, rest quaternions. ----
  // Mesh bounding box when there is one; bare skeletons (tests) fall back to
  // joint extents with a nominal head/sole allowance.
  const bbox = new THREE.Box3().setFromObject(charScene);
  const rawTop = byName.get("HeadTop_End") ?? bone("head");
  const minY = Number.isFinite(bbox.min.y) ? bbox.min.y : 0;
  const maxY = Number.isFinite(bbox.max.y)
    ? bbox.max.y
    : worldPos(rawTop).y + 0.12;
  const scale = DRIVER_HEIGHT / Math.max(0.5, maxY - minY);
  group.scale.setScalar(scale);

  // Joint positions AFTER the wrapper scale (worldPos sees the scaled tree).
  const jointPos = new Map<string, THREE.Vector3>();
  for (const id of Object.keys(BONE_MAP)) {
    jointPos.set(id, worldPos(bone(id)));
  }

  const offsets: Record<string, [number, number, number]> = {};
  const offsetOf = (id: string, parentId: string | null): void => {
    const p = jointPos.get(id)!;
    const base = parentId ? jointPos.get(parentId)! : new THREE.Vector3();
    offsets[id] = [p.x - base.x, p.y - base.y, p.z - base.z];
  };
  offsetOf("pelvis", null);
  offsetOf("spine", "pelvis");
  offsetOf("chest", "spine");
  offsetOf("neck", "chest");
  offsetOf("head", "neck");
  for (const side of ["left", "right"] as const) {
    offsetOf(`shoulder_${side}`, "chest");
    offsetOf(`elbow_${side}`, `shoulder_${side}`);
    offsetOf(`wrist_${side}`, `elbow_${side}`);
    offsetOf(`hip_${side}`, "pelvis");
    offsetOf(`knee_${side}`, `hip_${side}`);
    offsetOf(`ankle_${side}`, `knee_${side}`);
    // Driver finger offsets name the FINGERTIP; the bone sits at KNUCKLE_T of
    // that span. Place the fingertip so the knuckle lands exactly on the
    // character's first phalanx joint.
    for (const fing of ["thumb", "index", "middle", "ring", "pinky"]) {
      const id = `${fing}_${side}`;
      const knuckle = jointPos.get(id)!.clone().sub(jointPos.get(`wrist_${side}`)!);
      const tip = knuckle.multiplyScalar(1 / KNUCKLE_T);
      offsets[id] = [tip.x, tip.y, tip.z];
    }
  }

  // Vertical extent of the visible foot below the ankle joint: the driver's
  // shoe geometry is rebuilt to bottom out exactly where this mesh's soles do,
  // so bounding-box grounding rests the character's feet on the floor.
  const soleDrop = jointPos.get("ankle_left")!.y - minY * scale;
  // Skull height so supine/prone grounding accounts for the real head extent.
  const headTop = byName.get("HeadTop_End");
  const headLength = headTop
    ? worldPos(headTop).y - jointPos.get("head")!.y
    : 0.12;

  const proportions: Proportions = {
    offsets,
    soleDrop,
    headLength,
    // Self-collision radii tuned to a slim realistic mesh rather than the
    // chunkier procedural figure.
    collision: { torso: 0.105, head: 0.1, thigh: 0.068, shin: 0.05, arm: 0.034 },
  };

  // ---- Capture rest state for the per-frame retarget. ----
  const mapped: MappedBone[] = [];
  const mappedByNode = new Map<THREE.Object3D, MappedBone>();
  const mappedById = new Map<string, MappedBone>();
  for (const [driverId] of Object.entries(BONE_MAP)) {
    const node = bone(driverId);
    const mb: MappedBone = {
      driverId,
      node,
      restWorld: node.getWorldQuaternion(new THREE.Quaternion()),
      restLocal: node.quaternion.clone(),
    };
    mapped.push(mb);
    mappedByNode.set(node, mb);
    mappedById.set(driverId, mb);
  }
  // Distal phalanges: capture rest locals + the curl axis expressed in each
  // phalanx's rest-local frame (the driver curls fingers as a single bone; the
  // character folds all three knuckles for a natural fist).
  interface Phalanx {
    node: THREE.Object3D;
    restLocal: THREE.Quaternion;
    invRestWorld: THREE.Quaternion;
    factor: number;
    finger: string; // driver finger id
  }
  const phalanges: Phalanx[] = [];
  for (const [driverId, mixamo] of Object.entries(BONE_MAP)) {
    if (!/^(thumb|index|middle|ring|pinky)_/.test(driverId)) continue;
    for (const [suffix, factor] of PHALANX_FOLLOW) {
      const seg = byName.get(mixamo.replace(/1$/, suffix));
      if (!seg) continue;
      phalanges.push({
        node: seg,
        restLocal: seg.quaternion.clone(),
        invRestWorld: seg.getWorldQuaternion(new THREE.Quaternion()).invert(),
        factor,
        finger: driverId,
      });
    }
  }

  // Skinned meshes deform far beyond their bind-pose bounds; never cull them.
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });

  // ---- Per-frame retarget (see module doc for the math). ----
  const TMP_Q = new THREE.Quaternion();
  const TMP_Q2 = new THREE.Quaternion();
  const TMP_AXIS = new THREE.Vector3();

  function sync(driver: Mannequin): void {
    group.position.copy(driver.root.position);
    group.quaternion.copy(driver.root.quaternion);

    // Walk the character tree accumulating world quaternions, assigning mapped
    // bones from the driver as we descend (parents are final before children).
    const recurse = (node: THREE.Object3D, parentWorldQ: THREE.Quaternion): void => {
      const mb = mappedByNode.get(node);
      if (mb) {
        const driverBone = driver.bones.get(mb.driverId);
        if (driverBone) {
          driverBone.getWorldQuaternion(TMP_Q); // includes driver root
          // local = parentWorld⁻¹ · driverWorld · restWorld
          node.quaternion.copy(TMP_Q2.copy(parentWorldQ).invert().multiply(TMP_Q).multiply(mb.restWorld));
        }
      }
      const worldQ = parentWorldQ.clone().multiply(node.quaternion);
      for (const child of node.children) recurse(child, worldQ);
    };
    recurse(charScene, group.quaternion);

    // Fold the distal phalanges by the driver finger's curl angle.
    for (const ph of phalanges) {
      const driverFinger = driver.bones.get(ph.finger);
      if (!driverFinger) continue;
      // Driver finger locals are pure rotations in the wrist frame (== the
      // driver rest world frame): extract signed axis/angle directly.
      const q = driverFinger.quaternion;
      const angle = 2 * Math.acos(THREE.MathUtils.clamp(q.w, -1, 1));
      if (angle < 1e-4) {
        ph.node.quaternion.copy(ph.restLocal);
        continue;
      }
      const s = Math.sqrt(Math.max(1e-12, 1 - q.w * q.w));
      TMP_AXIS.set(q.x / s, q.y / s, q.z / s);
      // Express the curl axis in this phalanx's rest-local frame.
      TMP_AXIS.applyQuaternion(ph.invRestWorld);
      TMP_Q.setFromAxisAngle(TMP_AXIS, angle * ph.factor);
      ph.node.quaternion.copy(ph.restLocal).multiply(TMP_Q);
    }

    group.updateMatrixWorld(true);
  }

  function correctContacts(driver: Mannequin, boneIds: readonly string[]): void {
    const ids = [...new Set(boneIds)].filter((id) => mappedById.has(id) && driver.bones.has(id));
    if (ids.length === 0) return;

    group.updateMatrixWorld(true);
    const delta = new THREE.Vector3();
    const driverPos = new THREE.Vector3();
    const charPos = new THREE.Vector3();
    for (const id of ids) {
      driver.bones.get(id)!.getWorldPosition(driverPos);
      mappedById.get(id)!.node.getWorldPosition(charPos);
      delta.add(driverPos).sub(charPos);
    }
    group.position.add(delta.multiplyScalar(1 / ids.length));
    group.updateMatrixWorld(true);

    for (const id of ids) {
      const mb = mappedById.get(id)!;
      if (!mb.node.parent) continue;
      driver.bones.get(id)!.getWorldQuaternion(TMP_Q);
      const desiredWorld = TMP_Q2.copy(TMP_Q).multiply(mb.restWorld);
      mb.node.parent.getWorldQuaternion(TMP_Q);
      mb.node.quaternion.copy(TMP_Q.invert().multiply(desiredWorld));
      mb.node.updateMatrixWorld(true);
    }
    group.updateMatrixWorld(true);
  }

  // Surface for the optional mocap-clip layer (clips.ts): the retarget target
  // mesh and the set of bones sync() rewrites each frame.
  let skinnedMesh: THREE.SkinnedMesh | null = null;
  charScene.traverse((o) => {
    if (!skinnedMesh && (o as THREE.SkinnedMesh).isSkinnedMesh) {
      skinnedMesh = o as THREE.SkinnedMesh;
    }
  });
  const drivenNodes = new Set<THREE.Object3D>(mapped.map((m) => m.node));
  for (const ph of phalanges) drivenNodes.add(ph.node);

  return {
    group,
    proportions,
    sync,
    correctContacts,
    skinnedMesh,
    drivenNodes,
    dispose() {
      group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.geometry?.dispose();
          const mat = mesh.material;
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else mat?.dispose();
        }
      });
    },
  };
}

/**
 * The world-space rotation that maps direction `a1`→`b1` while turning the
 * roll reference `a2`→`b2` (both pairs orthonormalized against the aim).
 */
function twoAxisRotation(
  a1: THREE.Vector3,
  a2: THREE.Vector3,
  b1: THREE.Vector3,
  b2: THREE.Vector3,
): THREE.Quaternion {
  const fromM = frameOf(a1, a2);
  const toM = frameOf(b1, b2);
  const qFrom = new THREE.Quaternion().setFromRotationMatrix(fromM);
  const qTo = new THREE.Quaternion().setFromRotationMatrix(toM);
  return qTo.multiply(qFrom.invert());
}

/** Right-handed orthonormal frame with X = aim and Y ≈ ref (Gram-Schmidt). */
function frameOf(aim: THREE.Vector3, ref: THREE.Vector3): THREE.Matrix4 {
  const x = aim.clone().normalize();
  let y = ref.clone().sub(x.clone().multiplyScalar(ref.dot(x)));
  if (y.lengthSq() < 1e-8) {
    // Degenerate roll reference (parallel to aim): pick any perpendicular.
    y = Math.abs(x.y) < 0.9 ? new THREE.Vector3(0, 1, 0).cross(x) : new THREE.Vector3(1, 0, 0).cross(x);
  }
  y.normalize();
  const z = x.clone().cross(y);
  return new THREE.Matrix4().makeBasis(x, y, z);
}
