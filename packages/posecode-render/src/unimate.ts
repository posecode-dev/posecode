/**
 * Sparse, rig-neutral key-pose interchange for a UniMate in-betweening bridge.
 *
 * This module deliberately stops before UniMate's `(T, J, 12)` tensor. Building
 * that tensor requires the destination rig's rest geometry and the selected
 * checkpoint's normalization statistics. The manifest keeps Posecode's exact
 * authored intent intact so a rig-aware consumer (for example a Blender
 * adapter) can perform that final conversion without guessing.
 */

import type {
  EulerDeg,
  GripTarget,
  PinTarget,
  PosecodeIR,
  ReachTarget,
} from "posecode-parser";
import { poseFor } from "./poses.js";

export const UNIMATE_CONSTRAINT_SCHEMA = "posecode.unimate.constraints.v1" as const;

export interface UniMateConstraintOptions {
  /** Output timeline rate. UniMate's released checkpoints use 30 FPS. */
  fps?: number;
  /** Optional context prepended to every phase prompt. */
  promptPrefix?: string;
}

export interface UniMateBoneBinding {
  posecode: string;
  /** Mixamo convention without a `mixamorig` namespace. */
  mixamo: string;
}

export interface UniMateConstraintSet {
  groundLock: string[];
  reaches: ReachTarget[];
  pins: PinTarget[];
  grips: GripTarget[];
}

export interface UniMateConstraintKeyframe {
  id: string;
  /** One-based, matching Blender and UniMate-B3D timeline ranges. */
  frame: number;
  timeSeconds: number;
  phase: string;
  /** Local XYZ Euler channels in Posecode's anatomical convention. */
  localEulerDeg: Record<string, [number, number, number]>;
  root: {
    /** Authored root translation before grounding/contact solving. */
    positionMeters: [number, number, number];
    /** Base-pose XYZ rotation; locomotion facing remains a separate yaw. */
    rotationDeg: [number, number, number];
    yawDeg: number;
  };
  constraints: UniMateConstraintSet;
}

export interface UniMatePromptClip {
  prompt: string;
  /** Display-only coaching metadata; it never changes generation prompts. */
  cue?: string;
  /** Inclusive, one-based frame range. */
  start: number;
  end: number;
  /** Contact intent active across this complete phase range. */
  constraints: UniMateConstraintSet;
  references: Array<{ frame: number; keyframeId: string }>;
}

export interface UniMateConstraintManifest {
  schema: typeof UNIMATE_CONSTRAINT_SCHEMA;
  source: {
    name: string;
    kind: string;
    posecodeVersion: string;
    rig: string;
    startPose: string;
    repeat: number;
  };
  timing: {
    fps: number;
    frames: number;
    durationSeconds: number;
    frameIndexing: "one-based-inclusive";
  };
  rig: {
    profile: "posecode-humanoid";
    boneBindings: UniMateBoneBinding[];
  };
  clips: UniMatePromptClip[];
  keyframes: UniMateConstraintKeyframe[];
  generation: {
    knownChannels: ["position", "rotation6d"];
    generatedChannels: ["velocity"];
    sourceOfTruth: "keyframes";
  };
  caveats: string[];
}

