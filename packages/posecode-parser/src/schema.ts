/**
 * Zod schema for the AST: a defensive boundary check before resolution.
 *
 * The parser already produces a typed AST, but validating it here catches
 * malformed easings and structural surprises in one place (coding-style:
 * validate at system boundaries). Easing validation lives here because it is a
 * closed enum independent of biomechanics.
 */

import { z } from "zod";
import type { ParseError, TimingMode } from "./types.js";
import type { AstDoc } from "./parser.js";
import {
  MOVEMENT_KINDS,
  PROP_TYPES,
  RIG_NAMES,
  START_POSE_NAMES,
} from "./protocol.js";

export const MODES = ["flow", "settle", "drive", "snap", "linear"] as const;

/** Deprecated easing names → canonical mode. Kept so existing docs never break. */
export const LEGACY_MODE_ALIASES: Record<string, TimingMode> = {
  "ease-in": "drive",
  "ease-out": "settle",
  "ease-in-out": "settle",
  linear: "linear",
};

/** Back-compat: the old exported name, now the union of accepted written tokens. */
export const EASINGS = [...MODES, "ease-in", "ease-out", "ease-in-out"] as const;

/** Map a written token to a canonical mode + whether it was a legacy alias. */
export function normalizeMode(raw: string): { mode: TimingMode | null; legacy: boolean } {
  if ((MODES as readonly string[]).includes(raw)) {
    return { mode: raw as TimingMode, legacy: false };
  }
  const alias = LEGACY_MODE_ALIASES[raw];
  // "linear" is canonical, not a deprecation — only non-canonical aliases are legacy.
  if (alias) return { mode: alias, legacy: raw !== "linear" };
  return { mode: null, legacy: false };
}

const jointTargetSchema = z.object({
  joint: z.string().min(1),
  action: z.string().min(1),
  degrees: z.number().nullable(),
  line: z.number(),
});

const reachSchema = z.object({
  effector: z.string().min(1),
  target: z.string().min(1),
  line: z.number(),
});

const pinSchema = z.object({
  effector: z.string().min(1),
  anchor: z.string().min(1),
  line: z.number(),
});

const stepSchema = z.object({
  name: z.string(),
  durationSec: z.number().positive(),
  easing: z.enum(MODES),
  targets: z.array(jointTargetSchema),
  groundLock: z.array(z.string()),
  groundLockLine: z.number().optional(),
  reaches: z.array(reachSchema),
  pins: z.array(pinSchema),
  grips: z.array(pinSchema),
  turn: z.number().optional(),
  travel: z.object({ x: z.number(), z: z.number() }).optional(),
  cue: z.string().optional(),
  line: z.number(),
});

const docSchema = z.object({
  kind: z.enum(MOVEMENT_KINDS),
  name: z.string().min(1),
  rig: z.enum(RIG_NAMES),
  startPose: z.enum(START_POSE_NAMES).optional(),
  startPoseOverrides: z.array(jointTargetSchema),
  props: z.array(z.enum(PROP_TYPES)),
  repeat: z.number().int().positive(),
  steps: z.array(stepSchema).min(1, "a Posecode document requires at least one step"),
});

/**
 * Validate the AST. Returns structured errors mapped to source lines where
 * possible (easing/duration issues carry the offending step's line).
 */
export function validateAst(ast: AstDoc): ParseError[] {
  const result = docSchema.safeParse(ast);
  if (result.success) return [];

  return result.error.issues.map((issue) => {
    const line = lineForIssue(ast, issue.path);
    return { line, message: `${issue.path.join(".")}: ${issue.message}` };
  });
}

function lineForIssue(ast: AstDoc, path: PropertyKey[]): number {
  if (path[0] === "startPoseOverrides" && typeof path[1] === "number") {
    return ast.startPoseOverrides[path[1]]?.line ?? 1;
  }
  // path like ["steps", 0, "easing"] → that step's source line.
  if (path[0] === "steps" && typeof path[1] === "number") {
    return ast.steps[path[1]]?.line ?? 1;
  }
  return 1;
}
