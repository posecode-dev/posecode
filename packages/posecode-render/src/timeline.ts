/**
 * Turn a PosecodeIR into a looping, eased keyframe timeline.
 *
 * Each phase is a keyframe: we accumulate joint overrides forward (a movement
 * holds prior joint state unless a later phase changes it), then slerp bone
 * quaternions between consecutive keyframes with the destination phase's easing.
 * A final wrap segment returns to the base pose so the loop is seamless.
 */

import * as THREE from "three";
import type { PosecodeIR, ReachTarget, PinTarget, GripTarget, TimingMode } from "posecode-parser";
import { poseFor, type PoseSpec } from "./poses.js";
import { squad, squadControl } from "./squad.js";

const DEG = Math.PI / 180;

type EulerDegTuple = [number, number, number];

interface Keyframe {
  time: number;
  name: string;
  cue?: string;
  easing: TimingMode;
  quats: Map<string, THREE.Quaternion>;
  groundLock: string[];
  reaches: ReachTarget[];
  pins: PinTarget[];
  grips: GripTarget[];
  /** Root facing (yaw about world Y, radians) at this keyframe. */
  yaw: number;
  /** Root ground offset (world X/Z metres) from the load spot at this keyframe. */
  pos: { x: number; z: number };
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
  ): {
    phaseName: string;
    cue?: string;
    groundLock: string[];
    reaches: ReachTarget[];
    pins: PinTarget[];
    grips: GripTarget[];
    /** Interpolated root facing (yaw about world Y, radians). */
    rootYaw: number;
    /** Interpolated root ground offset (world X/Z metres) from the load spot. */
    rootOffset: { x: number; z: number };
  };
  /** Largest travel offset magnitude reached (metres), for camera framing. */
  travelExtent: number;
}

function eulerToQuat([x, y, z]: EulerDegTuple): THREE.Quaternion {
  return new THREE.Quaternion().setFromEuler(
    new THREE.Euler(x * DEG, y * DEG, z * DEG, "XYZ"),
  );
}

/**
 * Per-mode remap of the normalized segment parameter (arrival shaping). `flow`
 * and `linear` are even; `settle`/`snap` decelerate into rest; `drive`
 * accelerates from rest. The spline (squad) carries velocity across keyframes;
 * this only shapes the timing within a segment.
 */
const MODE_EASE: Record<TimingMode, (t: number) => number> = {
  flow: (t) => t,
  settle: (t) => 1 - (1 - t) * (1 - t),
  drive: (t) => t * t,
  snap: (t) => 1 - (1 - t) * (1 - t) * (1 - t),
  linear: (t) => t,
};

/** A keyframe is a rest-point (zero boundary velocity) for these modes. */
const REST_MODE: Record<TimingMode, boolean> = {
  flow: false,
  settle: true,
  drive: false,
  snap: true,
  linear: false,
};