/** Driver bone id to common Mixamo bone name. */
export const POSECODE_MIXAMO_BINDINGS: readonly UniMateBoneBinding[] = [
  { posecode: "pelvis", mixamo: "Hips" },
  { posecode: "spine", mixamo: "Spine" },
  { posecode: "chest", mixamo: "Spine2" },
  { posecode: "neck", mixamo: "Neck" },
  { posecode: "head", mixamo: "Head" },
  { posecode: "shoulder_left", mixamo: "LeftArm" },
  { posecode: "elbow_left", mixamo: "LeftForeArm" },
  { posecode: "wrist_left", mixamo: "LeftHand" },
  { posecode: "shoulder_right", mixamo: "RightArm" },
  { posecode: "elbow_right", mixamo: "RightForeArm" },
  { posecode: "wrist_right", mixamo: "RightHand" },
  { posecode: "hip_left", mixamo: "LeftUpLeg" },
  { posecode: "knee_left", mixamo: "LeftLeg" },
  { posecode: "ankle_left", mixamo: "LeftFoot" },
  { posecode: "hip_right", mixamo: "RightUpLeg" },
  { posecode: "knee_right", mixamo: "RightLeg" },
  { posecode: "ankle_right", mixamo: "RightFoot" },
  { posecode: "thumb_left", mixamo: "LeftHandThumb1" },
  { posecode: "index_left", mixamo: "LeftHandIndex1" },
  { posecode: "middle_left", mixamo: "LeftHandMiddle1" },
  { posecode: "ring_left", mixamo: "LeftHandRing1" },
  { posecode: "pinky_left", mixamo: "LeftHandPinky1" },
  { posecode: "thumb_right", mixamo: "RightHandThumb1" },
  { posecode: "index_right", mixamo: "RightHandIndex1" },
  { posecode: "middle_right", mixamo: "RightHandMiddle1" },
  { posecode: "ring_right", mixamo: "RightHandRing1" },
  { posecode: "pinky_right", mixamo: "RightHandPinky1" },
] as const;

type EulerTuple = [number, number, number];

/**
 * Convert validated Posecode IR into a sparse constraint schedule.
 *
 * The result is JSON-safe and deterministic. It is not a normalized UniMate
 * model tensor: a consumer must first apply these local rotations to its own
 * rest skeleton, run FK, then call the checkpoint-specific pose encoder.
 */
export function buildUniMateConstraintManifest(
  ir: PosecodeIR,
  options: UniMateConstraintOptions = {},
): UniMateConstraintManifest {
  const fps = options.fps ?? 30;
  if (!Number.isInteger(fps) || fps <= 0 || fps > 240) {
    throw new RangeError("buildUniMateConstraintManifest: fps must be an integer from 1 to 240");
  }

  const base = poseFor(ir.startPose);
  const authored = new Map<string, EulerTuple>(
    Object.entries(base.joints ?? {}).map(([bone, euler]) => [bone, [...euler]]),
  );
  mergeTargets(authored, ir.startPoseOverrides ?? []);

  const basePosition = [...(base.root?.position ?? [0, 0, 0])] as EulerTuple;
  const baseRotation = [...(base.root?.rotationDeg ?? [0, 0, 0])] as EulerTuple;
  const keyframes: UniMateConstraintKeyframe[] = [
    makeKeyframe(
      "start",
      1,
      0,
      ir.startPose ?? "neutral",
      authored,
      basePosition,
      baseRotation,
      0,
      emptyConstraints(),
    ),
  ];
  const clips: UniMatePromptClip[] = [];
  let cursor = 1;
  let timeSeconds = 0;
  let yawDeg = 0;
  let travel = { x: 0, z: 0 };

  ir.phases.forEach((phase, phaseIndex) => {
    const frames = Math.round(phase.durationSec * fps);
    if (frames < 2) {
      throw new RangeError(
        `buildUniMateConstraintManifest: phase ${JSON.stringify(phase.name)} needs at least 2 frames at ${fps} FPS`,
      );
    }
    mergeTargets(authored, phase.targets);
    if (phase.turnDeg !== undefined) yawDeg = phase.turnDeg;
    if (phase.travel) travel = { ...phase.travel };
    timeSeconds += phase.durationSec;

    const start = cursor;
    const end = start + frames - 1;
    const id = `phase-${phaseIndex + 1}`;
    keyframes.push(
      makeKeyframe(
        id,
        end,
        timeSeconds,
        phase.name,
        authored,
        [basePosition[0] + travel.x, basePosition[1], basePosition[2] + travel.z],
        baseRotation,
        yawDeg,
        {
          groundLock: [...phase.groundLock],
          reaches: phase.reaches.map((target) => ({ ...target })),
          pins: phase.pins.map((target) => ({ ...target })),
          grips: phase.grips.map((target) => ({ ...target })),
        },
      ),
    );

    const constraints: UniMateConstraintSet = {
      groundLock: [...phase.groundLock],
      reaches: phase.reaches.map((target) => ({ ...target })),
      pins: phase.pins.map((target) => ({ ...target })),
      grips: phase.grips.map((target) => ({ ...target })),
    };
    const prompt = [options.promptPrefix?.trim(), ir.name, phase.name]
      .filter(Boolean)
      .join(". ");
    clips.push({
      prompt,
      ...(phase.cue ? { cue: phase.cue } : {}),
      start,
      end,
      constraints,
      references: [
        ...(phaseIndex === 0 ? [{ frame: 1, keyframeId: "start" }] : []),
        { frame: end, keyframeId: id },
      ],
    });
    cursor = end + 1;
  });

  return {
    schema: UNIMATE_CONSTRAINT_SCHEMA,
    source: {
      name: ir.name,
      kind: ir.kind,
      posecodeVersion: ir.version,
      rig: ir.rig,
      startPose: ir.startPose ?? "neutral",
      repeat: ir.repeat,
    },
    timing: {
      fps,
      frames: Math.max(1, cursor - 1),
      durationSeconds: timeSeconds,
      frameIndexing: "one-based-inclusive",
    },
    rig: {
      profile: "posecode-humanoid",
      boneBindings: POSECODE_MIXAMO_BINDINGS.map((binding) => ({ ...binding })),
    },
    clips,
    keyframes,
    generation: {
      knownChannels: ["position", "rotation6d"],
      generatedChannels: ["velocity"],
      sourceOfTruth: "keyframes",
    },
    caveats: [
      "Keyframes contain authored local rotations and root travel before IK, grounding, and contact solving.",
      "A rig-aware adapter must apply FK and checkpoint normalization before constructing x1_known and keep_mask.",
      "Model weights and generated motion remain subject to the UniMate checkpoint and training-data terms.",
    ],
  };
}

