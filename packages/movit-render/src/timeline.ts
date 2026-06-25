/**
 * Turn a MovitIR into a looping, eased keyframe timeline.
 *
 * Each phase is a keyframe: we accumulate joint overrides forward (a movement
 * holds prior joint state unless a later phase changes it), then slerp bone
 * quaternions between consecutive keyframes with the destination phase's easing.
 * A final wrap segment returns to the base pose so the loop is seamless.
 */

import * as THREE from "three";
import type { MovitIR, ReachTarget } from "movit-parser";
import { poseFor, type PoseSpec } from "./poses.js";

const DEG = Math.PI / 180;

type EulerDegTuple = [number, number, number];
type Easing = "linear" | "ease-in" | "ease-out" | "ease-in-out";

interface Keyframe {
  time: number;
  name: string;
  cue?: string;
  easing: Easing;
  quats: Map<string, THREE.Quaternion>;
  groundLock: string[];
  reaches: ReachTarget[];
}

/** A phase as a time span on the timeline, for scrubber markers / ribbon. */
export interface PhaseSegment {
  name: string;
  start: number;
  end: number;
  cue?: string;
}

export interface BuiltTimeline {
  duration: number;
  repeat: number;
  basePose: PoseSpec;
  bonesUsed: string[];
  /** Real movement phases (excludes the loop-reset segment). */
  segments: PhaseSegment[];
  /** Pose the bones at time t (seconds, looped). Returns the active phase info. */
  sample(
    t: number,
    bones: Map<string, THREE.Object3D>,
  ): { phaseName: string; cue?: string; groundLock: string[]; reaches: ReachTarget[] };
}

function eulerToQuat([x, y, z]: EulerDegTuple): THREE.Quaternion {
  return new THREE.Quaternion().setFromEuler(
    new THREE.Euler(x * DEG, y * DEG, z * DEG, "XYZ"),
  );
}

const EASE: Record<Easing, (t: number) => number> = {
  linear: (t) => t,
  "ease-in": (t) => t * t,
  "ease-out": (t) => 1 - (1 - t) * (1 - t),
  "ease-in-out": (t) => t * t * (3 - 2 * t),
};

export function buildTimeline(ir: MovitIR): BuiltTimeline {
  const basePose = poseFor(ir.startPose);
  const baseJoints = new Map<string, EulerDegTuple>(
    Object.entries(basePose.joints ?? {}),
  );

  // Accumulating current joint angles (degrees).
  const curr = new Map<string, EulerDegTuple>(baseJoints);

  const keyframes: Keyframe[] = [];
  keyframes.push({
    time: 0,
    name: ir.startPose ?? "start",
    easing: "linear",
    quats: snapshot(curr),
    groundLock: [],
    reaches: [],
  });

  let t = 0;
  for (const phase of ir.phases) {
    for (const target of phase.targets) {
      curr.set(target.boneId, [target.euler.x, target.euler.y, target.euler.z]);
    }
    t += phase.durationSec;
    keyframes.push({
      time: t,
      name: phase.name,
      ...(phase.cue ? { cue: phase.cue } : {}),
      easing: phase.easing,
      quats: snapshot(curr),
      groundLock: phase.groundLock,
      reaches: phase.reaches,
    });
  }

  // Wrap back to the base pose for a seamless loop.
  const wrap = ir.phases[0]?.durationSec ?? 1;
  t += wrap;
  keyframes.push({
    time: t,
    name: "reset",
    easing: "ease-in-out",
    quats: snapshot(new Map(baseJoints)),
    groundLock: [],
    reaches: [],
  });

  // Fill every keyframe with the full bone set (missing → identity).
  const bonesUsed = [...new Set(keyframes.flatMap((k) => [...k.quats.keys()]))];
  for (const kf of keyframes) {
    for (const bone of bonesUsed) {
      if (!kf.quats.has(bone)) kf.quats.set(bone, new THREE.Quaternion());
    }
  }

  const duration = t;

  // Phase segments (skip K0 start anchor and the trailing reset wrap).
  const segments: PhaseSegment[] = [];
  for (let i = 1; i < keyframes.length - 1; i++) {
    const kf = keyframes[i]!;
    segments.push({
      name: kf.name,
      start: keyframes[i - 1]!.time,
      end: kf.time,
      ...(kf.cue ? { cue: kf.cue } : {}),
    });
  }

  return {
    duration,
    repeat: ir.repeat,
    basePose,
    bonesUsed,
    segments,
    sample(time, bones) {
      const tt = duration > 0 ? ((time % duration) + duration) % duration : 0;
      let a = keyframes[0]!;
      let b = keyframes[keyframes.length - 1]!;
      for (let i = 0; i < keyframes.length - 1; i++) {
        if (tt >= keyframes[i]!.time && tt < keyframes[i + 1]!.time) {
          a = keyframes[i]!;
          b = keyframes[i + 1]!;
          break;
        }
      }
      const span = Math.max(1e-6, b.time - a.time);
      const local = THREE.MathUtils.clamp((tt - a.time) / span, 0, 1);
      const eased = EASE[b.easing](local);

      for (const bone of bonesUsed) {
        const node = bones.get(bone);
        if (!node) continue;
        node.quaternion.slerpQuaternions(a.quats.get(bone)!, b.quats.get(bone)!, eased);
      }
      return {
        phaseName: b.name,
        ...(b.cue ? { cue: b.cue } : {}),
        groundLock: b.groundLock,
        reaches: b.reaches,
      };
    },
  };
}

function snapshot(curr: Map<string, EulerDegTuple>): Map<string, THREE.Quaternion> {
  const out = new Map<string, THREE.Quaternion>();
  for (const [bone, euler] of curr) out.set(bone, eulerToQuat(euler));

  // Hip-hinge coupling. The `pelvis` is the shared parent of both the torso and
  // the legs, so a pelvis X-rotation tips the WHOLE figure forward — torso and
  // legs alike. A real hip hinge keeps the legs planted and pivots only the
  // torso over the hip line, so counter-rotate the hips by the same X angle:
  // the thighs (hence shins and feet) stay world-vertical while the torso tips.
  // The feet ground-lock (index.ts) then drops the figure so the feet rest flat.
  const pelvisX = curr.get("pelvis")?.[0] ?? 0;
  if (pelvisX !== 0) {
    for (const hip of ["hip_left", "hip_right"]) {
      const [hx, hy, hz] = curr.get(hip) ?? [0, 0, 0];
      out.set(hip, eulerToQuat([hx - pelvisX, hy, hz]));
    }
  }
  return out;
}
