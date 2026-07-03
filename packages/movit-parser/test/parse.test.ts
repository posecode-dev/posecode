import { describe, it, expect } from "vitest";
import { parse } from "../src/index.js";

const PUSHUP = [
  'movit exercise "Push-up"',
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
    expect(lower.easing).toBe("ease-in");
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
      'movit exercise "Bad knee"',
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
      'movit posture "Neutral stance"',
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
      'movit exercise "Typo"',
      "  rig humanoid",
      '  step "Move" 1s linear:',
      "    elbwos: flex 90",
    ].join("\n");
    const { errors } = parse(src);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]!.line).toBe(4);
    expect(errors[0]!.message).toMatch(/unknown joint/i);
  });

  it("reports an error when a step child has no enclosing step", () => {
    const src = [
      'movit exercise "Orphan"',
      "  rig humanoid",
      "  elbows: flex 90",
    ].join("\n");
    const { errors } = parse(src);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]!.message).toMatch(/outside.*step|no.*step/i);
  });

  it("requires a movit header", () => {
    const { errors, ir } = parse('rig humanoid\nstep "x" 1s linear:');
    expect(ir).toBeNull();
    expect(errors[0]!.message).toMatch(/header|must start/i);
  });

  it("resolves torso flexion forward, matching the limbs (positive x)", () => {
    // Torso bones' children sit at +Y offsets (limbs at -Y), so torso flexion
    // needs the opposite euler sign to bend the same world direction (+Z).
    const src = [
      'movit stretch "Fold"',
      "  rig humanoid",
      '  step "Bend" 1s linear:',
      "    spine: flex 45",
      "    neck: flex 20",
    ].join("\n");
    const { ir, errors } = parse(src);
    expect(errors).toEqual([]);
    const targets = ir!.phases[0]!.targets;
    expect(targets.find((t) => t.boneId === "spine")!.euler.x).toBe(45);
    expect(targets.find((t) => t.boneId === "neck")!.euler.x).toBe(20);
  });

  it("resolves a hip hinge into pelvis rotation + hip counter-rotation", () => {
    const src = [
      'movit exercise "Deadlift"',
      "  rig humanoid",
      '  step "Hinge" 2s ease-in-out:',
      "    hips: hinge 70",
      "    knees: flex 20",
      "    ground-lock: feet",
    ].join("\n");
    const { ir, errors, warnings } = parse(src);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
    const targets = ir!.phases[0]!.targets;
    // Pelvis tips the torso forward (+x); both hips counter-rotate so the
    // legs stay vertical in world space.
    expect(targets.find((t) => t.boneId === "pelvis")!.euler.x).toBe(70);
    expect(targets.find((t) => t.boneId === "hip_left")!.euler.x).toBe(-70);
    expect(targets.find((t) => t.boneId === "hip_right")!.euler.x).toBe(-70);
    // Explicit knee targets are untouched by the hinge.
    expect(targets.find((t) => t.boneId === "knee_left")!.euler.x).toBe(20);
  });

  it("clamps a hinge beyond hip flexion ROM and records warnings", () => {
    const src = [
      'movit exercise "Overfold"',
      "  rig humanoid",
      '  step "Hinge" 1s linear:',
      "    hips: hinge 170",
    ].join("\n");
    const { ir, warnings } = parse(src);
    expect(warnings).toHaveLength(2); // hip_left + hip_right
    expect(warnings[0]!.action).toBe("hinge");
    expect(warnings[0]!.clamped).toBe(135);
    const targets = ir!.phases[0]!.targets;
    expect(targets.find((t) => t.boneId === "pelvis")!.euler.x).toBe(135);
    expect(targets.find((t) => t.boneId === "hip_left")!.euler.x).toBe(-135);
  });

  it("rejects hinge on joints other than hips", () => {
    const src = [
      'movit exercise "Bad hinge"',
      "  rig humanoid",
      '  step "Move" 1s linear:',
      "    knees: hinge 30",
    ].join("\n");
    const { errors } = parse(src);
    expect(errors.some((e) => /hinge.*hips/i.test(e.message))).toBe(true);
  });

  it("requires an angle for hinge", () => {
    const src = [
      'movit exercise "No angle"',
      "  rig humanoid",
      '  step "Move" 1s linear:',
      "    hips: hinge",
    ].join("\n");
    const { errors } = parse(src);
    expect(errors.some((e) => /angle/i.test(e.message))).toBe(true);
  });

  it("rejects an unknown easing", () => {
    const src = [
      'movit exercise "Bad easing"',
      "  rig humanoid",
      '  step "Move" 1s wobble:',
      "    elbows: flex 90",
    ].join("\n");
    const { errors } = parse(src);
    expect(errors.some((e) => /easing/i.test(e.message))).toBe(true);
  });
});