function mergeTargets(
  pose: Map<string, EulerTuple>,
  targets: readonly { boneId: string; euler: EulerDeg; axes?: readonly ("x" | "y" | "z")[] }[],
): void {
  const axisIndex = { x: 0, y: 1, z: 2 } as const;
  for (const target of targets) {
    const next = [...(pose.get(target.boneId) ?? [0, 0, 0])] as EulerTuple;
    for (const axis of target.axes ?? ["x", "y", "z"]) {
      next[axisIndex[axis]] = target.euler[axis];
    }
    pose.set(target.boneId, next);
  }
}

function makeKeyframe(
  id: string,
  frame: number,
  timeSeconds: number,
  phase: string,
  authored: Map<string, EulerTuple>,
  positionMeters: EulerTuple,
  rotationDeg: EulerTuple,
  yawDeg: number,
  constraints: UniMateConstraintSet,
): UniMateConstraintKeyframe {
  const pose = new Map<string, EulerTuple>();
  for (const [bone, euler] of authored) pose.set(bone, [...euler]);

  // Match the renderer's hip-hinge coupling: pelvis flexion tips the torso,
  // while equal counter-rotation keeps the legs in their authored frame.
  const pelvisX = authored.get("pelvis")?.[0] ?? 0;
  if (pelvisX !== 0) {
    for (const hip of ["hip_left", "hip_right"]) {
      const [x, y, z] = authored.get(hip) ?? [0, 0, 0];
      pose.set(hip, [Math.max(-135, Math.min(20, x - pelvisX)), y, z]);
    }
  }

  return {
    id,
    frame,
    timeSeconds,
    phase,
    localEulerDeg: Object.fromEntries(
      [...pose.entries()].sort(([a], [b]) => a.localeCompare(b)),
    ),
    root: {
      positionMeters: [...positionMeters],
      rotationDeg: [...rotationDeg],
      yawDeg,
    },
    constraints,
  };
}

function emptyConstraints(): UniMateConstraintSet {
  return { groundLock: [], reaches: [], pins: [], grips: [] };
}
