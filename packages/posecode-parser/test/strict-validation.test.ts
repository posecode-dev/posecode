import { describe, expect, it } from "vitest";
import { parse } from "../src/index.js";

function doc(...body: string[]): string {
  return [
    'posecode posture "Test"',
    "  rig humanoid",
    '  step "Pose" 1s linear:',
    ...body.map((line) => `    ${line}`),
  ].join("\n");
}

describe("closed protocol vocabulary and arity", () => {
  it.each([
    ['posecode dance "X"\n  rig humanoid', /movement kind/i],
    ['posecode posture "X"\n  rig robot', /unknown rig/i],
    ['posecode posture "X"\n  pose start = crouching', /unknown start pose/i],
    ['posecode posture "X"\n  prop sword', /unknown prop/i],
  ])("rejects declarations outside the protocol: %s", (source, message) => {
    const result = parse(source);
    expect(result.ir).toBeNull();
    expect(result.errors.some((error) => message.test(error.message))).toBe(true);
  });

  it("accepts exactly `hold neutral` and marks all channels explicit", () => {
    const result = parse(doc("wrist_left: hold neutral"));
    expect(result.errors).toEqual([]);
    expect(result.ir?.phases[0]?.targets[0]?.axes).toEqual(["x", "y", "z"]);
  });

  it("rejects the legacy trailing zero instead of silently ignoring it", () => {
    const result = parse(doc("wrist_left: hold neutral 0"));
    expect(result.ir).toBeNull();
    expect(result.errors[0]?.message).toContain("no trailing angle");
  });

  it("rejects surplus tokens on top-level and phase directives", () => {
    expect(parse('posecode posture "X" extra').ir).toBeNull();
    expect(parse('posecode posture "X"\n  rig humanoid extra').ir).toBeNull();
    expect(parse(doc("cue \"one\" extra")).ir).toBeNull();
  });

  it("requires at least one movement step", () => {
    const result = parse('posecode posture "Empty"\n  rig humanoid');
    expect(result.ir).toBeNull();
    expect(result.errors[0]?.message).toMatch(/at least one step/i);
  });
});

describe("indentation grammar", () => {
  it("rejects an unindented joint instead of attaching it to the preceding step", () => {
    const result = parse([
      'posecode posture "Indent"',
      "  rig humanoid",
      '  step "Pose" 1s linear:',
      "hip_left: flex 30",
    ].join("\n"));
    expect(result.ir).toBeNull();
    expect(result.errors[0]?.message).toMatch(/step children must be indented/i);
  });

  it("rejects a top-level directive nested inside a step", () => {
    const result = parse([
      'posecode posture "Indent"',
      "  rig humanoid",
      '  step "Pose" 1s linear:',
      "    hips: flex 30",
      "    repeat 8",
    ].join("\n"));
    expect(result.ir).toBeNull();
    expect(result.errors[0]?.message).toMatch(/document indentation level/i);
  });

  it("rejects inconsistent child indentation", () => {
    const result = parse([
      'posecode posture "Indent"',
      "  rig humanoid",
      '  step "Pose" 1s linear:',
      "    hips: flex 30",
      "      knees: flex 40",
    ].join("\n"));
    expect(result.ir).toBeNull();
    expect(result.errors[0]?.message).toMatch(/one indentation level/i);
  });

  it("requires scoped start-pose overrides to be indented consistently", () => {
    const result = parse([
      'posecode posture "Indent"',
      "  rig humanoid",
      "  pose start = standing:",
      "    shoulders: flex 20",
      "      elbows: flex 30",
      '  step "Hold" 1s linear:',
      "    spine: hold neutral",
    ].join("\n"));
    expect(result.ir).toBeNull();
    expect(result.errors[0]?.message).toMatch(/start-pose overrides.*one indentation level/i);
  });
});

