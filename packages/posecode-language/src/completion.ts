/**
 * Context-aware completions. We classify the cursor position from the current
 * line's prefix (cheap and good enough for a small DSL) and return the matching
 * vocabulary. Positions are 0-based (LSP convention); the playground adapter
 * converts CodeMirror offsets before calling in.
 */

import {
  KINDS,
  POSES,
  EFFECTORS,
  REACH_EFFECTORS,
  PIN_EFFECTORS,
  GRIP_EFFECTORS,
  MODES,
  JOINT_NAMES,
  ACTION_NAMES,
  actionsForJoint,
  TOP_KEYWORDS,
  CHILD_KEYWORDS,
  KEYWORD_DOCS,
} from "./vocab.js";

export type CompletionKind =
  | "keyword"
  | "kind"
  | "pose"
  | "easing"
  | "joint"
  | "action"
  | "effector";

export interface CompletionItem {
  label: string;
  kind: CompletionKind;
  detail?: string;
}

type Context =
  | "kind"
  | "pose"
  | "easing"
  | "effector"
  | "reach-effector"
  | "pin-effector"
  | "grip-effector"
  | "action"
  | "joint"
  | "start-joint"
  | "top"
  | "none";

interface EnclosingBlock {
  kind: "start-pose" | "step";
  indent: number;
}

function contextFor(
  prefix: string,
  line: number,
  enclosingBlock: EnclosingBlock | null,
  documentIndent: number | null,
): Context {
  if (line === 0) {
    return /^\s*posecode\s+[\w-]*$/.test(prefix) ? "kind" : "none";
  }
  const indent = prefix.length - prefix.trimStart().length;
  const atDocumentIndent =
    enclosingBlock === null && indent > 0 && (documentIndent === null || indent === documentIndent);
  if (atDocumentIndent && /^\s*pose\s+start\s*=\s*[\w-]*$/.test(prefix)) return "pose";
  if (atDocumentIndent && /^\s*step\s+"[^"]*"\s+[0-9.]+s\s+[\w-]*$/.test(prefix)) return "easing";
  const isActualChild = enclosingBlock !== null && indent > enclosingBlock.indent;
  if (isActualChild && enclosingBlock.kind === "start-pose") {
    if (/^\s*[\w-]+\s*:\s*[\w-]*$/.test(prefix)) return "action";
    return /^\s*[\w-]*$/.test(prefix) ? "start-joint" : "none";
  }
  const isStepChild = isActualChild && enclosingBlock.kind === "step";
  const isConventionalChild = indent >= 4;
  if ((isStepChild || isConventionalChild) && /^\s*ground-lock\s*:\s*[\w,\s-]*$/.test(prefix)) return "effector";
  if ((isStepChild || isConventionalChild) && /^\s*reach\s*:\s*[\w-]*$/.test(prefix)) return "reach-effector";
  if ((isStepChild || isConventionalChild) && /^\s*pin\s*:\s*[\w-]*$/.test(prefix)) return "pin-effector";
  if ((isStepChild || isConventionalChild) && /^\s*grip\s*:\s*[\w-]*$/.test(prefix)) return "grip-effector";
  if ((isStepChild || isConventionalChild) && /^\s*[\w-]+\s*:\s*[\w-]*$/.test(prefix)) return "action";
  if (/^\s*[\w-]*$/.test(prefix)) {
    return isStepChild || isConventionalChild ? "joint" : indent > 0 ? "top" : "none";
  }
  return "none";
}

/** Find the closest less-indented scoped header that owns the cursor line. */
function enclosingBlockAt(
  lines: readonly string[],
  line: number,
  currentIndent: number,
): EnclosingBlock | null {
  for (let i = line - 1; i >= 0; i--) {
    const candidate = lines[i]!;
    const trimmed = candidate.trim();
    if (trimmed === "" || trimmed.startsWith("#") || trimmed.startsWith("//")) continue;
    const indent = candidate.length - candidate.trimStart().length;
    if (indent >= currentIndent) continue;
    if (/^pose\s+start\s*=\s*[\w-]+\s*:\s*(?:#.*|\/\/.*)?$/.test(trimmed)) {
      return { kind: "start-pose", indent };
    }
    if (/^step\s+"[^"]*"\s+[0-9.]+s\s+[\w-]+\s*:\s*(?:#.*|\/\/.*)?$/.test(trimmed)) {
      return { kind: "step", indent };
    }
    // Any other less-indented line is a structural boundary: do not scan
    // through a later directive and accidentally re-enter an older block.
    return null;
  }
  return null;
}

/** Indentation established by the first document directive before the cursor. */
function documentIndentBefore(lines: readonly string[], line: number): number | null {
  for (let i = 1; i < line; i++) {
    const candidate = lines[i]!;
    const trimmed = candidate.trim();
    if (trimmed === "" || trimmed.startsWith("#") || trimmed.startsWith("//")) continue;
    if (!/^(?:rig|prop|pose|clip|step|repeat)\b/.test(trimmed)) continue;
    return candidate.length - candidate.trimStart().length;
  }
  return null;
}

function item(label: string, kind: CompletionKind): CompletionItem {
  const detail = KEYWORD_DOCS[label];
  return detail ? { label, kind, detail } : { label, kind };
}

export function getCompletions(
  text: string,
  line: number,
  character: number,
): CompletionItem[] {
  const lineText = text.split(/\r?\n/)[line] ?? "";
  const prefix = lineText.slice(0, character);
  const lines = text.split(/\r?\n/);
  const indent = prefix.length - prefix.trimStart().length;
  const enclosingBlock = enclosingBlockAt(lines, line, indent);

  switch (contextFor(prefix, line, enclosingBlock, documentIndentBefore(lines, line))) {
    case "kind":
      return KINDS.map((k) => item(k, "kind"));
    case "pose":
      return POSES.map((p) => item(p, "pose"));
    case "easing":
      return MODES.map((e) => item(e, "easing"));
    case "effector":
      return EFFECTORS.map((e) => item(e, "effector"));
    case "reach-effector":
      return REACH_EFFECTORS.map((e) => item(e, "effector"));
    case "pin-effector":
      return PIN_EFFECTORS.map((e) => item(e, "effector"));
    case "grip-effector":
      return GRIP_EFFECTORS.map((e) => item(e, "effector"));
    case "action":
      {
        const joint = /^\s*([\w-]+)\s*:/.exec(prefix)?.[1];
        const actions = joint ? actionsForJoint(joint) : ACTION_NAMES;
        return [...actions, "hold"].map((a) => item(a, "action"));
      }
    case "joint":
      return [
        ...JOINT_NAMES.map((j) => item(j, "joint")),
        ...CHILD_KEYWORDS.map((k) => item(k, "keyword")),
      ];
    case "start-joint":
      return JOINT_NAMES.map((j) => item(j, "joint"));
    case "top":
      return TOP_KEYWORDS.map((k) => item(k, "keyword"));
    default:
      return [];
  }
}
