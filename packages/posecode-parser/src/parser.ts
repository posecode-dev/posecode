/**
 * Recursive-descent parser: tokenized lines → an Abstract Syntax Tree.
 *
 * The AST is intentionally "shallow": it captures what was written without
 * resolving joints, axes, or ROM. That resolution happens in `clamp.ts`,
 * keeping parsing and biomechanics cleanly separated.
 */

import { tokenize, TokenizeError, type Line, type Token } from "./tokenizer.js";
import type { ParseError } from "./types.js";
import { normalizeMode, MODES } from "./schema.js";
import { GROUND_LOCK_EFFECTOR_NAMES } from "./joints.js";
import {
  MOVEMENT_KINDS,
  PROP_TYPES,
  RIG_NAMES,
  START_POSE_NAMES,
  isMovementKind,
  isPropType,
  isRigName,
  isStartPoseName,
} from "./protocol.js";

const GROUND_LOCK_EFFECTORS = new Set<string>(GROUND_LOCK_EFFECTOR_NAMES);
const TOP_LEVEL_HEADS = new Set(["rig", "prop", "clip", "pose", "repeat", "step"]);

export interface AstJointTarget {
  joint: string;
  action: string;
  degrees: number | null;
  line: number;
}

export interface AstReach {
  effector: string;
  target: string;
  line: number;
}

export interface AstPin {
  effector: string;
  anchor: string;
  line: number;
}

export interface AstStep {
  name: string;
  durationSec: number;
  easing: string;
  targets: AstJointTarget[];
  groundLock: string[];
  /** Source line of the active `ground-lock:` declaration. */
  groundLockLine?: number;
  reaches: AstReach[];
  pins: AstPin[];
  grips: AstPin[];
  /** Root facing (yaw about world Y, degrees) at the end of this phase. */
  turn?: number;
  /** Root ground position (world X/Z metres) at the end of this phase. */
  travel?: { x: number; z: number };
  cue?: string;
  line: number;
}

export interface AstDoc {
  kind: string;
  name: string;
  rig: string;
  startPose?: string;
  props: string[];
  /** Optional mocap clip name (`clip "<name>"`), resolved to an asset by hosts. */
  clip?: string;
  repeat: number;
  steps: AstStep[];
}

export interface ParseAstResult {
  ast: AstDoc | null;
  errors: ParseError[];
}

function word(tok: Token | undefined): string | null {
  return tok && tok.type === "word" ? tok.value : null;
}