describe("joint/action compatibility", () => {
  it("errors instead of applying an unsupported action without a ROM", () => {
    const result = parse(doc("knee_left: abduct 20"));
    expect(result.ir).toBeNull();
    expect(result.errors).toEqual([
      expect.objectContaining({ line: 4, message: expect.stringMatching(/not supported.*knee_left/i) }),
    ]);
  });

  it("enforces conservative upper-cervical head ROM", () => {
    const result = parse(doc("head: flex 50"));
    expect(result.errors).toEqual([]);
    expect(result.warnings[0]).toEqual(expect.objectContaining({ clamped: 25 }));
    expect(result.ir?.phases[0]?.targets[0]?.euler.x).toBe(25);
  });

  it("supports bounded wrist radial and ulnar deviation", () => {
    const result = parse(doc("wrist_left: abduct 30", "wrist_right: adduct 25"));
    expect(result.errors).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toEqual(expect.objectContaining({ clamped: 20 }));
  });

  it("supports explicit left/right axial twist while accepting the legacy alias", () => {
    const result = parse(doc("chest: twist-left 20", "neck: rotate-out 15"));
    expect(result.errors).toEqual([]);
    expect(result.ir?.phases[0]?.targets.find((t) => t.boneId === "chest")?.euler.y).toBe(20);
    expect(result.ir?.phases[0]?.targets.find((t) => t.boneId === "neck")?.euler.y).toBe(-15);
  });
});

describe("contact namespace", () => {
  it("accepts floor, body landmarks, declared props, fists, and knees", () => {
    const source = [
      'posecode posture "Landing"',
      "  rig humanoid",
      "  prop bar",
      '  step "Land" 1s settle:',
      "    reach: fists floor",
      "    pin: knees floor",
      "    reach: hand_left knee_left",
      "    reach: hand_right bar",
    ].join("\n");
    const result = parse(source);
    expect(result.errors).toEqual([]);
    expect(result.ir?.phases[0]?.reaches).toEqual(expect.arrayContaining([
      { effector: "fist_left", target: "floor" },
      { effector: "fist_right", target: "floor" },
    ]));
    expect(result.ir?.phases[0]?.pins).toEqual([
      { effector: "knee_left", anchor: "floor" },
      { effector: "knee_right", anchor: "floor" },
    ]);
  });

  it("requires prop anchors to be declared", () => {
    const result = parse(doc("reach: hand_left bar"));
    expect(result.ir).toBeNull();
    expect(result.errors[0]?.message).toMatch(/requires declared prop "bar"/i);
  });

  it("keeps pelvis as a pin-only effector", () => {
    const result = parse(doc("reach: pelvis floor"));
    expect(result.ir).toBeNull();
    expect(result.errors[0]).toEqual(expect.objectContaining({
      line: 4,
      message: expect.stringMatching(/pelvis.*unsupported.*pin/i),
    }));
    expect(parse(doc("pin: pelvis floor")).errors).toEqual([]);
  });

  it("rejects unknown anchors and non-hand grips", () => {
    expect(parse(doc("pin: foot_left moon")).errors[0]?.message).toMatch(/unknown pin anchor/i);
    expect(parse(doc("grip: fists floor")).errors[0]?.message).toMatch(/must resolve to a hand/i);
  });

  it("keeps reach, pin, and grip target namespaces semantically distinct", () => {
    expect(parse(doc("pin: hand_left knee_left")).errors[0]?.message).toMatch(/body-relative/i);
    expect(parse(doc("grip: hands floor")).errors[0]?.message).toMatch(/bar.*dip-rail/i);
    expect(parse(doc("grip: hands knee_left")).errors[0]?.message).toMatch(/bar.*dip-rail/i);
  });

  it("rejects collapsed or crossed sided grip anchors", () => {
    const grouped = [
      'posecode exercise "Grip"',
      "  rig humanoid",
      "  prop bar",
      '  step "Hold" 1s settle:',
      "    grip: hands bar_left",
    ].join("\n");
    expect(parse(grouped).errors[0]?.message).toMatch(/grouped grip.*bare anchor/i);
    const crossed = grouped.replace("hands bar_left", "hand_right bar_left");
    expect(parse(crossed).errors[0]?.message).toMatch(/does not match/i);
  });

  it("expands a valid grouped grip onto distinct declared side anchors", () => {
    const source = [
      'posecode exercise "Grip"',
      "  rig humanoid",
      "  prop bar",
      '  step "Hold" 1s settle:',
      "    grip: hands bar",
    ].join("\n");
    const result = parse(source);
    expect(result.errors).toEqual([]);
    expect(result.ir?.phases[0]?.grips).toEqual([
      { effector: "hand_left", anchor: "bar_left" },
      { effector: "hand_right", anchor: "bar_right" },
    ]);
  });

  it("rejects competing whole-root contact solvers in one step", () => {
    const result = parse(doc("pin: knee_left floor", "ground-lock: foot_right"));
    expect(result.ir).toBeNull();
    expect(result.errors[0]?.message).toMatch(/pin.*cannot be combined.*ground-lock/i);
  });

  it("rejects multiple raw pins and self-referential reaches", () => {
    expect(parse(doc("pin: pelvis floor", "pin: feet floor")).errors[0]?.message)
      .toMatch(/only one primary.*pin/i);
    expect(parse(doc("reach: hand_left wrist_left")).errors[0]?.message)
      .toMatch(/cannot target its own joint/i);
    expect(parse(doc("reach: knee_left knee_left")).errors[0]?.message)
      .toMatch(/cannot target its own joint/i);
  });
});

