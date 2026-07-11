/**
 * Optional mocap-clip layer: play a retargeted animation clip (e.g. a Mixamo
 * walk) on the skinned character instead of — or crossfaded with — the
 * procedural DSL keyframes.
 *
 * Pipeline: `loadClipSource` fetches an FBX/GLB and picks its strongest moving
 * AnimationClip; `retargetMocapClip` bakes it onto the character's skeleton
 * with SkeletonUtils.retargetClip (both rigs follow Mixamo naming, so bones
 * pair up by suffix); `createClipLayer` plays the result through a
 * THREE.AnimationMixer and blends it over whatever pose the procedural path
 * already wrote this frame. The procedural path stays the source of truth:
 * any missing asset, missing character, or retarget failure simply leaves the
 * clip layer off.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import {
  retargetClip,
  type RetargetClipOptions,
} from "three/examples/jsm/utils/SkeletonUtils.js";

/** Strip the mixamo namespace, mirroring character.ts's bone-name matching. */
function plainName(name: string): string {
  return name.replace(/^mixamorig\d*:?/i, "");
}

export interface ClipSource {
  /** The loaded asset's scene root (holds the source skeleton). */
  root: THREE.Object3D;
  /** The most motion-rich animation found in the asset. */
  clip: THREE.AnimationClip;
}

/**
 * Prefer the take with real changing bone tracks over long bind-pose/default
 * takes commonly embedded beside a Mixamo animation in FBX exports.
 */
