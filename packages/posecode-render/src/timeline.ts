/**
 * Turn a PosecodeIR into a looping, eased keyframe timeline.
 *
 * Each phase is a keyframe: we accumulate joint overrides forward (a movement
 * holds prior joint state unless a later phase changes it), then interpolate
 * the DSL's bounded anatomical Euler channels with monotone cubic Hermite
 * curves. A final wrap segment returns to the base pose only when necessary.
 */

import * as THREE from "three";
import type { PosecodeIR, ReachTarget, PinTarget, GripTarget, TimingMode } from "posecode-parser";
import { poseFor, type PoseSpec } from "./poses.js";

const DEG = Math.PI / 180;

type EulerDegTuple = [number, number, number];

interface Keyframe {
  time: number;
  name: string;
  cue?: string;
  easing: TimingMode;
  /**
   * The figure is at rest here (zero boundary velocity), so the spline uses this
   * keyframe receives zero velocity. True for settle/snap phases AND for the
   * structural start/reset anchors, which represent the figure at rest.
   */
  rest: boolean;
  /** Authored semantic Euler channels, retained so interpolation follows the DSL. */
  eulers: Map<string, EulerDegTuple>;
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

/** A reach constraint blended across a phase boundary. */
export interface WeightedReachTarget extends ReachTarget {
  weight: number;
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
    reaches: WeightedReachTarget[];
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

/** Cubic Hermite interpolation with endpoint velocities expressed per second. */
function hermite(a: number, b: number, va: number, vb: number, span: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    (2 * t3 - 3 * t2 + 1) * a +
    (t3 - 2 * t2 + t) * span * va +
    (-2 * t3 + 3 * t2) * b +
    (t3 - t2) * span * vb
  );
}

/**
 * Time-aware centered velocity at an interior root keyframe. Rest keyframes
 * deliberately have zero velocity; flowing keyframes carry momentum through.
 */
function rootVelocity(
  prev: Keyframe,
  current: Keyframe,
  next: Keyframe,
  read: (keyframe: Keyframe) => number,
): number {
  if (current.rest) return 0;
  const span = next.time - prev.time;
  return span > 1e-6 ? (read(next) - read(prev)) / span : 0;
}

/**
 * Shape-preserving velocity for an authored Euler channel at an interior
 * keyframe. Quaternion splines cannot distinguish a deliberate reversal from
 * continuing around the sphere: 0° → 160° → 0° was interpreted as a hidden
 * full rotation, holding near neutral before flipping through 180°. The DSL is
 * expressed as bounded anatomical Euler channels, so interpolate those scalar
 * channels directly and stop at reversals.
 */
function jointVelocity(
  prev: Keyframe,
  current: Keyframe,
  next: Keyframe,
  read: (keyframe: Keyframe) => number,
): number {
  if (current.rest) return 0;
  const beforeSpan = current.time - prev.time;
  const afterSpan = next.time - current.time;
  if (beforeSpan <= 1e-6 || afterSpan <= 1e-6) return 0;
  const before = (read(current) - read(prev)) / beforeSpan;
  const after = (read(next) - read(current)) / afterSpan;
  // A plateau or direction change is a real anatomical turnaround.
  if (before * after <= 0) return 0;
  const centered = (read(next) - read(prev)) / (next.time - prev.time);
  // Monotone Hermite cap: never let a tangent create an inter-keyframe
  // overshoot even when neighboring phase durations differ greatly.
  const limit = 3 * Math.min(Math.abs(before), Math.abs(after));
  return Math.sign(centered) * Math.min(Math.abs(centered), limit);
}

function posesEqual(
  a: Map<string, EulerDegTuple>,
  b: Map<string, EulerDegTuple>,
): boolean {
  const bones = new Set([...a.keys(), ...b.keys()]);
  for (const bone of bones) {
    const av = a.get(bone) ?? [0, 0, 0];
    const bv = b.get(bone) ?? [0, 0, 0];
    if (av.some((value, axis) => Math.abs(value - bv[axis]!) > 1e-6)) return false;
  }
  return true;
}

function blendReaches(
  from: readonly ReachTarget[],
  to: readonly ReachTarget[],
  t: number,
): WeightedReachTarget[] {
  const key = (reach: ReachTarget): string => `${reach.effector}\u0000${reach.target}`;
  const previous = new Map(from.map((reach) => [key(reach), reach]));
  const next = new Map(to.map((reach) => [key(reach), reach]));
  const blended: WeightedReachTarget[] = [];
  for (const [id, reach] of previous) {
    const weight = next.has(id) ? 1 : 1 - t;
    if (weight > 1e-6) blended.push({ ...reach, weight });
  }
  for (const [id, reach] of next) {
    if (previous.has(id)) continue;
    if (t > 1e-6) blended.push({ ...reach, weight: t });
  }
  return blended;
}

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
    rest: true,
    eulers: snapshot(curr),
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
      rest: REST_MODE[phase.easing],
      eulers: snapshot(curr),
      groundLock: phase.groundLock,
      reaches: phase.reaches,
      pins: phase.pins,
      grips: phase.grips,
      yaw: currYaw * DEG,
      pos: { ...currPos },
    });
  }

  // Wrap back to the base pose (and home position) for a seamless loop only
  // when the author did not already return there. Always adding a first-phase-
  // length reset made common out-and-back movements sit idle for roughly a
  // third of every repetition. A zero-duration structural reset still gives
  // the final real keyframe a rest neighbor without extending the loop.
  // Facing
  // wraps to the NEAREST FULL TURN to the final yaw, not to 0: a completed 360°
  // pirouette then holds its facing through the reset and the loop boundary
  // (360°≡0°) is seamless, instead of visibly un-spinning backward. A partial
  // turn (e.g. 90°) rounds to 0 and rotates back to front during the reset.
  const finalPose = snapshot(curr);
  const baseSnapshot = snapshot(new Map(baseJoints));
  const yawAtHome = Math.abs(currYaw - Math.round(currYaw / 360) * 360) < 1e-6;
  const positionAtHome = Math.abs(currPos.x) < 1e-6 && Math.abs(currPos.z) < 1e-6;
  const needsWrap = !posesEqual(finalPose, baseSnapshot) || !yawAtHome || !positionAtHome;
  const wrap = needsWrap ? (ir.phases[0]?.durationSec ?? 1) : 0;
  // With no pose wrap, the structural start is also the cyclic successor of
  // the final phase. Seed its reach state from that final phase so a constraint
  // shared across the boundary (e.g. cobra palms on the floor) stays planted.
  if (!needsWrap) keyframes[0]!.reaches = [...(ir.phases.at(-1)?.reaches ?? [])];
  const wrapYaw = Math.round(currYaw / 360) * 360 * DEG;
  t += wrap;
  keyframes.push({
    time: t,
    name: "reset",
    easing: "flow",
    rest: true,
    eulers: baseSnapshot,
    groundLock: [],
    reaches: [],
    pins: [],
    grips: [],
    yaw: wrapYaw,
    pos: { x: 0, z: 0 },
  });

  // Fill every keyframe with the full bone set (missing → neutral Euler).
  const bonesUsed = [...new Set(keyframes.flatMap((k) => [...k.eulers.keys()]))];
  for (const kf of keyframes) {
    for (const bone of bonesUsed) {
      if (!kf.eulers.has(bone)) kf.eulers.set(bone, [0, 0, 0]);
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

      // Neighbors for the time-aware semantic-channel tangents.
      const kPrev = keyframes[Math.max(0, i - 1)]!;
      const kNext = keyframes[Math.min(keyframes.length - 1, i + 2)]!;
      for (const bone of bonesUsed) {
        const node = bones.get(bone);
        if (!node) continue;
        const from = a.eulers.get(bone)!;
        const to = b.eulers.get(bone)!;
        const value = ([0, 1, 2] as const).map((axis) => {
          if (b.easing === "linear") return from[axis] + (to[axis] - from[axis]) * eased;
          const read = (kf: Keyframe): number => kf.eulers.get(bone)![axis];
          const va = jointVelocity(kPrev, a, b, read);
          const vb = jointVelocity(a, b, kNext, read);
          return hermite(from[axis], to[axis], va, vb, span, eased);
        }) as EulerDegTuple;
        node.quaternion.copy(eulerToQuat(value));
      }
      // Root facing/position use the scalar analogue of the joint squad spline:
      // cubic Hermite with time-aware centered tangents. This carries velocity
      // through `flow` waypoints instead of hitting every travel point with a
      // visible direction/speed kink (box steps, grapevines, waltz, chassé).
      // Yaw remains a raw scalar rather than a quaternion so a 360° turn still
      // sweeps the full revolution. Rest points receive zero tangent.
      const yawA = rootVelocity(kPrev, a, b, (kf) => kf.yaw);
      const yawB = rootVelocity(a, b, kNext, (kf) => kf.yaw);
      const xA = rootVelocity(kPrev, a, b, (kf) => kf.pos.x);
      const xB = rootVelocity(a, b, kNext, (kf) => kf.pos.x);
      const zA = rootVelocity(kPrev, a, b, (kf) => kf.pos.z);
      const zB = rootVelocity(a, b, kNext, (kf) => kf.pos.z);
      // `linear` is an explicit authoring promise, so preserve a literal
      // straight interpolation for that mode. The spline applies to the
      // expressive timing modes, especially continuous `flow` choreography.
      const rootYaw = b.easing === "linear"
        ? a.yaw + (b.yaw - a.yaw) * eased
        : hermite(a.yaw, b.yaw, yawA, yawB, span, eased);
      const rootOffset = b.easing === "linear"
        ? {
            x: a.pos.x + (b.pos.x - a.pos.x) * eased,
            z: a.pos.z + (b.pos.z - a.pos.z) * eased,
          }
        : {
            x: hermite(a.pos.x, b.pos.x, xA, xB, span, eased),
            z: hermite(a.pos.z, b.pos.z, zA, zB, span, eased),
          };
      return {
        phaseName: b.name,
        ...(b.cue ? { cue: b.cue } : {}),
        groundLock: b.groundLock,
        reaches: blendReaches(a.reaches, b.reaches, eased),
        pins: b.pins,
        grips: b.grips,
        rootYaw,
        rootOffset,
      };
    },
  };
}

function snapshot(curr: Map<string, EulerDegTuple>): Map<string, EulerDegTuple> {
  const out = new Map<string, EulerDegTuple>();
  for (const [bone, euler] of curr) out.set(bone, [...euler]);

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
      out.set(hip, [hx - pelvisX, hy, hz]);
    }
  }
  return out;
}
