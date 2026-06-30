/**
 * movit-parser — public API.
 *
 * `parse()` turns `.movit` source into a validated, ROM-clamped `MovitIR`.
 * Pipeline: tokenize → parse to AST → zod boundary validation → resolve+clamp.
 * Errors are always returned structurally, never thrown.
 */

import { parseToAst } from "./parser.js";
import { validateAst } from "./schema.js";
import { resolve } from "./clamp.js";
import type { ParseResult } from "./types.js";

export function parse(source: string): ParseResult {
  const { ast, errors: parseErrors } = parseToAst(source);
  if (!ast) {
    return { ir: null, warnings: [], errors: parseErrors };
  }

  const schemaErrors = validateAst(ast);
  const errors = [...parseErrors, ...schemaErrors];
  if (errors.length > 0) {
    return { ir: null, warnings: [], errors };
  }

  const { ir, warnings, errors: resolveErrors } = resolve(ast);
  if (resolveErrors.length > 0) {
    return { ir: null, warnings, errors: resolveErrors };
  }

  return { ir, warnings, errors: [] };
}

export type {
  Axis,
  Easing,
  EulerDeg,
  JointTarget,
  ReachTarget,
  PinTarget,
  Phase,
  MovitIR,
  Warning,
  ParseError,
  ParseResult,
} from "./types.js";
export { MOVIT_VERSION } from "./types.js";
export {
  BONES,
  JOINT_GROUP_NAMES,
  JOINT_NAMES,
  ACTION_NAMES,
  expandJoint,
  actionAxis,
  boneType,
} from "./joints.js";
export { romFor, clampAngle, type RomLimit } from "./rom.js";
export { EASINGS } from "./schema.js";