export function buildTimeline(ir: PosecodeIR): BuiltTimeline {
  const basePose = poseFor(ir.startPose);
  const baseJoints = new Map<string, EulerDegTuple>(
    Object.entries(basePose.joints ?? {}),
  );

  // Accumulating current joint angles (degrees).
  const curr = new Map<string, EulerDegTuple>(baseJoints);
  // Accumulating root facing (yaw, degrees) and ground offset (metres), both
  // carried forward across phases like joints and seeded at home (0).
  let currYaw = 0;
  let currPos = { x: 0, z: 0 };
  let travelExtent = 0;

  const keyframes: Keyframe[] = [];
  keyframes.push({
    time: 0,
    name: ir.startPose ?? "start",
    easing: "flow",
    quats: snapshot(curr),
    groundLock: [],
    reaches: [],
    pins: [],
    grips: [],
    yaw: 0,
    pos: { x: 0, z: 0 },
  });

  let t = 0;
  for (const phase of ir.phases) {
    for (const target of phase.targets) {
      curr.set(target.boneId, [target.euler.x, target.euler.y, target.euler.z]);
    }
    if (phase.turnDeg !== undefined) currYaw = phase.turnDeg;
    if (phase.travel) currPos = { x: phase.travel.x, z: phase.travel.z };
    travelExtent = Math.max(travelExtent, Math.hypot(currPos.x, currPos.z));
    t += phase.durationSec;
    keyframes.push({
      time: t,
      name: phase.name,
      ...(phase.cue ? { cue: phase.cue } : {}),
      easing: phase.easing,
      quats: snapshot(curr),
      groundLock: phase.groundLock,
      reaches: phase.reaches,
      pins: phase.pins,
      grips: phase.grips,
      yaw: currYaw * DEG,
      pos: { ...currPos },
    });
  }

  // Wrap back to the base pose (and home position) for a seamless loop. Facing
  // wraps to the NEAREST FULL TURN to the final yaw, not to 0: a completed 360°
  // pirouette then holds its facing through the reset and the loop boundary
  // (360°≡0°) is seamless, instead of visibly un-spinning backward. A partial
  // turn (e.g. 90°) rounds to 0 and rotates back to front during the reset.
  const wrap = ir.phases[0]?.durationSec ?? 1;
  const wrapYaw = Math.round(currYaw / 360) * 360 * DEG;
  t += wrap;
  keyframes.push({
    time: t,
    name: "reset",
    easing: "flow",
    quats: snapshot(new Map(baseJoints)),
    groundLock: [],
    reaches: [],
    pins: [],
    grips: [],
    yaw: wrapYaw,
    pos: { x: 0, z: 0 },
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
    travelExtent,
    sample(time, bones) {
      const tt = duration > 0 ? ((time % duration) + duration) % duration : 0;
      let i = 0;
      let a = keyframes[0]!;
      let b = keyframes[keyframes.length - 1]!;
      for (let k = 0; k < keyframes.length - 1; k++) {
        if (tt >= keyframes[k]!.time && tt < keyframes[k + 1]!.time) {
          i = k;
          a = keyframes[k]!;
          b = keyframes[k + 1]!;
          break;
        }
      }
      const span = Math.max(1e-6, b.time - a.time);
      const local = THREE.MathUtils.clamp((tt - a.time) / span, 0, 1);
      const eased = MODE_EASE[b.easing](local);

      // Neighbors for the squad control quaternions (clamp at the ends → the
      // segment endpoint itself, giving a one-sided tangent).
      const kPrev = keyframes[Math.max(0, i - 1)]!;
      const kNext = keyframes[Math.min(keyframes.length - 1, i + 2)]!;
      for (const bone of bonesUsed) {
        const node = bones.get(bone);
        if (!node) continue;
        const q0 = a.quats.get(bone)!;
        const q1 = b.quats.get(bone)!;
        // A rest-point keyframe uses its own value as the control (zero tangent
        // → the spline comes to / leaves from rest there); otherwise the
        // Shoemake control from the neighboring keyframe carries velocity.
        const s0 = REST_MODE[a.easing]
          ? q0.clone()
          : squadControl(kPrev.quats.get(bone)!, q0, q1);
        const s1 = REST_MODE[b.easing]
          ? q1.clone()
          : squadControl(q0, q1, kNext.quats.get(bone)!);
        squad(q0, s0, s1, q1, eased, node.quaternion);
      }
      // Root facing/position: linear interpolation of the raw values so a large
      // turn (e.g. 360°) sweeps the whole way round rather than taking a short
      // arc. Uses the same eased param as the joints so everything moves as one.
      const rootYaw = a.yaw + (b.yaw - a.yaw) * eased;
      const rootOffset = {
        x: a.pos.x + (b.pos.x - a.pos.x) * eased,
        z: a.pos.z + (b.pos.z - a.pos.z) * eased,
      };
      return {
        phaseName: b.name,
        ...(b.cue ? { cue: b.cue } : {}),
        groundLock: b.groundLock,
        reaches: b.reaches,
        pins: b.pins,
        grips: b.grips,
        rootYaw,
        rootOffset,
      };
    },
  };
}

function snapshot(curr: Map<string, EulerDegTuple>): Map<string, THREE.Quaternion> {
  const out = new Map<string, THREE.Quaternion>();
  for (const [bone, euler] of curr) out.set(bone, eulerToQuat(euler));

  // Hip-hinge coupling. The `pelvis` is the shared parent of both the torso and
  // the legs, so a pelvis X-rotation tips the WHOLE figure forward: torso and
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
