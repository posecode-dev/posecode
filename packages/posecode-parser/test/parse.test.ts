import { describe, it, expect } from "vitest";
import { parse, normalizeMode, MODES } from "../src/index.js";

const PUSHUP = [
  'posecode exercise "Push-up"',
  "  rig humanoid",
  "  pose start = plank",
  "",
  '  step "Lower" 2s ease-in:',
  "    elbows: flex 90",
  "    shoulders: abduct 45",
  "    spine: hold neutral",
  "    ground-lock: hands, feet",
  '    cue "Elbows ~45 from torso"',
  "",
  '  step "Press" 1s ease-out:',
  "    elbows: extend 0",
  "",
  "  repeat 10",
].join("\n");

describe("parse", () => {
  it("parses a well-formed push-up with no errors", () => {
    const { ir, errors, warnings } = parse(PUSHUP);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
    expect(ir).not.toBeNull();
    expect(ir!.name).toBe("Push-up");
    expect(ir!.kind).toBe("exercise");
    expect(ir!.rig).toBe("humanoid");
    expect(ir!.startPose).toBe("plank");
    expect(ir!.repeat).toBe(10);
    expect(ir!.phases).toHaveLength(2);
  });

  it("expands symmetric joints and resolves rotation axes", () => {
    const { ir } = parse(PUSHUP);
    const lower = ir!.phases[0]!;
    expect(lower.name).toBe("Lower");
    expect(lower.durationSec).toBe(2);
    expect(lower.easing).toBe("drive"); // legacy `ease-in` normalizes to canonical mode
    expect(lower.cue).toBe("Elbows ~45 from torso");
    expect(lower.groundLock.sort()).toEqual(["feet", "hands"]);

    const bones = lower.targets.map((t) => t.boneId).sort();
    expect(bones).toContain("elbow_left");
    expect(bones).toContain("elbow_right");
    expect(bones).toContain("shoulder_left");
    expect(bones).toContain("shoulder_right");

    const elbowL = lower.targets.find((t) => t.boneId === "elbow_left")!;
    // flex maps to the X axis; non-knee joints flex toward -X (anatomically
    // forward/up). 90 degrees requested, within ROM.
    expect(elbowL.euler.x).toBe(-90);
  });

  it("clamps out-of-range angles and records a warning", () => {
    const src = [
      'posecode exercise "Bad knee"',
      "  rig humanoid",
      '  step "Fold" 1s linear:',
      "    knees: flex 200",
    ].join("\n");
    const { ir, warnings } = parse(src);
    expect(warnings).toHaveLength(2); // knee_left + knee_right
    const w = warnings[0]!;
    expect(w.requested).toBe(200);
    expect(w.clamped).toBe(144);
    expect(w.limit.max).toBe(144);
    const kneeL = ir!.phases[0]!.targets.find((t) => t.boneId === "knee_left")!;
    expect(kneeL.euler.x).toBe(144);
  });

  it("defaults repeat to 1 when omitted", () => {
    const src = [
      'posecode posture "Neutral stance"',
      "  rig humanoid",
      '  step "Hold" 3s linear:',
      "    spine: hold neutral",
    ].join("\n");
    const { ir, errors } = parse(src);
    expect(errors).toEqual([]);
    expect(ir!.repeat).toBe(1);
    expect(ir!.kind).toBe("posture");
  });

  it("reports a structured error for an unknown joint", () => {
    const src = [
      'posecode exercise "Typo"',
      "  rig humanoid",
      '  step "Move" 1s linear:',
      "    elbwos: flex 90",
    ].join("\n");
    const { errors } = parse(src);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]!.line).toBe(4);
    expect(errors[0]!.message).toMatch(/unknown joint/i);
  });

  it("accepts per-side ground-lock effectors", () => {
    const src = [
      'posecode exercise "Single-leg pivot"',
      "  rig humanoid",
      '  step "Turn" 1s linear:',
      "    turn: 180",
      "    ground-lock: foot_right",
    ].join("\n");
    const { ir, errors } = parse(src);
    expect(errors).toEqual([]);
    expect(ir!.phases[0]!.groundLock).toEqual(["foot_right"]);
  });

  it("reports a line-anchored error for an unsupported ground-lock effector", () => {
    const src = [
      'posecode exercise "Typo"',
      "  rig humanoid",
      '  step "Turn" 1s linear:',
      "    turn: 180",
      "    ground-lock: shoe_right",
    ].join("\n");
    const { ir, errors } = parse(src);
    expect(ir).toBeNull();
    expect(errors).toEqual([
      { line: 5, message: 'unknown ground-lock effector: "shoe_right"' },
    ]);
  });

  it("reports an error when a step child has no enclosing step", () => {
    const src = [
      'posecode exercise "Orphan"',
      "  rig humanoid",
      "  elbows: flex 90",
    ].join("\n");
    const { errors } = parse(src);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]!.message).toMatch(/outside.*step|no.*step/i);
  });

  it("requires a posecode header", () => {
    const { errors, ir } = parse('rig humanoid\nstep "x" 1s linear:');
    expect(ir).toBeNull();
    expect(errors[0]!.message).toMatch(/header|must start/i);
  });

  it("rejects an unknown timing mode", () => {
    const src = [
      'posecode exercise "Bad mode"',
      "  rig humanoid",
      '  step "Move" 1s wobble:',
      "    elbows: flex 90",
    ].join("\n");
    const { errors } = parse(src);
    expect(errors.some((e) => /mode/i.test(e.message))).toBe(true);
  });

  it("parses turn and travel into the phase IR", () => {
    const src = [
      'posecode exercise "Spin & step"',
      "  rig humanoid",
      "  pose start = standing",
      '  step "Spin" 1s ease-in-out:',
      "    turn: 360",
      "    travel: -0.4 0.5",
      "    ground-lock: feet",
      "  repeat 2",
    ].join("\n");
    const { ir, errors, warnings } = parse(src);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
    const phase = ir!.phases[0]!;
    expect(phase.turnDeg).toBe(360);
    expect(phase.travel).toEqual({ x: -0.4, z: 0.5 });
  });

  it("clamps travel to the studio footprint", () => {
    const src = [
      'posecode exercise "Runaway"',
      "  rig humanoid",
      '  step "Go" 1s linear:',
      "    travel: 99 -99",
    ].join("\n");
    const { ir } = parse(src);
    expect(ir!.phases[0]!.travel).toEqual({ x: 3, z: -3 });
  });

  it("errors on malformed turn/travel", () => {
    const src = [
      'posecode exercise "Bad"',
      "  rig humanoid",
      '  step "Go" 1s linear:',
      "    travel: 0.4",
    ].join("\n");
    const { errors } = parse(src);
    expect(errors.some((e) => /travel/i.test(e.message))).toBe(true);
  });
});

