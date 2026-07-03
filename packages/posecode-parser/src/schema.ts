/**
 * Zod schema for the AST — a defensive boundary check before resolution.
 *
 * The parser already produces a typed AST, but validating it here catches
 * malformed easings and structural surprises in one place (coding-style:
 * validate at system boundaries). Easing validation lives here because it is a
 * closed enum independent of biomechanics.
 */

import { z } from "zod";
import type { ParseError } from "./types.js";
import type { AstDoc } from "./parser.js";

export const EASINGS = ["linear", "ease-in", "ease-out", "ease-in-out"] as const;

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
  easing: z.enum(EASINGS),
  targets: z.array(jointTargetSchema),
  groundLock: z.array(z.string()),
  reaches: z.array(reachSchema),
  pins: z.array(pinSchema),
  turn: z.number().optional(),
  travel: z.object({ x: z.number(), z: z.number() }).optional(),
  cue: z.string().optional(),
  line: z.number(),
});

const docSchema = z.object({
  kind: z.string().min(1),
  name: z.string().min(1),
  rig: z.string().min(1),
  startPose: z.string().optional(),
  props: z.array(z.string()),
  repeat: z.number().int().positive(),
  steps: z.array(stepSchema),
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
  // path like ["steps", 0, "easing"] → that step's source line.
  if (path[0] === "steps" && typeof path[1] === "number") {
    return ast.steps[path[1]]?.line ?? 1;
  }
  return 1;
}
