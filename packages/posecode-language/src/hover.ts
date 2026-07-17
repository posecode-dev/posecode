/**
 * Hover info. The biggest win is showing a joint+action's configured range of motion
 * right where it's authored, so the "why was my angle clamped?" answer is one
 * hover away. Falls back to short docs for keywords, kinds, poses, and easings.
 */

import { expandJoint, romFor, boneType } from "posecode-parser";
import {
  JOINT_NAMES,
  ACTION_NAMES,
  MODES,
  KINDS,
  POSES,
  KEYWORD_DOCS,
} from "./vocab.js";

export interface HoverInfo {
  /** Markdown. */
  contents: string;
}

interface Word {
  text: string;
  start: number;
  end: number;
}

function wordAt(lineText: string, character: number): Word | null {
  const isWordChar = (c: string | undefined): boolean => !!c && /[\w-]/.test(c);
  let start = character;
  let end = character;
  while (start > 0 && isWordChar(lineText[start - 1])) start--;
  while (end < lineText.length && isWordChar(lineText[end])) end++;
  if (start === end) return null;
  const text = lineText.slice(start, end);
  if (!/[A-Za-z]/.test(text)) return null;
  return { text, start, end };
}

function md(contents: string): HoverInfo {
  return { contents };
}

export function getHover(
  text: string,
  line: number,
  character: number,
): HoverInfo | null {
  const lineText = text.split(/\r?\n/)[line] ?? "";
  const word = wordAt(lineText, character);
  if (!word) return null;
  const token = word.text;

  if (ACTION_NAMES.includes(token) || token === "hold") {
    const jointMatch = lineText.match(/^\s*([\w-]+)\s*:/);
    const bone = jointMatch ? expandJoint(jointMatch[1]!)[0] : undefined;
    if (bone && token !== "hold") {
      const rom = romFor(bone, token);
      if (rom) {
        return md(
          `**${boneType(bone)} · ${token}**: configured range **${rom.min}–${rom.max}°**. Angles beyond this are clamped with a diagnostic.`,
        );
      }
    }
    return md(`Action **${token}**.`);
  }

  if (JOINT_NAMES.includes(token)) {
    return md(`Joint **${token}** → ${expandJoint(token).join(", ")}.`);
  }

  const keywordDoc = KEYWORD_DOCS[token];
  if (keywordDoc) return md(`**${token}**: ${keywordDoc}`);
  if (KINDS.includes(token)) return md(`Movement kind **${token}**.`);
  if (POSES.includes(token)) return md(`Start pose **${token}**.`);
  if ((MODES as readonly string[]).includes(token)) {
    return md(`**${token}**: ${KEYWORD_DOCS[token] ?? "timing mode"}`);
  }
  return null;
}
