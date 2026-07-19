import { describe, it, expect } from "vitest";
import {
  getDiagnostics,
  getCompletions,
  getHover,
  KINDS,
} from "../src/index.js";

const DOC = [
  'posecode exercise "Test"', // line 0
  "  rig humanoid", // 1
  "  pose start = standing", // 2
  '  step "Lower" 2s ease-in:', // 3
  "    knees: flex 200", // 4  -> ROM clamp (knee flex max 144)
  '    cue "go"', // 5
  "  repeat 3", // 6
].join("\n");

describe("getDiagnostics", () => {
  it("flags a ROM clamp as a warning on the offending line", () => {
    const warn = getDiagnostics(DOC).find((d) => d.severity === "warning");
    expect(warn?.line).toBe(5); // 1-based source line of `knees: flex 200`
    expect(warn?.message).toContain("144");
  });

  it("collapses left/right of a joint group into one warning", () => {
    const warnings = getDiagnostics(DOC).filter((d) => d.severity === "warning");
    expect(warnings).toHaveLength(1); // knees -> one diagnostic, not knee_left + knee_right
  });

  it("flags a parse error with error severity", () => {
    const d = getDiagnostics('posecode exercise "X"\n  step nonsense');
    expect(d.some((x) => x.severity === "error")).toBe(true);
  });

  it("returns nothing for a clean document", () => {
    const clean = [
      'posecode posture "P"',
      "  rig humanoid",
      "  pose start = standing",
      '  step "Hold" 1s linear:',
      "    pelvis: hold neutral",
    ].join("\n");
    expect(getDiagnostics(clean)).toEqual([]);
  });
});