describe("sparse channels and coupled hip mechanics", () => {
  it("records only the axis authored by each phase", () => {
    const source = [
      'posecode exercise "Curl"',
      "  rig humanoid",
      '  step "Curl" 1s flow:',
      "    elbow_left: flex 70",
      '  step "Turn palm" 1s settle:',
      "    elbow_left: pronate 40",
    ].join("\n");
    const result = parse(source);
    expect(result.errors).toEqual([]);
    expect(result.ir?.phases[0]?.targets[0]?.axes).toEqual(["x"]);
    expect(result.ir?.phases[1]?.targets[0]?.axes).toEqual(["y"]);
  });

  it("clamps same-phase hinge plus hip flexion to 135 degrees local", () => {
    const result = parse(doc("pelvis: hinge 50", "hips: flex 110"));
    expect(result.errors).toEqual([]);
    const hips = result.ir?.phases[0]?.targets.filter((target) => target.boneId.startsWith("hip_"));
    expect(hips?.map((target) => target.euler.x)).toEqual([-85, -85]);
    expect(result.warnings.filter((warning) => warning.joint.startsWith("hip_"))).toHaveLength(2);
  });

  it("clamps a later hinge against carried hip flexion", () => {
    const source = [
      'posecode posture "Fold"',
      "  rig humanoid",
      '  step "Lift knee" 1s flow:',
      "    hips: flex 110",
      '  step "Hinge" 1s settle:',
      "    pelvis: hinge 50",
    ].join("\n");
    const result = parse(source);
    expect(result.errors).toEqual([]);
    expect(result.ir?.phases[1]?.targets[0]?.euler.x).toBe(25);
    expect(result.warnings).toContainEqual(expect.objectContaining({ joint: "pelvis", clamped: 25 }));
  });

  it("accounts for hip flexion in the seated base pose", () => {
    const source = [
      'posecode posture "Seated fold"',
      "  rig humanoid",
      "  pose start = seated",
      '  step "Fold" 1s settle:',
      "    pelvis: hinge 60",
    ].join("\n");
    const result = parse(source);
    expect(result.errors).toEqual([]);
    expect(result.ir?.phases[0]?.targets[0]?.euler.x).toBe(45);
  });

  it("reduces a new hinge before touching a same-step hip when the opposite hip is carried", () => {
    const source = [
      'posecode posture "Asymmetric fold"',
      "  rig humanoid",
      '  step "Carry left" 1s flow:',
      "    hip_left: flex 110",
      '  step "Add hinge and right" 1s settle:',
      "    pelvis: hinge 50",
      "    hip_right: flex 110",
    ].join("\n");
    const result = parse(source);
    expect(result.errors).toEqual([]);
    const phase = result.ir?.phases[1];
    expect(phase?.targets.find((target) => target.boneId === "pelvis")?.euler.x).toBe(25);
    expect(phase?.targets.find((target) => target.boneId === "hip_right")?.euler.x).toBe(-110);
    expect(result.warnings).toContainEqual(expect.objectContaining({ joint: "pelvis", clamped: 25 }));
    expect(result.warnings.some((warning) => warning.joint === "hip_right")).toBe(false);
  });
});