export function parseToAst(source: string): ParseAstResult {
  const errors: ParseError[] = [];
  let lines: Line[];
  try {
    lines = tokenize(source);
  } catch (e) {
    if (e instanceof TokenizeError) {
      return { ast: null, errors: [{ line: e.line, message: e.message }] };
    }
    throw e;
  }

  if (lines.length === 0) {
    return { ast: null, errors: [{ line: 1, message: "empty document" }] };
  }

  // Header: `posecode <kind> "<name>"`
  const header = lines[0]!;
  const ht = header.tokens;
  if (
    header.indent !== 0 ||
    ht.length !== 3 ||
    word(ht[0]) !== "posecode" ||
    ht[1]?.type !== "word" ||
    ht[2]?.type !== "str"
  ) {
    return {
      ast: null,
      errors: [
        {
          line: header.line,
          message: 'document must start with a `posecode <kind> "<name>"` header',
        },
      ],
    };
  }

  if (!isMovementKind(ht[1].value)) {
    return {
      ast: null,
      errors: [{
        line: header.line,
        message: `unknown movement kind "${ht[1].value}"; expected one of ${MOVEMENT_KINDS.join(", ")}`,
      }],
    };
  }

  const doc: AstDoc = {
    kind: ht[1].value,
    name: ht[2].value,
    rig: "humanoid",
    props: [],
    repeat: 1,
    steps: [],
  };

  let current: AstStep | null = null;
  let invalidStepIndent: number | null = null;
  let topLevelIndent: number | null = null;
  let currentStepIndent: number | null = null;
  let currentChildIndent: number | null = null;

  for (let i = 1; i < lines.length; i++) {
    const ln = lines[i]!;
    // A malformed step header already explains why the phase cannot be parsed.
    // Ignore its indented children so authors get one actionable diagnostic
    // instead of a cascade of misleading "outside of a step" errors.
    if (invalidStepIndent !== null) {
      if (ln.indent > invalidStepIndent) continue;
      invalidStepIndent = null;
    }
    const head = word(ln.tokens[0]);
    const t = ln.tokens;

    // Indentation is syntax, not presentation. All document declarations share
    // one indentation level beneath the header, and all children of a step
    // share one deeper level. Without this gate an unindented joint silently
    // attached to the preceding step, while an indented `repeat` or `rig`
    // mutated the whole document from inside that step.
    if (head && TOP_LEVEL_HEADS.has(head)) {
      if (ln.indent <= header.indent) {
        errors.push({ line: ln.line, message: `top-level \`${head}\` must be indented beneath the posecode header` });
        current = null;
        currentStepIndent = null;
        currentChildIndent = null;
        if (head === "step") invalidStepIndent = ln.indent;
        continue;
      }
      if (topLevelIndent === null) topLevelIndent = ln.indent;
      if (ln.indent !== topLevelIndent) {
        errors.push({ line: ln.line, message: `top-level \`${head}\` must use the document indentation level (${topLevelIndent} spaces)` });
        current = null;
        currentStepIndent = null;
        currentChildIndent = null;
        if (head === "step") invalidStepIndent = ln.indent;
        continue;
      }
      if (head !== "step") {
        current = null;
        currentStepIndent = null;
        currentChildIndent = null;
      }
    } else {
      if (!current || currentStepIndent === null) {
        const err = parseStepChild(ln, null);
        if (err) errors.push(err);
        continue;
      }
      if (ln.indent <= currentStepIndent) {
        errors.push({ line: ln.line, message: "step children must be indented beneath their `step` header" });
        continue;
      }
      if (currentChildIndent === null) currentChildIndent = ln.indent;
      if (ln.indent !== currentChildIndent) {
        errors.push({ line: ln.line, message: `step children must use one indentation level (${currentChildIndent} spaces)` });
        continue;
      }
    }

    switch (head) {
      case "rig": {
        const r = word(t[1]);
        if (t.length !== 2 || !r) {
          errors.push({ line: ln.line, message: "expected `rig humanoid`" });
        } else if (!isRigName(r)) {
          errors.push({
            line: ln.line,
            message: `unknown rig "${r}"; expected one of ${RIG_NAMES.join(", ")}`,
          });
        }
        else doc.rig = r;
        break;
      }
      case "prop": {
        // `prop <type>`: a built-in scene object, repeatable.
        const p = word(t[1]);
        if (t.length !== 2 || !p) {
          errors.push({ line: ln.line, message: "expected `prop <type>`" });
        } else if (!isPropType(p)) {
          errors.push({
            line: ln.line,
            message: `unknown prop "${p}"; expected one of ${PROP_TYPES.join(", ")}`,
          });
        }
        else doc.props.push(p);
        break;
      }
      case "clip": {
        // `clip "<name>"`: an optional mocap clip the renderer may play
        // (retargeted) instead of / blended with the procedural phases.
        if (t.length === 2 && t[1]?.type === "str") doc.clip = t[1].value;
        else errors.push({ line: ln.line, message: 'expected `clip "<name>"`' });
        break;
      }
      case "pose": {
        // `pose start = <name>`
        const name = word(t[3]);
        if (t.length === 4 && word(t[1]) === "start" && t[2]?.type === "eq" && name) {
          if (!isStartPoseName(name)) {
            errors.push({
              line: ln.line,
              message: `unknown start pose "${name}"; expected one of ${START_POSE_NAMES.join(", ")}`,
            });
            break;
          }
          doc.startPose = name;
        } else {
          errors.push({ line: ln.line, message: "expected `pose start = <name>`" });
        }
        break;
      }
      case "repeat": {
        const count = t[1]?.type === "num" ? Number(t[1].value) : NaN;
        if (t.length === 2 && Number.isInteger(count) && count >= 1) doc.repeat = count;
        else errors.push({ line: ln.line, message: "repeat requires a positive integer count" });
        break;
      }
      case "step": {
        const name = t[1];
        const dur = t[2];
        const easingTok = word(t[3]);
        const resolved = easingTok
          ? normalizeMode(easingTok)
          : { mode: null, legacy: false };
        const colon = t[4];
        if (
          name?.type !== "str" ||
          dur?.type !== "dur" ||
          !easingTok ||
          resolved.mode === null ||
          colon?.type !== "colon" ||
          t.length !== 5
        ) {
          errors.push({
            line: ln.line,
            message:
              resolved.mode === null && easingTok
                ? `unknown timing mode "${easingTok}"; expected one of ${MODES.join(", ")}`
                : 'expected `step "<name>" <duration> <mode>:`',
          });
          current = null;
          currentStepIndent = null;
          currentChildIndent = null;
          invalidStepIndent = ln.indent;
          break;
        }
        current = {
          name: name.value,
          durationSec: parseDuration(dur.value),
          easing: resolved.mode,
          targets: [],
          groundLock: [],
          reaches: [],
          pins: [],
          grips: [],
          line: ln.line,
        };
        doc.steps.push(current);
        currentStepIndent = ln.indent;
        currentChildIndent = null;
        break;
      }
      default: {
        // A step-child line (joint target, cue, or ground-lock).
        const err = parseStepChild(ln, current);
        if (err) errors.push(err);
      }
    }
  }

  return { ast: doc, errors };
}

