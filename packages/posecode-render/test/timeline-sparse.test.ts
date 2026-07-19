import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { parse, type PosecodeIR } from "posecode-parser";
import { buildMannequin } from "../src/mannequin.js";
import { buildTimeline } from "../src/timeline.js";

const DEG = 180 / Math.PI;

function eulerDegrees(node: THREE.Object3D): THREE.Euler {
  return new THREE.Euler().setFromQuaternion(node.quaternion, "XYZ");
}

describe("sparse timeline targets", () => {
  it("composes custom start overrides and restores them at the loop boundary", () => {
    const result = parse([
      'posecode posture "Custom opening"',
      "  rig humanoid",
      "  pose start = standing:",
      "    elbow_left: flex 35",
      "    hip_left: flex 20",
      '  step "Move" 1s settle:',
      "    elbow_left: flex 100",
    ].join("\n"));
    expect(result.errors).toEqual([]);
    const timeline = buildTimeline(result.ir!);
    const mannequin = buildMannequin();

    expect(timeline.basePose.root).toEqual({
      position: [0, 0, 0],
      rotationDeg: [0, 0, 0],
    });
    expect(timeline.basePose.joints?.elbow_left).toEqual([-35, -80, 0]);
    expect(timeline.basePose.joints?.hip_left).toEqual([-20, 0, 0]);

    timeline.sample(0, mannequin.bones);
    let elbow = eulerDegrees(mannequin.bones.get("elbow_left")!);
    let hip = eulerDegrees(mannequin.bones.get("hip_left")!);
    expect(elbow.x * DEG).toBeCloseTo(-35, 4);
    expect(elbow.y * DEG).toBeCloseTo(-80, 4); // inherited from standing
    expect(hip.x * DEG).toBeCloseTo(-20, 4);

    expect(timeline.duration).toBeCloseTo(2, 5); // movement + reset segment
    timeline.sample(timeline.duration - 1e-6, mannequin.bones);
    elbow = eulerDegrees(mannequin.bones.get("elbow_left")!);
    hip = eulerDegrees(mannequin.bones.get("hip_left")!);
    expect(elbow.x * DEG).toBeCloseTo(-35, 3);
    expect(elbow.y * DEG).toBeCloseTo(-80, 3);
    expect(hip.x * DEG).toBeCloseTo(-20, 3);
  });

  it("lets a start override explicitly neutralize built-in channels", () => {
    const result = parse([
      'posecode posture "Neutral forearm"',
      "  rig humanoid",
      "  pose start = standing:",
      "    elbow_left: hold neutral",
      '  step "Hold" 1s linear:',
      "    spine: hold neutral",
    ].join("\n"));
    const timeline = buildTimeline(result.ir!);
    const mannequin = buildMannequin();
    timeline.sample(0, mannequin.bones);
    const elbow = eulerDegrees(mannequin.bones.get("elbow_left")!);
    expect(elbow.x * DEG).toBeCloseTo(0, 4);
    expect(elbow.y * DEG).toBeCloseTo(0, 4);
    expect(elbow.z * DEG).toBeCloseTo(0, 4);
  });

  it("returns a basePose with the same hip-hinge coupling as sample(0)", () => {
    const result = parse([
      'posecode posture "Hinged opening"',
      "  rig humanoid",
      "  pose start = standing:",
      "    pelvis: hinge 50",
      '  step "Hold" 1s linear:',
      "    spine: hold neutral",
    ].join("\n"));
    expect(result.errors).toEqual([]);
    const timeline = buildTimeline(result.ir!);
    expect(timeline.basePose.joints?.pelvis).toEqual([50, 0, 0]);
    expect(timeline.basePose.joints?.hip_left).toEqual([-50, 0, 0]);
    expect(timeline.basePose.joints?.hip_right).toEqual([-50, 0, 0]);

    const mannequin = buildMannequin();
    timeline.sample(0, mannequin.bones);
    for (const boneId of ["pelvis", "hip_left", "hip_right"] as const) {
      const [x, y, z] = timeline.basePose.joints![boneId]!;
      const expected = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(x / DEG, y / DEG, z / DEG, "XYZ"),
      );
      expect(mannequin.bones.get(boneId)!.quaternion.angleTo(expected)).toBeLessThan(1e-7);
    }
  });

  it("keeps cues as display-only metadata", () => {
    const source = (withCue: boolean) => [
      'posecode posture "Cue contract"',
      "  rig humanoid",
      "  pose start = standing",
      '  step "Reach" 1s settle:',
      "    shoulder_left: flex 45",
      "    ground-lock: feet",
      ...(withCue ? ['    cue "Lift the left arm"'] : []),
    ].join("\n");

    const withCue = buildTimeline(parse(source(true)).ir!);
    const withoutCue = buildTimeline(parse(source(false)).ir!);
    const cuedMannequin = buildMannequin();
    const plainMannequin = buildMannequin();
    const cuedInfo = withCue.sample(0.5, cuedMannequin.bones);
    const plainInfo = withoutCue.sample(0.5, plainMannequin.bones);

    expect(cuedInfo.cue).toBe("Lift the left arm");
    expect({ ...cuedInfo, cue: undefined }).toEqual({ ...plainInfo, cue: undefined });
    for (const [id, cuedBone] of cuedMannequin.bones) {
      const plainBone = plainMannequin.bones.get(id)!;
      expect(cuedBone.quaternion.angleTo(plainBone.quaternion), id).toBeLessThan(1e-7);
    }
  });

  it("keeps duplicate phase names distinct by timeline index", () => {
    const result = parse([
      'posecode posture "Repeated label"',
      "  rig humanoid",
      '  step "Hold" 1s linear:',
      "    elbows: flex 20",
      '  step "Hold" 1s linear:',
      "    elbows: flex 40",
    ].join("\n"));
    const timeline = buildTimeline(result.ir!);
    const mannequin = buildMannequin();

    expect(timeline.sample(0.5, mannequin.bones)).toMatchObject({
      phaseIndex: 0,
      phaseName: "Hold",
    });
    expect(timeline.sample(1.5, mannequin.bones)).toMatchObject({
      phaseIndex: 1,
      phaseName: "Hold",
    });
  });

  it("preserves an unauthored standing-pose forearm rotation", () => {
    const result = parse([
      'posecode posture "Curl"',
      "  rig humanoid",
      "  pose start = standing",
      '  step "Curl" 1s settle:',
      "    elbow_left: flex 30",
    ].join("\n"));
    const timeline = buildTimeline(result.ir!);
    const mannequin = buildMannequin();
    timeline.sample(1, mannequin.bones);
    const euler = eulerDegrees(mannequin.bones.get("elbow_left")!);
    expect(euler.x * DEG).toBeCloseTo(-30, 4);
    expect(euler.y * DEG).toBeCloseTo(-80, 4);
  });

  it("carries flexion when a later phase authors only axial rotation", () => {
    const result = parse([
      'posecode exercise "Curl and turn"',
      "  rig humanoid",
      '  step "Curl" 1s flow:',
      "    elbow_right: flex 60",
      '  step "Turn" 1s settle:',
      "    elbow_right: pronate 35",
    ].join("\n"));
    const timeline = buildTimeline(result.ir!);
    const mannequin = buildMannequin();
    timeline.sample(2, mannequin.bones);
    const euler = eulerDegrees(mannequin.bones.get("elbow_right")!);
    expect(euler.x * DEG).toBeCloseTo(-60, 4);
    expect(euler.y * DEG).toBeCloseTo(35, 4);
  });

  it("defensively clamps coupled hips in manually constructed legacy IR", () => {
    const ir: PosecodeIR = {
      version: "0.2",
      kind: "posture",
      name: "Legacy fold",
      rig: "humanoid",
      props: [],
      repeat: 1,
      phases: [{
        name: "Fold",
        durationSec: 1,
        easing: "linear",
        targets: [
          { boneId: "pelvis", euler: { x: 50, y: 0, z: 0 } },
          { boneId: "hip_left", euler: { x: -110, y: 0, z: 0 } },
        ],
        groundLock: [],
        reaches: [],
        pins: [],
        grips: [],
      }],
    };
    const timeline = buildTimeline(ir);
    const mannequin = buildMannequin();
    timeline.sample(1, mannequin.bones);
    const hip = eulerDegrees(mannequin.bones.get("hip_left")!);
    expect(hip.x * DEG).toBeCloseTo(-135, 4);
  });
});
