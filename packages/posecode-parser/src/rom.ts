/**
 * Range-of-Motion (ROM) hard limits per joint type and action, in degrees.
 *
 * Values follow the maximum healthy limits in the project research
 * (CDC / clinical normative data), §5.1 Tables 1 & 2. The clamp pass treats
 * `max` as a HARD ceiling: e.g. a requested knee flexion of 200° is clamped to
 * 144°, so the renderer can never produce an anatomically impossible joint.
 *
 * `min` is the floor of the achievable angle for that action direction (0 for
 * most; small positive ceilings on extension capture hyperextension limits).
 */

export interface RomLimit {
  min: number;
  max: number;
}

type ActionLimits = Record<string, RomLimit>;

/** Keyed by joint type (see joints.boneType). */
const ROM: Record<string, ActionLimits> = {
  // --- Upper extremity (research Table 1) ---
  shoulder: {
    flex: { min: 0, max: 180 }, // flexion (lifting up)
    extend: { min: 0, max: 60 }, // extension (pulling back)
    abduct: { min: 0, max: 180 },
    adduct: { min: 0, max: 50 },
    "rotate-in": { min: 0, max: 70 }, // internal rotation
    "rotate-out": { min: 0, max: 90 }, // external rotation
  },
  elbow: {
    flex: { min: 0, max: 154 },
    extend: { min: 0, max: 10 }, // slight hyperextension
    supinate: { min: 0, max: 92 },
    pronate: { min: 0, max: 84 },
  },
  wrist: {
    flex: { min: 0, max: 80 },
    extend: { min: 0, max: 70 },
  },
  // --- Lower extremity (research Table 2) ---
  hip: {
    flex: { min: 0, max: 135 },
    extend: { min: 0, max: 20 },
    abduct: { min: 0, max: 45 },
    adduct: { min: 0, max: 30 },
    "rotate-in": { min: 0, max: 40 },
    "rotate-out": { min: 0, max: 45 },
  },
  knee: {
    flex: { min: 0, max: 144 },
    extend: { min: 0, max: 5 }, // hyperextension risk limit
  },
  ankle: {
    dorsiflex: { min: 0, max: 15 },
    plantarflex: { min: 0, max: 50 },
  },
  // --- Pelvis / hip-hinge (trunk-on-thigh angle) ---
  // The hinge pivots the torso forward over the hip line while the legs stay
  // vertical. ~120° is a deep hip-dominant fold (athletic deadlift / forward
  // fold); beyond that the movement is spinal flexion, not a hinge.
  pelvis: {
    hinge: { min: 0, max: 120 },
  },
  // --- Axial (conservative literature values) ---
  spine: {
    flex: { min: 0, max: 90 },
    extend: { min: 0, max: 30 },
    abduct: { min: 0, max: 35 }, // lateral flexion
    adduct: { min: 0, max: 35 },
    "rotate-in": { min: 0, max: 45 },
    "rotate-out": { min: 0, max: 45 },
  },
  chest: {
    flex: { min: 0, max: 30 },
    extend: { min: 0, max: 20 },
    "rotate-in": { min: 0, max: 35 },
    "rotate-out": { min: 0, max: 35 },
  },
  neck: {
    flex: { min: 0, max: 50 },
    extend: { min: 0, max: 60 },
    abduct: { min: 0, max: 45 },
    adduct: { min: 0, max: 45 },
    "rotate-in": { min: 0, max: 80 },
    "rotate-out": { min: 0, max: 80 },
  },
  // --- Hand / fingers (single-DOF curl per finger) ---
  index: { flex: { min: 0, max: 100 }, extend: { min: 0, max: 20 } },
  middle: { flex: { min: 0, max: 100 }, extend: { min: 0, max: 20 } },
  ring: { flex: { min: 0, max: 100 }, extend: { min: 0, max: 20 } },
  pinky: { flex: { min: 0, max: 100 }, extend: { min: 0, max: 20 } },
  thumb: {
    flex: { min: 0, max: 80 },
    extend: { min: 0, max: 20 },
    abduct: { min: 0, max: 50 },
    adduct: { min: 0, max: 30 },
  },
};

import { actionAxis, boneType, flexionSign, isLeft } from "./joints.js";
import type { Axis } from "./types.js";

/** Look up the ROM limit for a bone + action, or null if undefined. */
export function romFor(boneId: string, action: string): RomLimit | null {
  const limits = ROM[boneType(boneId)];
  if (!limits) return null;
  return limits[action] ?? null;
}

/** Signed per-axis rotation range, degrees, in a bone's LOCAL Euler frame. */
export type EulerRom = Record<Axis, RomLimit>;

/**
 * The full ROM of a bone expressed as a signed Euler box in the renderer's
 * local frame: the same frame `clamp.ts` resolves authored actions into
 * (flexion-sign per joint, Y/Z mirrored on left-side bones). Each axis range is
 * the union of every action that rotates it; axes with no ROM entry stay
 * `{min: 0, max: 0}`, locking them (a knee is a pure hinge). This is what lets
 * the IK solver honour the same hard limits as authored angles: any solved
 * joint rotation clamped into this box is inside the healthy ROM.
 *
 * Returns null for bones without ROM data (e.g. `head`).
 */
export function eulerRomFor(boneId: string): EulerRom | null {
  const limits = ROM[boneType(boneId)];
  if (!limits) return null;

  const box: EulerRom = {
    x: { min: 0, max: 0 },
    y: { min: 0, max: 0 },
    z: { min: 0, max: 0 },
  };
  for (const [action, rom] of Object.entries(limits)) {
    const aa = actionAxis(action);
    if (!aa) continue;
    // Mirrors the sign resolution in clamp.ts exactly.
    const flexFlip =
      action === "flex" || action === "extend" ? flexionSign(boneType(boneId)) : 1;
    const mirror = isLeft(boneId) && aa.axis !== "x" ? -1 : 1;
    const sign = aa.sign * flexFlip * mirror;
    const range = box[aa.axis];
    range.min = Math.min(range.min, sign * rom.min, sign * rom.max);
    range.max = Math.max(range.max, sign * rom.min, sign * rom.max);
  }
  return box;
}

/**
 * Clamp a requested angle (degrees) into its ROM. Returns the clamped value;
 * if there is no ROM entry, returns the request unchanged.
 */
export function clampAngle(boneId: string, action: string, degrees: number): number {
  const rom = romFor(boneId, action);
  if (!rom) return degrees;
  return Math.min(rom.max, Math.max(rom.min, degrees));
}
