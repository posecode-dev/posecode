/**
 * Recursive-descent parser: tokenized lines → an Abstract Syntax Tree.
 *
 * The AST is intentionally "shallow" — it captures what was written without
 * resolving joints, axes, or ROM. That resolution happens in `clamp.ts`,
 * keeping parsing and biomechanics cleanly separated.
 */

import { tokenize, TokenizeError, type Line, type Token } from "./tokenizer.js";
import type { ParseError } from "./types.js";

export interface AstJointTarget {
  joint: string;
  action: string;
  degrees: number | null;
  line: number;
}

export interface AstReach {
  effector: string;
  target: string;
}

export interface AstPin {
  effector: string;
  anchor: string;
}

export interface AstStep {
  name: string;
  durationSec: number;
  easing: string;
  targets: AstJointTarget[];
  groundLock: string[];
  reaches: AstReach[];
  pins: AstPin[];
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

  // Header: `movit <kind> "<name>"`
  const header = lines[0]!;
  const ht = header.tokens;
  if (word(ht[0]) !== "movit" || ht[1]?.type !== "word" || ht[2]?.type !== "str") {
    return {
      ast: null,
      errors: [
        {
          line: header.line,
          message: 'document must start with a `movit <kind> "<name>"` header',
        },
      ],
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

  for (let i = 1; i < lines.length; i++) {
    const ln = lines[i]!;
    const head = word(ln.tokens[0]);
    const t = ln.tokens;

    switch (head) {
      case "rig": {
        const r = word(t[1]);
        if (!r) errors.push({ line: ln.line, message: "rig requires a name" });
        else doc.rig = r;
        break;
      }
      case "prop": {
        // `prop <type>` — a scene object (chair | wall | bar), repeatable.
        const p = word(t[1]);
        if (!p) errors.push({ line: ln.line, message: "prop requires a type" });
        else doc.props.push(p);
        break;
      }
      case "pose": {
        // `pose start = <name>`
        const name = t.length > 0 ? t[t.length - 1] : undefined;
        if (word(t[1]) === "start" && name && name.type === "word") {
          doc.startPose = name.value;
        } else {
          errors.push({ line: ln.line, message: "expected `pose start = <name>`" });
        }
        break;
      }
      case "repeat": {
        if (t[1]?.type === "num") doc.repeat = Math.max(1, Math.round(Number(t[1].value)));
        else errors.push({ line: ln.line, message: "repeat requires a count" });
        break;
      }
      case "step": {
        const name = t[1];
        const dur = t[2];
        const easing = word(t[3]);
        const colon = t[4];
        if (
          name?.type !== "str" ||
          dur?.type !== "dur" ||
          !easing ||
          colon?.type !== "colon"
        ) {
          errors.push({
            line: ln.line,
            message: 'expected `step "<name>" <duration> <easing>:`',
          });
          current = null;
          break;
        }
        current = {
          name: name.value,
          durationSec: parseDuration(dur.value),
          easing,
          targets: [],
          groundLock: [],
          reaches: [],
          pins: [],
          line: ln.line,
        };
        doc.steps.push(current);
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
    if (t[1]?.type !== "str") return { line: ln.line, message: "`cue` requires a quoted string" };
    current.cue = t[1].value;
    return null;
  }

  if (head === "ground-lock") {
    if (!current) return { line: ln.line, message: "`ground-lock` outside of a step" };
    const effectors = t
      .slice(1)
      .filter((tok) => tok.type === "word")
      .map((tok) => tok.value);
    current.groundLock = effectors;
    return null;
  }

  if (head === "reach") {
    // `reach: <effector> <target>` — drive an effector to a world target via IK.
    if (!current) return { line: ln.line, message: "`reach` outside of a step" };
    const effector = t[2]?.type === "word" ? t[2].value : null;
    const target = t[3]?.type === "word" ? t[3].value : null;
    if (t[1]?.type !== "colon" || !effector || !target) {
      return { line: ln.line, message: "expected `reach: <effector> <target>`" };
    }
    current.reaches.push({ effector, target });
    return null;
  }

  if (head === "pin") {
    // `pin: <effector> <anchor>` — translate the body so the effector sits there.
    if (!current) return { line: ln.line, message: "`pin` outside of a step" };
    const effector = t[2]?.type === "word" ? t[2].value : null;
    const anchor = t[3]?.type === "word" ? t[3].value : null;
    if (t[1]?.type !== "colon" || !effector || !anchor) {
      return { line: ln.line, message: "expected `pin: <effector> <anchor>`" };
    }
    current.pins.push({ effector, anchor });
    return null;
  }

  if (head === "turn") {
    // `turn: <degrees>` — the figure's facing (root yaw about world Y) at the
    // end of this phase. Absolute, accumulated forward like a joint target.
    if (!current) return { line: ln.line, message: "`turn` outside of a step" };
    if (t[1]?.type !== "colon" || t[2]?.type !== "num") {
      return { line: ln.line, message: "expected `turn: <degrees>`" };
    }
    current.turn = Number(t[2].value);
    return null;
  }

  if (head === "travel") {
    // `travel: <x> <z>` — the figure's ground position (world X/Z metres) at the
    // end of this phase. Absolute offset from the load spot, accumulated forward.
    if (!current) return { line: ln.line, message: "`travel` outside of a step" };
    if (t[1]?.type !== "colon" || t[2]?.type !== "num" || t[3]?.type !== "num") {
      return { line: ln.line, message: "expected `travel: <x> <z>`" };
    }
    current.travel = { x: Number(t[2].value), z: Number(t[3].value) };
    return null;
  }

  // Joint target: `<joint>: <action> [<degrees>]`
  if (!current) {
    return { line: ln.line, message: "joint target outside of a step" };
  }
  if (head === null || t[1]?.type !== "colon" || t[2]?.type !== "word") {
    return { line: ln.line, message: "expected `<joint>: <action> [<degrees>]`" };
  }
  const degTok = t[3];
  current.targets.push({
    joint: head,
    action: t[2].value,
    degrees: degTok && degTok.type === "num" ? Number(degTok.value) : null,
    line: ln.line,
  });
  return null;
}