function parseDuration(value: string): number {
  return parseFloat(value.replace(/s$/, ""));
}

function parseStepChild(ln: Line, current: AstStep | null): ParseError | null {
  const t = ln.tokens;
  const head = word(t[0]);

  if (head === "cue") {
    if (!current) return { line: ln.line, message: "`cue` outside of a step" };
    if (t.length !== 2 || t[1]?.type !== "str") {
      return { line: ln.line, message: "`cue` requires exactly one quoted string" };
    }
    current.cue = t[1].value;
    return null;
  }

  if (head === "ground-lock") {
    if (!current) return { line: ln.line, message: "`ground-lock` outside of a step" };
    if (t[1]?.type !== "colon") {
      return { line: ln.line, message: "expected `ground-lock: <contacts>`" };
    }
    if (t.slice(2).some((tok) => tok.type !== "word" && tok.type !== "comma")) {
      return { line: ln.line, message: "expected `ground-lock: <effectors>`" };
    }
    const words = t.slice(2).filter((tok) => tok.type === "word").map((tok) => tok.value);
    const effectors: string[] = [];
    for (let i = 0; i < words.length; i++) {
      const value = words[i]!;
      if (value === "and") continue;
      const next = words[i + 1];
      if (value === "left" || value === "right") {
        const base = next === "hand" ? "hand" : next === "foot" ? "foot" :
          next === "forearm" || next === "elbow" ? "elbow" : null;
        if (base) {
          effectors.push(`${base}_${value}`);
          i++;
          continue;
        }
        return { line: ln.line, message: `unknown ground-lock effector: "${value}${next ? ` ${next}` : ""}"` };
      }
      if (!GROUND_LOCK_EFFECTORS.has(value)) {
        return { line: ln.line, message: `unknown ground-lock effector: "${value}"` };
      }
      effectors.push(value);
    }
    if (effectors.length === 0) {
      return { line: ln.line, message: "`ground-lock` requires at least one contact" };
    }
    current.groundLock = effectors;
    current.groundLockLine = ln.line;
    return null;
  }

  if (head === "reach") {
    // `reach: <effector> <target>`: drive an effector to a world target via IK.
    if (!current) return { line: ln.line, message: "`reach` outside of a step" };
    const effector = t[2]?.type === "word" ? t[2].value : null;
    const target = t[3]?.type === "word" ? t[3].value : null;
    if (t.length !== 4 || t[1]?.type !== "colon" || !effector || !target) {
      return { line: ln.line, message: "expected `reach: <effector> <target>`" };
    }
    current.reaches.push({ effector, target, line: ln.line });
    return null;
  }

  if (head === "pin") {
    // `pin: <effector> <anchor>`: translate the body so the effector sits there.
    if (!current) return { line: ln.line, message: "`pin` outside of a step" };
    const effector = t[2]?.type === "word" ? t[2].value : null;
    const anchor = t[3]?.type === "word" ? t[3].value : null;
    if (t.length !== 4 || t[1]?.type !== "colon" || !effector || !anchor) {
      return { line: ln.line, message: "expected `pin: <effector> <anchor>`" };
    }
    current.pins.push({ effector, anchor, line: ln.line });
    return null;
  }

  if (head === "grip") {
    // `grip: <effector> <anchor>`: hold a bar/rail — arm IK to a two-point
    // anchor + finger wrap. Parsed exactly like `pin`; the side-anchor rewrite
    // happens in resolution.
    if (!current) return { line: ln.line, message: "`grip` outside of a step" };
    const effector = t[2]?.type === "word" ? t[2].value : null;
    const anchor = t[3]?.type === "word" ? t[3].value : null;
    if (t.length !== 4 || t[1]?.type !== "colon" || !effector || !anchor) {
      return { line: ln.line, message: "expected `grip: <effector> <anchor>`" };
    }
    current.grips.push({ effector, anchor, line: ln.line });
    return null;
  }

  if (head === "turn") {
    // `turn: <degrees>`: the figure's facing (root yaw about world Y) at the
    // end of this phase. Absolute, accumulated forward like a joint target.
    if (!current) return { line: ln.line, message: "`turn` outside of a step" };
    if (t.length !== 3 || t[1]?.type !== "colon" || t[2]?.type !== "num") {
      return { line: ln.line, message: "expected `turn: <degrees>`" };
    }
    current.turn = Number(t[2].value);
    return null;
  }

  if (head === "travel") {
    // `travel: <x> <z>`: the figure's ground position (world X/Z metres) at the
    // end of this phase. Absolute offset from the load spot, accumulated forward.
    if (!current) return { line: ln.line, message: "`travel` outside of a step" };
    if (
      t.length !== 4 ||
      t[1]?.type !== "colon" ||
      t[2]?.type !== "num" ||
      t[3]?.type !== "num"
    ) {
      return { line: ln.line, message: "expected `travel: <x> <z>`" };
    }
    current.travel = { x: Number(t[2].value), z: Number(t[3].value) };
    return null;
  }

  // Joint target: `<joint>: <action> <degrees>` or `<joint>: hold neutral`.
  if (!current) {
    return { line: ln.line, message: "joint target outside of a step" };
  }
  if (head === null || t[1]?.type !== "colon" || t[2]?.type !== "word") {
    return { line: ln.line, message: "expected `<joint>: <action> <degrees>`" };
  }
  const action = t[2].value;
  if (action === "hold") {
    if (t.length !== 4 || word(t[3]) !== "neutral") {
      return {
        line: ln.line,
        message: "expected `<joint>: hold neutral` (no trailing angle)",
      };
    }
    current.targets.push({ joint: head, action, degrees: null, line: ln.line });
    return null;
  }
  const degTok = t[3];
  if (t.length !== 4 || degTok?.type !== "num") {
    return { line: ln.line, message: "expected `<joint>: <action> <degrees>`" };
  }
  current.targets.push({
    joint: head,
    action,
    degrees: Number(degTok.value),
    line: ln.line,
  });
  return null;
}