describe("getCompletions", () => {
  // Most completions happen on a non-header line, so prepend a header and put
  // the line under test at index 1 (character offsets are within that line).
  const onLine = (lineText: string, ch: number) =>
    getCompletions(`posecode exercise "x"\n${lineText}`, 1, ch).map((c) => c.label);

  it("suggests movement kinds right after `posecode `", () => {
    expect(getCompletions("posecode ", 0, 9).map((c) => c.label)).toEqual(
      expect.arrayContaining(KINDS),
    );
  });

  it("suggests joints (and child keywords) at the start of an indented line", () => {
    const l = onLine("    ", 4);
    expect(l).toEqual(expect.arrayContaining(["knees", "elbows", "forearms"]));
    expect(l).toContain("cue");
  });

  it("suggests document directives, not joints, at the two-space top level", () => {
    const l = onLine("  ", 2);
    expect(l).toEqual(expect.arrayContaining(["step", "repeat", "pose"]));
    expect(l).not.toContain("knees");
    expect(l).not.toContain("cue");
  });

  it("suggests actions after `<joint>: `", () => {
    const kneeActions = onLine("    knees: ", 11);
    expect(kneeActions).toEqual(expect.arrayContaining(["flex", "extend", "hold"]));
    expect(kneeActions).not.toContain("abduct");
    expect(kneeActions).not.toContain("rotate-in");
  });

  it("offers joint-specific wrist deviation and explicit axial twist", () => {
    expect(onLine("    wrist_left: ", 16)).toEqual(
      expect.arrayContaining(["flex", "extend", "abduct", "adduct"]),
    );
    const chestActions = onLine("    chest: ", 11);
    expect(chestActions).toEqual(expect.arrayContaining(["twist-left", "twist-right"]));
    expect(chestActions).not.toContain("rotate-in");
    expect(chestActions).not.toContain("rotate-out");
  });

  it("offers and explains anatomical forearm rotation", () => {
    expect(onLine("    forearms: ", 14)).toEqual(
      expect.arrayContaining(["pronate", "supinate"]),
    );
    const line = "    forearms: pronate 80";
    const hover = getHover(line, 0, line.indexOf("pronate") + 1);
    expect(hover?.contents).toContain("thigh");
  });

  it("suggests timing modes inside a step header", () => {
    expect(onLine('  step "y" 2s ', 14)).toEqual(
      expect.arrayContaining(["flow", "settle", "linear"]),
    );
  });

  it("suggests start poses after `pose start = `", () => {
    expect(onLine("  pose start = ", 15)).toContain("standing");
  });

  it("offers only joint targets inside a scoped start-pose override", () => {
    const text = [
      'posecode posture "Custom"',
      "  pose start = standing:",
      "    ",
    ].join("\n");
    const labels = getCompletions(text, 2, 4).map((item) => item.label);
    expect(labels).toEqual(expect.arrayContaining(["shoulders", "elbow_left", "hips"]));
    expect(labels).not.toEqual(expect.arrayContaining(["cue", "ground-lock", "reach"]));
  });

  it("offers joint-specific actions inside a scoped start-pose override", () => {
    const text = [
      'posecode posture "Custom"',
      "  pose start = standing:",
      "    knees: ",
    ].join("\n");
    const labels = getCompletions(text, 2, 11).map((item) => item.label);
    expect(labels).toEqual(expect.arrayContaining(["flex", "extend", "hold"]));
    expect(labels).not.toContain("abduct");
  });

  it("uses the actual scoped-header indentation for start-pose completions", () => {
    const jointText = [
      'posecode posture "Compact custom"',
      " pose start = standing:",
      "  ",
    ].join("\n");
    const joints = getCompletions(jointText, 2, 2).map((item) => item.label);
    expect(joints).toEqual(expect.arrayContaining(["shoulders", "elbow_left", "hips"]));
    expect(joints).not.toContain("ground-lock");

    const actionText = [
      'posecode posture "Compact custom"',
      " pose start = standing:",
      "  knees: ",
    ].join("\n");
    const actions = getCompletions(actionText, 2, 9).map((item) => item.label);
    expect(actions).toEqual(expect.arrayContaining(["flex", "extend", "hold"]));
    expect(actions).not.toContain("abduct");
  });

  it("does not scan through a later block into an earlier start-pose block", () => {
    const text = [
      'posecode posture "Two scopes"',
      " pose start = standing:",
      "  shoulders: flex 20",
      ' step "Move" 1s linear:',
      "  ",
    ].join("\n");
    const labels = getCompletions(text, 4, 2).map((item) => item.label);
    expect(labels).toEqual(expect.arrayContaining(["knees", "ground-lock", "cue"]));
  });

  it("does not complete document directives when they are nested inside a step", () => {
    const nestedPose = [
      'posecode posture "Nested"',
      ' step "Outer" 1s linear:',
      "  pose start = ",
    ].join("\n");
    expect(getCompletions(nestedPose, 2, 15).map((item) => item.label)).not.toContain("standing");

    const nestedStep = [
      'posecode posture "Nested"',
      ' step "Outer" 1s linear:',
      '  step "Inner" 1s ',
    ].join("\n");
    expect(getCompletions(nestedStep, 2, 19).map((item) => item.label)).not.toContain("flow");
  });

  it("reports ROM clamps in scoped start-pose overrides", () => {
    const text = [
      'posecode posture "Custom"',
      "  pose start = standing:",
      "    knees: flex 200",
      '  step "Hold" 1s linear:',
      "    spine: hold neutral",
    ].join("\n");
    expect(getDiagnostics(text)).toContainEqual(
      expect.objectContaining({ line: 3, severity: "warning", message: expect.stringContaining("144") }),
    );
  });

  it("suggests effectors after `ground-lock: `", () => {
    expect(onLine("    ground-lock: ", 17)).toEqual(
      expect.arrayContaining([
        "hands",
        "feet",
        "hand_left",
        "hand_right",
        "foot_left",
        "foot_right",
        "back",
      ]),
    );
  });

  it("suggests reach effectors (groups + sides) after `reach: ` and `pin: `", () => {
    expect(onLine("    reach: ", 11)).toEqual(
      expect.arrayContaining(["hands", "fists", "knees", "hand_left", "fist_right", "foot_right"]),
    );
    expect(onLine("    pin: ", 9)).toEqual(expect.arrayContaining(["feet"]));
    expect(onLine("    reach: ", 11)).not.toContain("pelvis");
    expect(onLine("    pin: ", 9)).toContain("pelvis");
    expect(onLine("    grip: ", 10)).toEqual(
      expect.arrayContaining(["hands", "hand_left", "hand_right"]),
    );
    expect(onLine("    grip: ", 10)).not.toContain("feet");
  });
});

