import {
  ACTION_NAMES,
  JOINT_NAMES,
  expandJoint,
  romFor,
} from "posecode-parser";

const JOINT_SET = new Set<string>(JOINT_NAMES);
const ACTION_SET = new Set<string>(ACTION_NAMES);

/**
 * A directly-manipulable `<joint>: <action> <angle>` source line.
 * Positions are absolute CodeMirror document offsets and use half-open ranges.
 */
export interface AngleTarget {
  joint: string;
  action: string;
  degrees: number;
  jointFrom: number;
  jointTo: number;
  angleFrom: number;
  angleTo: number;
}

export interface AngleRange {
  min: number;
  max: number;
}

interface SourceLineRange {
  from: number;
  to: number;
}

interface PreviewSegment {
  start: number;
  end: number;
}

// Keep this deliberately stricter than syntax highlighting. Only complete,
// parser-valid joint target lines become controls; comments, turn/travel
// numbers, and half-written source remain ordinary editable text.
const JOINT_TARGET =
  /^(\s*)([A-Za-z][\w-]*)(\s*:\s*)([A-Za-z][\w-]*)(\s+)(-?(?:\d+(?:\.\d*)?|\.\d+))(?=\s*(?:(?:#|\/\/).*)?$)/;

/** Locate every source angle that can safely become an inline control. */
export function findAngleTargets(source: string): AngleTarget[] {
  const targets: AngleTarget[] = [];
  let lineFrom = 0;

  for (const line of source.split(/\n/)) {
    const match = JOINT_TARGET.exec(line.replace(/\r$/, ""));
    if (match && JOINT_SET.has(match[2]!) && ACTION_SET.has(match[4]!)) {
      const joint = match[2]!;
      const action = match[4]!;
      // Unsupported joint/action pairs stay plain text so the parser error
      // remains the primary interaction rather than presenting a bogus range.
      if (angleRangeFor(joint, action)) {
        const jointFrom = lineFrom + match[1]!.length;
        const angleFrom =
          jointFrom +
          match[2]!.length +
          match[3]!.length +
          match[4]!.length +
          match[5]!.length;
        const angleText = match[6]!;
        targets.push({
          joint,
          action,
          degrees: Number(angleText),
          jointFrom,
          jointTo: jointFrom + joint.length,
          angleFrom,
          angleTo: angleFrom + angleText.length,
        });
      }
    }
    // split() removes the newline, so account for it between every pair.
    lineFrom += line.length + 1;
  }

  return targets;
}

/** Find the target whose joint or angle contains a document position. */
export function angleTargetAt(
  source: string,
  position: number,
  part: "joint" | "angle",
): AngleTarget | null {
  for (const target of findAngleTargets(source)) {
    const from = part === "joint" ? target.jointFrom : target.angleFrom;
    const to = part === "joint" ? target.jointTo : target.angleTo;
    if (position >= from && position < to) return target;
  }
  return null;
}

/**
 * Return the ROM intersection for all bones represented by a DSL joint name.
 * Groups therefore get one honest range that is valid for every selected bone.
 */
export function angleRangeFor(joint: string, action: string): AngleRange | null {
  const bones = expandJoint(joint);
  const limits = bones
    .map((bone) => romFor(bone, action))
    .filter((limit): limit is AngleRange => limit !== null);
  if (limits.length === 0 || limits.length !== bones.length) return null;

  const min = Math.max(...limits.map((limit) => limit.min));
  const max = Math.min(...limits.map((limit) => limit.max));
  return min <= max ? { min, max } : null;
}

/** Clamp and format a spinner value without accumulating float noise. */
export function normalizeAngle(value: number, range: AngleRange): string {
  const clamped = Math.min(range.max, Math.max(range.min, value));
  return String(Math.round(clamped * 10) / 10);
}

/**
 * Resolve a directly edited source line to the key pose it controls. Joint
 * targets in a start-pose override preview at time zero; targets in a step
 * preview just inside that phase's endpoint so the looping sampler cannot wrap.
 */
export function previewTimeForLine(
  line: number,
  phaseRanges: readonly SourceLineRange[],
  segments: readonly PreviewSegment[],
): number | null {
  const firstPhase = phaseRanges[0];
  if (firstPhase && line < firstPhase.from) return 0;

  const phaseIndex = phaseRanges.findIndex(
    (range) => line >= range.from && line <= range.to,
  );
  const segment = phaseIndex < 0 ? undefined : segments[phaseIndex];
  if (!segment) return null;
  return Math.max(segment.start, segment.end - 1e-3);
}