describe("reach/pin effectors", () => {
  it("expands forearms into the two elbow support points", () => {
    const src = `posecode posture "Forearm plank"
  rig humanoid
  pose start = plank
  step "Hold" 1s linear:
    pin: forearms floor`;
    const result = parse(src);
    expect(result.errors).toEqual([]);
    expect(result.ir?.phases[0]?.pins).toEqual([
      { effector: "elbow_left", anchor: "floor" },
      { effector: "elbow_right", anchor: "floor" },
    ]);
  });

  it("accepts the pelvis as an axial contact pin", () => {
    const src = `posecode stretch "Cobra"
  rig humanoid
  pose start = prone
  step "Lift" 1s ease-in-out:
    pin: pelvis floor`;
    const result = parse(src);
    expect(result.errors).toEqual([]);
    expect(result.ir?.phases[0]?.pins).toEqual([{ effector: "pelvis", anchor: "floor" }]);
  });

  it("expands `hands` / `feet` into per-side effectors", () => {
    const { ir, errors } = parse(
      [
        'posecode stretch "Fold"',
        "  rig humanoid",
        "  pose start = standing",
        "  prop box",
        '  step "Fold" 2s ease-in-out:',
        "    pelvis: hinge 90",
        "    reach: hands floor",
        "    pin: feet box",
        "  repeat 1",
      ].join("\n"),
    );
    expect(errors).toEqual([]);
    expect(ir!.phases[0]!.reaches).toEqual([
      { effector: "hand_left", target: "floor" },
      { effector: "hand_right", target: "floor" },
    ]);
    expect(ir!.phases[0]!.pins).toEqual([
      { effector: "foot_left", anchor: "box" },
      { effector: "foot_right", anchor: "box" },
    ]);
  });

  it("rejects an unknown effector with a line-anchored error", () => {
    const { ir, errors } = parse(
      [
        'posecode stretch "Typo"',
        "  rig humanoid",
        '  step "Reach" 1s linear:',
        "    reach: tentacle floor",
        "  repeat 1",
      ].join("\n"),
    );
    expect(ir).toBeNull();
    expect(errors).toHaveLength(1);
    expect(errors[0]!.line).toBe(4);
    expect(errors[0]!.message).toContain("tentacle");
  });
});