describe("strict movement diagnostics", () => {
  it("reports unsupported joint/action combinations as errors", () => {
    const doc = [
      'posecode posture "Bad knee"',
      "  rig humanoid",
      '  step "Pose" 1s linear:',
      "    knee_left: abduct 20",
    ].join("\n");
    expect(getDiagnostics(doc)).toContainEqual(
      expect.objectContaining({ line: 4, severity: "error", message: expect.stringMatching(/not supported/i) }),
    );
  });

  it("nudges legacy axial rotation toward explicit direction", () => {
    const doc = [
      'posecode posture "Twist"',
      "  rig humanoid",
      '  step "Pose" 1s linear:',
      "    chest: rotate-out 20",
    ].join("\n");
    expect(getDiagnostics(doc)).toContainEqual(
      expect.objectContaining({ line: 4, severity: "hint", message: expect.stringContaining("twist-right") }),
    );
  });
});

describe("getHover", () => {
  it("shows the ROM ceiling when hovering an action", () => {
    const line = "    knees: flex 200";
    const h = getHover(line, 0, line.indexOf("flex") + 1);
    expect(h?.contents).toContain("144");
  });

  it("shows the bone expansion when hovering a joint group", () => {
    const line = "    knees: flex 90";
    const h = getHover(line, 0, line.indexOf("knees") + 1);
    expect(h?.contents.toLowerCase()).toContain("knee");
  });

  it("returns null over whitespace", () => {
    expect(getHover("    ", 0, 2)).toBeNull();
  });
});

describe("timing modes (L2)", () => {
  const modeDoc = ['posecode exercise "x"', "  rig humanoid", "  step \"A\" 1s "].join("\n");

  it("completes timing modes after a step duration", () => {
    const lineText = modeDoc.split("\n")[2]!;
    const got = getCompletions(modeDoc, 2, lineText.length).map((i) => i.label);
    expect(got).toEqual(
      expect.arrayContaining(["flow", "settle", "drive", "snap", "linear"]),
    );
  });

  it("hovers a mode", () => {
    const doc = 'posecode exercise "x"\n  rig humanoid\n  step "A" 1s flow:';
    const line = doc.split("\n")[2]!;
    const h = getHover(doc, 2, line.indexOf("flow") + 1);
    expect(h?.contents.toLowerCase()).toContain("flow");
  });

  it("flags a deprecated easing name with a hint", () => {
    const doc = [
      'posecode exercise "x"',
      "  rig humanoid",
      '  step "A" 1s ease-in-out:',
      "    knees: flex 10",
    ].join("\n");
    const diags = getDiagnostics(doc);
    const hint = diags.find((d) => d.severity === "hint");
    expect(hint?.message).toContain("settle");
  });
});

describe("grip directive (L3.2)", () => {
  it("offers grip as a step child keyword", () => {
    const doc = ['posecode exercise "x"', "  rig humanoid", '  step "Hang" 1s flow:', "    "].join("\n");
    const line = doc.split("\n")[3]!;
    const labels = getCompletions(doc, 3, line.length).map((i) => i.label);
    expect(labels).toContain("grip");
  });

  it("completes effectors after `grip:`", () => {
    const doc = ['posecode exercise "x"', "  rig humanoid", '  step "Hang" 1s flow:', "    grip: "].join("\n");
    const line = doc.split("\n")[3]!;
    const labels = getCompletions(doc, 3, line.length).map((i) => i.label);
    expect(labels).toContain("hands");
  });

  it("hovers grip with its doc", () => {
    const doc = ['posecode exercise "x"', "  rig humanoid", '  step "Hang" 1s flow:', "    grip: hands bar"].join("\n");
    const line = doc.split("\n")[3]!;
    const h = getHover(doc, 3, line.indexOf("grip") + 1);
    expect(h?.contents.toLowerCase()).toContain("bar");
  });
});
