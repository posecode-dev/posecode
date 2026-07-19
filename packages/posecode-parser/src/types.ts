/**
 * Shared types for the Posecode protocol.
 *
 * The parser turns `.posecode` source into a `PosecodeIR`: a renderer-agnostic
 * intermediate representation. Angles in the IR are in DEGREES (human-readable);
 * the renderer converts to radians. Joint rotations follow the coordinate
 * convention documented in `joints.ts` and `spec/SPEC.md`.
 */

/** Version of the parsed Posecode language/IR contract. */
export const POSECODE_VERSION = "0.3";

export type Axis = "x" | "y" | "z";

export type TimingMode = "flow" | "settle" | "drive" | "snap" | "linear";
/** @deprecated use TimingMode. Kept as an alias for one release. */
export type Easing = TimingMode;

/** Euler rotation in degrees, local to a bone's rest orientation. */
export interface EulerDeg {
  x: number;
  y: number;
  z: number;
}

/** A resolved target rotation for a single bone within a phase. */
export interface JointTarget {
  boneId: string;
  euler: EulerDeg;
  /**
   * Euler channels explicitly authored by this target. Renderers merge only
   * these channels into the carried pose; omitted channels retain their prior
   * value. Absent on legacy/manually-built IR, where all channels are applied.
   */
  axes?: Axis[];
}

/**
 * A reach-to-target goal for a phase: drive an effector to a world point solved
 * by inverse kinematics. `target` is a body landmark bone id (e.g. `ankle_left`),
 * the keyword `floor`, or a prop anchor name (e.g. `bar`).
 */
export interface ReachTarget {
  effector: string;
  target: string;
}

/**
 * A contact pin: translate the whole figure so `effector` sits on a fixed
 * world `anchor` (a declared prop anchor or `floor`). Unlike a reach (which
 * moves the limb to a target) a pin moves the BODY, so a body landmark cannot
 * serve as its anchor: that landmark would move with the same root. Pins let the
 * figure hang from a bar, rise onto a box, or keep one floor support fixed.
 */
export interface PinTarget {
  effector: string;
  anchor: string;
}

/**
 * A grip contact: a hand holds a bar/rail. Unlike a pin (which only translates
 * the body to an anchor), a grip also bends the arm via IK so each hand lands on
 * its own two-point anchor (`bar_left`/`bar_right`) and wraps the fingers around
 * the bar. Powers pull-up, dead-hang, hanging knee raise.
 */
export interface GripTarget {
  effector: string;
  anchor: string;
}

/** One concurrent phase of a movement (e.g. "Lower" in a push-up). */
export interface Phase {
  name: string;
  durationSec: number;
  easing: Easing;
  targets: JointTarget[];
  /** Grouped, per-side, or axial floor contacts held this phase, e.g. ["foot_right"] or ["back"]. */
  groundLock: string[];
  /** Reach-IK goals active during this phase. */
  reaches: ReachTarget[];
  /** Contact pins active during this phase (translate the body to the anchor). */
  pins: PinTarget[];
  /** Grip contacts active this phase (arm IK to a two-point bar anchor + finger wrap). */
  grips: GripTarget[];
  /**
   * Root facing (yaw about world Y, degrees) at the end of this phase, an
   * absolute target carried forward across phases. Powers turns / pirouettes.
   */
  turnDeg?: number;
  /**
   * Root ground position (world X/Z metres, offset from the load spot) at the
   * end of this phase, absolute, carried forward. Powers travel / locomotion.
   */
  travel?: { x: number; z: number };
  /** Display-only coaching text; never changes validation or motion solving. */
  cue?: string;
}

/** The full validated, ROM-clamped movement. */
export interface PosecodeIR {
  version: string;
  /** Movement kind keyword: exercise | stretch | posture. */
  kind: string;
  name: string;
  rig: string;
  startPose?: string;
  /** Sparse, ROM-clamped joint channels layered over the built-in start pose. */
  startPoseOverrides?: JointTarget[];
  /** Scene props declared with `prop <type>`, e.g. ["chair", "bar"]. */
  props: string[];
  /**
   * Optional mocap clip name declared with `clip "<name>"`. A renderer MAY
   * play a retargeted animation clip of this name (resolved by the host to an
   * asset URL) instead of, or blended with, the procedural phase keyframes.
   * Renderers without a matching clip ignore it: phases always fully describe
   * the movement, so the procedural path remains the source of truth.
   */
  clip?: string;
  repeat: number;
  phases: Phase[];
}

/** Emitted when a requested angle was outside the safe Range of Motion. */
export interface Warning {
  /** Source line of the offending joint target (1-based), for editor diagnostics. */
  line: number;
  phase: string;
  joint: string;
  action: string;
  requested: number;
  clamped: number;
  limit: { min: number; max: number };
}

/** A structured parse/validation error. Never thrown silently. */
export interface ParseError {
  line: number;
  message: string;
}

/** Result of `parse()`. `ir` is null only when there are fatal errors. */
export interface ParseResult {
  ir: PosecodeIR | null;
  warnings: Warning[];
  errors: ParseError[];
}
