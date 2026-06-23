/**
 * Shared types for the Movit protocol.
 *
 * The parser turns `.movit` source into a `MovitIR` — a renderer-agnostic
 * intermediate representation. Angles in the IR are in DEGREES (human-readable);
 * the renderer converts to radians. Joint rotations follow the coordinate
 * convention documented in `joints.ts` and `spec/SPEC.md`.
 */

export const MOVIT_VERSION = "0.1";

export type Axis = "x" | "y" | "z";

export type Easing = "linear" | "ease-in" | "ease-out" | "ease-in-out";

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
}

/** One concurrent phase of a movement (e.g. "Lower" in a push-up). */
export interface Phase {
  name: string;
  durationSec: number;
  easing: Easing;
  targets: JointTarget[];
  /** Effector groups pinned to the floor for this phase, e.g. ["hands", "feet"]. */
  groundLock: string[];
  cue?: string;
}

/** The full validated, ROM-clamped movement. */
export interface MovitIR {
  version: string;
  /** Movement kind keyword: exercise | stretch | posture. */
  kind: string;
  name: string;
  rig: string;
  startPose?: string;
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
  ir: MovitIR | null;
  warnings: Warning[];
  errors: ParseError[];
}
