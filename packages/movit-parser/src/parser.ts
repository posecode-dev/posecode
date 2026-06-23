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

export interface AstStep {
  name: string;
  durationSec: number;
  easing: string;
  targets: AstJointTarget[];
  groundLock: string[];
  cue?: string;
  line: number;
}

export interface AstDoc {
  kind: string;
  name: string;
  rig: string;
  startPose?: string;
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
