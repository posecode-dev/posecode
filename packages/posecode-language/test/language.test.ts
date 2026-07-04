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
    const clean = 'posecode posture "P"\n  rig humanoid\n  pose start = standing';
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
    expect(l).toEqual(expect.arrayContaining(["knees", "elbows"]));
    expect(l).toContain("cue");
  });

  it("suggests actions after `<joint>: `", () => {
    expect(onLine("    knees: ", 11)).toEqual(
      expect.arrayContaining(["flex", "extend"]),
    );
  });

  it("suggests easings inside a step header", () => {
    expect(onLine('  step "y" 2s ', 14)).toEqual(
      expect.arrayContaining(["ease-in", "linear"]),
    );
  });

  it("suggests start poses after `pose start = `", () => {
    expect(onLine("  pose start = ", 15)).toContain("standing");
  });

  it("suggests effectors after `ground-lock: `", () => {
    expect(onLine("    ground-lock: ", 17)).toEqual(
      expect.arrayContaining(["hands", "feet"]),
    );
  });

  it("suggests reach effectors (groups + sides) after `reach: ` and `pin: `", () => {
    expect(onLine("    reach: ", 11)).toEqual(
      expect.arrayContaining(["hands", "hand_left", "foot_right"]),
    );
    expect(onLine("    pin: ", 9)).toEqual(expect.arrayContaining(["feet"]));
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
