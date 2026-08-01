import { describe, expect, it } from "vitest";
import {
  angleRangeFor,
  angleTargetAt,
  findAngleTargets,
  normalizeAngle,
  previewTimeForLine,
} from "../src/direct-manipulation.js";

describe("direct angle manipulation", () => {
  const source = [
    'posecode exercise "Curl"',
    "  rig humanoid",
    "  pose start = standing:",
    "    shoulders: abduct 12.5",
    '  step "Curl" 1s flow:',
    "    elbows: flex 90 # the editable target",
    "    turn: 45",
    "    wrists: hold neutral",
    "    knees: abduct 10",
    "    // shoulders: flex 30",
  ].join("\n");

  it("finds only complete, supported joint angle lines", () => {
    const targets = findAngleTargets(source);
    expect(targets.map(({ joint, action, degrees }) => ({ joint, action, degrees })))
      .toEqual([
        { joint: "shoulders", action: "abduct", degrees: 12.5 },
        { joint: "elbows", action: "flex", degrees: 90 },
      ]);
    for (const target of targets) {
      expect(source.slice(target.jointFrom, target.jointTo)).toBe(target.joint);
      expect(Number(source.slice(target.angleFrom, target.angleTo))).toBe(target.degrees);
    }
  });

  it("resolves clicks independently for joint names and angle values", () => {
    const target = findAngleTargets(source)[1]!;
    expect(angleTargetAt(source, target.jointFrom + 2, "joint")?.joint).toBe("elbows");
    expect(angleTargetAt(source, target.angleFrom, "angle")?.degrees).toBe(90);
    expect(angleTargetAt(source, target.angleTo + 1, "angle")).toBeNull();
  });

  it("uses the shared safe range for symmetric groups", () => {
    expect(angleRangeFor("elbows", "flex")).toEqual({ min: 0, max: 154 });
    expect(angleRangeFor("ankles", "flex")).toBeNull();
  });

  it("clamps spinner edits and keeps useful decimal precision", () => {
    const range = { min: 0, max: 154 };
    expect(normalizeAngle(80.04, range)).toBe("80");
    expect(normalizeAngle(80.06, range)).toBe("80.1");
    expect(normalizeAngle(999, range)).toBe("154");
  });

  it("previews the endpoint of the phase containing a direct angle edit", () => {
    const ranges = [
      { from: 5, to: 9 },
      { from: 11, to: 15 },
    ];
    const segments = [
      { start: 0, end: 0.5 },
      { start: 0.5, end: 0.85 },
    ];

    expect(previewTimeForLine(7, ranges, segments)).toBeCloseTo(0.499);
    expect(previewTimeForLine(13, ranges, segments)).toBeCloseTo(0.849);
    expect(previewTimeForLine(3, ranges, segments)).toBe(0);
    expect(previewTimeForLine(20, ranges, segments)).toBeNull();
  });
});