describe("clip directive", () => {
  const doc = (clipLine: string): string =>
    [
      'posecode exercise "Walk"',
      "  rig humanoid",
      "  pose start = standing",
      clipLine,
      '  step "Step" 1s linear:',
      "    hips: flex 20",
      "  repeat 1",
    ].join("\n");

  it("parses a document-level clip name into the IR", () => {
    const { ir, errors } = parse(doc('  clip "walk"'));
    expect(errors).toEqual([]);
    expect(ir!.clip).toBe("walk");
  });

  it("omits clip from the IR when the directive is absent", () => {
    const { ir, errors } = parse(doc(""));
    expect(errors).toEqual([]);
    expect(ir!.clip).toBeUndefined();
  });

  it("rejects a clip directive without a quoted name", () => {
    const { ir, errors } = parse(doc("  clip walk"));
    expect(ir).toBeNull();
    expect(errors).toHaveLength(1);
    expect(errors[0]!.line).toBe(4);
    expect(errors[0]!.message).toContain("clip");
  });
});

describe("timing modes", () => {
  it("accepts the canonical modes", () => {
    for (const m of MODES) {
      const src = `posecode exercise "x"\n  rig humanoid\n  step "s" 1s ${m}:\n    knees: flex 10\n`;
      const { errors } = parse(src);
      expect(errors).toEqual([]);
    }
  });

  it("normalizes legacy easing names to canonical modes", () => {
    expect(normalizeMode("ease-in")).toEqual({ mode: "drive", legacy: true });
    expect(normalizeMode("ease-out")).toEqual({ mode: "settle", legacy: true });
    expect(normalizeMode("ease-in-out")).toEqual({ mode: "settle", legacy: true });
    expect(normalizeMode("linear")).toEqual({ mode: "linear", legacy: false });
    expect(normalizeMode("flow")).toEqual({ mode: "flow", legacy: false });
    expect(normalizeMode("bogus")).toEqual({ mode: null, legacy: false });
  });

  it("legacy documents still parse and carry a canonical mode", () => {
    const src =
      `posecode exercise "sq"\n  rig humanoid\n  step "Descend" 1s ease-in-out:\n    knees: flex 90\n`;
    const { ir, errors } = parse(src);
    expect(errors).toEqual([]);
    expect(ir?.phases[0]?.easing).toBe("settle");
  });

  it("rejects an unknown mode with a clear error", () => {
    const src = `posecode exercise "x"\n  rig humanoid\n  step "s" 1s wobble:\n    knees: flex 10\n`;
    const { errors } = parse(src);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]!.message.toLowerCase()).toContain("mode");
  });
});

describe("grip directive", () => {
  it("resolves `grip: hands bar` to two per-side grips with sided anchors", () => {
    const src = [
      'posecode exercise "Pull-up"',
      "  rig humanoid",
      "  prop bar",
      "  pose start = standing",
      '  step "Hang" 1s flow:',
      "    grip: hands bar",
    ].join("\n");
    const { ir, errors } = parse(src);
    expect(errors).toEqual([]);
    expect(ir!.phases[0]!.grips).toEqual([
      { effector: "hand_left", anchor: "bar_left" },
      { effector: "hand_right", anchor: "bar_right" },
    ]);
  });

  it("keeps a side-specific grip anchor verbatim", () => {
    const src = [
      'posecode exercise "One-arm"',
      "  rig humanoid",
      "  prop bar",
      '  step "Hang" 1s flow:',
      "    grip: hand_left bar_left",
    ].join("\n");
    const { ir, errors } = parse(src);
    expect(errors).toEqual([]);
    expect(ir!.phases[0]!.grips).toEqual([{ effector: "hand_left", anchor: "bar_left" }]);
  });

  it("errors on an unknown grip effector with its line", () => {
    const src = [
      'posecode exercise "Bad"',
      "  rig humanoid",
      '  step "Hang" 1s flow:',
      "    grip: tentacle bar",
    ].join("\n");
    const { errors } = parse(src);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]!.line).toBe(4);
    expect(errors[0]!.message).toContain("tentacle");
  });
});