export function selectMotionClip(animations: readonly THREE.AnimationClip[]): THREE.AnimationClip | null {
  let best: THREE.AnimationClip | null = null;
  let bestScore = -Infinity;
  for (const clip of animations) {
    let movingTracks = 0;
    let motion = 0;
    for (const track of clip.tracks) {
      const frames = track.times.length;
      const stride = frames > 0 ? track.values.length / frames : 0;
      if (frames < 2 || stride < 1) continue;
      let trackMotion = 0;
      for (let frame = 1; frame < frames; frame++) {
        let deltaSq = 0;
        for (let component = 0; component < stride; component++) {
          const a = track.values[(frame - 1) * stride + component]!;
          const b = track.values[frame * stride + component]!;
          deltaSq += (b - a) * (b - a);
        }
        trackMotion += Math.sqrt(deltaSq);
      }
      trackMotion /= frames - 1;
      if (trackMotion > 1e-5) {
        movingTracks++;
        motion += Math.min(trackMotion, 10);
      }
    }
    const score = movingTracks * 100 + motion + Math.min(clip.duration, 10) * 0.001;
    if (score > bestScore) {
      best = clip;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Load a mocap asset (.fbx or .glb/.gltf) and pick its most motion-rich clip. Rejects
 * when the asset has no animations; callers treat any rejection as "keep the
 * procedural path".
 */
export async function loadClipSource(url: string): Promise<ClipSource> {
  const isFbx = /\.fbx(\?.*)?$/i.test(url);
  let root: THREE.Object3D;
  let animations: THREE.AnimationClip[];
  if (isFbx) {
    const group = await new FBXLoader().loadAsync(url);
    root = group;
    animations = group.animations;
  } else {
    const gltf = await new GLTFLoader().loadAsync(url);
    root = gltf.scene;
    animations = gltf.animations;
  }
  const clip = selectMotionClip(animations);
  if (!clip) throw new Error(`clip asset has no animations: ${url}`);
  return { root, clip };
}

/**
 * Bake `clip` (animating the bones under `sourceRoot`) onto the target
 * character's skeleton. Returns a new clip whose tracks bind as
 * `.bones[<name>]` on a mixer rooted at the target SkinnedMesh.
 *
 * Beyond the raw SkeletonUtils bake this:
 * - maps bones by plain Mixamo name so namespace prefixes ("mixamorig:",
 *   "mixamorig1") never break the pairing;
 * - snapshots and restores every target bone transform: retargetClip resets
 *   the skeleton to its BIND pose (the T-pose), which would silently destroy
 *   the anatomical rest calibration character.ts applied at load;
 * - drops tracks for target bones with no source counterpart (retargetClip
 *   emits bind-pose constants for those, which would snap fingers or helper
 *   bones into the T-pose at full weight);
 * - pins the hip X/Z translation to the rest stance while keeping the
 *   vertical bob, so a traveling source clip plays in place and composes with
 *   the DSL's own `travel`/`turn` root choreography.
 */
export function retargetMocapClip(
  target: THREE.SkinnedMesh,
  sourceRoot: THREE.Object3D,
  clip: THREE.AnimationClip,
): THREE.AnimationClip {
  sourceRoot.updateMatrixWorld(true);
  const sourceBones: THREE.Bone[] = [];
  sourceRoot.traverse((n) => {
    if ((n as THREE.Bone).isBone) sourceBones.push(n as THREE.Bone);
  });
  if (sourceBones.length === 0) throw new Error("clip source has no skeleton");
  const sourceByPlain = new Map(sourceBones.map((b) => [plainName(b.name), b.name]));
  const sourceHips = sourceBones.find((b) => plainName(b.name) === "Hips");
  if (!sourceHips) throw new Error("clip source has no Hips bone");

  const targetBones = target.skeleton.bones;
  const targetHips = targetBones.find((b) => plainName(b.name) === "Hips");
  if (!targetHips) throw new Error("clip target has no Hips bone");
  const mappedNames = new Set(
    targetBones
      .filter((b) => sourceByPlain.has(plainName(b.name)))
      .map((b) => b.name),
  );

  // Hip scale: both heights measured in each rig's own track units, so the
  // baked hip translation lands in the target's local space.
  target.updateMatrixWorld(true);
  const targetSpace = target.matrixWorld.clone().invert();
  const targetHipY = targetHips
    .getWorldPosition(new THREE.Vector3())
    .applyMatrix4(targetSpace).y;
  const sourceHipY = sourceHips.getWorldPosition(new THREE.Vector3()).y;
  const scale =
    Math.abs(sourceHipY) > 1e-6 && Math.abs(targetHipY) > 1e-6
      ? targetHipY / sourceHipY
      : 1;

  // retargetClip resets the target skeleton to bind pose and leaves it at the
  // clip's last frame: preserve the calibrated rest across the bake.
  const saved = targetBones.map((b) => ({
    bone: b,
    pos: b.position.clone(),
    quat: b.quaternion.clone(),
    scale: b.scale.clone(),
  }));

  let baked: THREE.AnimationClip;
  try {
    const options: RetargetClipOptions = {
      // Unmatched target bones map to "" (matches nothing); their bind-pose
      // filler tracks are dropped below.
      getBoneName: (bone) => sourceByPlain.get(plainName(bone.name)) ?? "",
      hip: sourceHips.name,
      scale,
    };
    baked = retargetClip(target, new THREE.Skeleton(sourceBones), clip, options);
  } finally {
    for (const s of saved) {
      s.bone.position.copy(s.pos);
      s.bone.quaternion.copy(s.quat);
      s.bone.scale.copy(s.scale);
    }
    target.updateMatrixWorld(true);
  }

  const tracks = baked.tracks.filter((t) => {
    const m = /^\.bones\[(.+)\]\./.exec(t.name);
    return m !== null && mappedNames.has(m[1]!);
  });

  // Play in place: pin hip X/Z to the rest stance, re-anchor the bob at the
  // rest height so proportion differences never sink or float the figure.
  const hipTrackName = `.bones[${targetHips.name}].position`;
  const rest = targetHips.position;
  for (const t of tracks) {
    if (t.name !== hipTrackName) continue;
    const v = t.values;
    const y0 = v[1] ?? rest.y;
    for (let i = 0; i < v.length / 3; i++) {
      v[i * 3] = rest.x;
      v[i * 3 + 1] = rest.y + (v[i * 3 + 1]! - y0);
      v[i * 3 + 2] = rest.z;
    }
  }

  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

export interface ClipLayer {
  /**
   * Pose the clip-driven bones at `timeSec` (looped), blended over the pose
   * the procedural path wrote this frame by `weight` (0 = untouched
   * procedural, 1 = pure clip). The caller refreshes world matrices after.
   */
  apply(timeSec: number, weight: number): void;
  /** Release mixer bindings. The layer must not be applied afterwards. */
  dispose(): void;
}

/**
 * Wrap a retargeted clip in a mixer + blend layer.
 *
 * `syncDriven` are the bones the procedural sync writes every frame; their
 * current pose is the blend partner. Clip bones OUTSIDE that set (spine
 * in-betweens, toes…) have no per-frame procedural writer, so their blend
 * partner is the calibrated rest captured here — and they are restored to it
 * whenever the weight hits zero, so a faded-out clip can't leave a stale pose.
 */
export function createClipLayer(
  target: THREE.SkinnedMesh,
  clip: THREE.AnimationClip,
  syncDriven: ReadonlySet<THREE.Object3D>,
): ClipLayer {
  const mixer = new THREE.AnimationMixer(target);
  mixer.clipAction(clip).play();

  const byName = new Map(target.skeleton.bones.map((b) => [b.name, b]));
  const drivenNames = new Set<string>();
  for (const t of clip.tracks) {
    const m = /^\.bones\[(.+)\]\./.exec(t.name);
    if (m && byName.has(m[1]!)) drivenNames.add(m[1]!);
  }
  interface Driven {
    bone: THREE.Object3D;
    synced: boolean;
    rest: { pos: THREE.Vector3; quat: THREE.Quaternion };
    snap: { pos: THREE.Vector3; quat: THREE.Quaternion };
  }
  const driven: Driven[] = [...drivenNames].map((name) => {
    const bone = byName.get(name)!;
    return {
      bone,
      synced: syncDriven.has(bone),
      rest: { pos: bone.position.clone(), quat: bone.quaternion.clone() },
      snap: { pos: new THREE.Vector3(), quat: new THREE.Quaternion() },
    };
  });

  // True while unsynced bones may hold clip pose (needs a restore at w=0).
  let dirty = false;

  return {
    apply(timeSec: number, weight: number): void {
      if (weight <= 0) {
        if (dirty) {
          for (const d of driven) {
            if (d.synced) continue;
            d.bone.position.copy(d.rest.pos);
            d.bone.quaternion.copy(d.rest.quat);
          }
          dirty = false;
        }
        return;
      }
      // Blend partner: this frame's procedural pose for synced bones, the
      // calibrated rest for the others (reset first — the mixer wrote clip
      // pose into them last frame and nothing else ever rewrites them).
      for (const d of driven) {
        if (!d.synced) {
          d.bone.position.copy(d.rest.pos);
          d.bone.quaternion.copy(d.rest.quat);
        }
        d.snap.pos.copy(d.bone.position);
        d.snap.quat.copy(d.bone.quaternion);
      }
      mixer.setTime(timeSec);
      if (weight < 1) {
        for (const d of driven) {
          d.bone.position.lerp(d.snap.pos, 1 - weight);
          d.bone.quaternion.slerp(d.snap.quat, 1 - weight);
        }
      }
      dirty = true;
    },
    dispose(): void {
      mixer.stopAllAction();
      mixer.uncacheRoot(target);
    },
  };
}
