import { describe, expect, it } from "vitest";
import { parse } from "posecode-parser";
import {
  UNIMATE_CONSTRAINT_SCHEMA,
  buildUniMateConstraintManifest,
} from "../src/unimate.js";

const SOURCE = `posecode exercise "Controlled squat reach"
  rig humanoid
  pose start = standing

  step "Lower" 1s settle:
    pelvis: hinge 20
    hips: flex 70
    knees: flex 90
    ground-lock: feet
    cue "lower while keeping both feet planted"

  step "Reach" 0.5s flow:
    shoulder_left: flex 80
    reach: hand_left ankle_left
    turn: 30
    travel: 0.2 0.1
  repeat 2
`;

describe("buildUniMateConstraintManifest", () => {
  it("exports contiguous prompt clips and exact sparse key-pose references", () => {
    const parsed = parse(SOURCE);
    expect(parsed.errors).toEqual([]);
    const manifest = buildUniMateConstraintManifest(parsed.ir!, { fps: 30 });

    expect(manifest.schema).toBe(UNIMATE_CONSTRAINT_SCHEMA);
    expect(manifest.source).toMatchObject({
      name: "Controlled squat reach",
      startPose: "standing",
      repeat: 2,
    });
    expect(manifest.timing).toEqual({
      fps: 30,
      frames: 45,
      durationSeconds: 1.5,
      frameIndexing: "one-based-inclusive",
    });
    expect(manifest.clips).toEqual([
      {
        prompt: "Controlled squat reach. Lower",
        cue: "lower while keeping both feet planted",
        start: 1,
        end: 30,
        constraints: {
          groundLock: ["feet"],
          reaches: [],
          pins: [],
          grips: [],
        },
        references: [
          { frame: 1, keyframeId: "start" },
          { frame: 30, keyframeId: "phase-1" },
        ],
      },
      {
        prompt: "Controlled squat reach. Reach",
        start: 31,
        end: 45,
        constraints: {
          groundLock: [],
          reaches: [{ effector: "hand_left", target: "ankle_left" }],
          pins: [],
          grips: [],
        },
        references: [{ frame: 45, keyframeId: "phase-2" }],
      },
    ]);
  });

  it("carries joint state, root intent, contacts, and renderer hip coupling", () => {
    const manifest = buildUniMateConstraintManifest(parse(SOURCE).ir!);
    const lower = manifest.keyframes[1]!;
    const reach = manifest.keyframes[2]!;

    expect(lower.localEulerDeg.pelvis).toEqual([20, 0, 0]);
    expect(lower.localEulerDeg.hip_left).toEqual([-90, 0, 0]);
    expect(lower.localEulerDeg.hip_right).toEqual([-90, 0, 0]);
    expect(lower.constraints.groundLock).toEqual(["feet"]);
    expect(reach.localEulerDeg.knee_left).toEqual([90, 0, 0]);
    expect(reach.localEulerDeg.shoulder_left).toEqual([-80, 0, 0]);
    expect(reach.constraints.reaches).toEqual([
      { effector: "hand_left", target: "ankle_left" },
    ]);
    expect(reach.root).toMatchObject({
      positionMeters: [0.2, 0, 0.1],
      yawDeg: 30,
    });
  });

  it("keeps checkpoint-specific encoding outside the interchange", () => {
    const manifest = buildUniMateConstraintManifest(parse(SOURCE).ir!);
    expect(manifest.generation).toEqual({
      knownChannels: ["position", "rotation6d"],
      generatedChannels: ["velocity"],
      sourceOfTruth: "keyframes",
    });
    expect(JSON.stringify(manifest)).not.toContain("dataset_stats");
    expect(manifest.caveats.join(" ")).toContain("rig-aware adapter");
  });

  it("rejects phases that collapse below UniMate-B3D's two-frame minimum", () => {
    const parsed = parse(`posecode posture "Flash"
  rig humanoid
  step "Too short" 0.01s snap:
    head: flex 5
`);
    expect(parsed.errors).toEqual([]);
    expect(() => buildUniMateConstraintManifest(parsed.ir!, { fps: 30 })).toThrow(
      /needs at least 2 frames/,
    );
  });
});
