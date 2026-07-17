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
