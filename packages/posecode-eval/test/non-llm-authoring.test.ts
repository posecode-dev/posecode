import { describe, it, expect } from "vitest";
import { parse, romFor } from "posecode-parser";
import { probeMovement } from "../src/index.js";

describe("Non-LLM authoring & deterministic foundation (Issue #107)", () => {
  it("compiles and validates a programmatically constructed dance phrase without LLM involvement", () => {
    // Simulates an author assembling movements via visual blocks, presets, or code:
    const composedSteps = [
      { name: "First Position Demi-plié", dur: 1.5, knees: 45, ankles: 12, ground: "feet" },
      { name: "Rise to Elevé", dur: 1.5, knees: 0, ankles: -30, ground: "feet" }, // plantarflex 30
      { name: "Lower to First", dur: 1.5, knees: 0, ankles: 0, ground: "feet" },
    ];

    const lines = [
      'posecode exercise "Composed Ballet Drill"',
      "  rig humanoid",
      "  pose start = first-position",
      "",
    ];

    for (const step of composedSteps) {
      lines.push(`  step "${step.name}" ${step.dur}s settle:`);
      if (step.knees > 0) lines.push(`    knees: flex ${step.knees}`);
      else lines.push("    knees: extend 0");

      if (step.ankles > 0) lines.push(`    ankles: dorsiflex ${step.ankles}`);
      else if (step.ankles < 0) lines.push(`    ankles: plantarflex ${-step.ankles}`);
      else lines.push("    ankles: dorsiflex 0");

      lines.push(`    ground-lock: ${step.ground}`);
      lines.push("");
    }

    const doc = lines.join("\n");
    const { ir, errors, warnings } = parse(doc);

    expect(errors).toHaveLength(0);
    expect(warnings).toHaveLength(0);
    expect(ir?.phases).toHaveLength(3);

    const probe = probeMovement(doc);
    expect(probe.ok).toBe(true);
    expect(probe.phases).toHaveLength(3);
  });

  it("verifies that ROM limits protect direct-manipulation / slider inputs from invalid angles", () => {
    // If a user drags a 3D manipulation handle beyond anatomical limits (e.g. knee hyperextension):
    const kneeExtensionRom = romFor("knee_left", "extend");
    expect(kneeExtensionRom).toBeDefined();
    expect(kneeExtensionRom?.max).toBe(5); // maximum 5° hyperextension ceiling

    // Exceeding the clamp in direct text or slider produces an explicit warning
    const invalidDoc = [
      'posecode exercise "Overextended Knee"',
      "  rig humanoid",
      "  pose start = standing",
      '  step "Overextend" 1s linear:',
      "    knee_left: extend 45",
    ].join("\n");

    const { ir, warnings } = parse(invalidDoc);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]!.clamped).toBe(5);
    expect(ir?.phases[0]?.targets.find((t) => t.boneId === "knee_left")?.euler.x).toBe(-5);
  });
});
