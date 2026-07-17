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
  | "top"
  | "none";

function contextFor(prefix: string, line: number): Context {
  if (line === 0) {
    return /^\s*posecode\s+[\w-]*$/.test(prefix) ? "kind" : "none";
  }
  const indent = prefix.length - prefix.trimStart().length;
  if (indent === 2 && /^\s*pose\s+start\s*=\s*[\w-]*$/.test(prefix)) return "pose";
  if (indent === 2 && /^\s*step\s+"[^"]*"\s+[0-9.]+s\s+[\w-]*$/.test(prefix)) return "easing";
  if (indent >= 4 && /^\s*ground-lock\s*:\s*[\w,\s-]*$/.test(prefix)) return "effector";
  if (indent >= 4 && /^\s*reach\s*:\s*[\w-]*$/.test(prefix)) return "reach-effector";
  if (indent >= 4 && /^\s*pin\s*:\s*[\w-]*$/.test(prefix)) return "pin-effector";
  if (indent >= 4 && /^\s*grip\s*:\s*[\w-]*$/.test(prefix)) return "grip-effector";
  if (indent >= 4 && /^\s*[\w-]+\s*:\s*[\w-]*$/.test(prefix)) return "action";

  if (/^\s*[\w-]*$/.test(prefix)) {
    return indent >= 4 ? "joint" : indent >= 2 ? "top" : "none";
  }
  return "none";
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

  switch (contextFor(prefix, line)) {
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
    case "top":
      return TOP_KEYWORDS.map((k) => item(k, "keyword"));
    default:
      return [];
  }
}
