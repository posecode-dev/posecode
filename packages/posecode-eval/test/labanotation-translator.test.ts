import { describe, it, expect } from "vitest";
import { parse } from "posecode-parser";
import {
  translateLabanToPosecode,
  type LabanScore,
} from "../src/index.js";

describe("Labanotation bounded translator (Issue #105)", () => {
  it("translates a static first-position stance fixture with zero warnings", () => {
    const score: LabanScore = {
      title: "Static First Position",
      tempoBpm: 60,
      startPose: "first-position",
      events: [
        {
          beat: 1,
          durationBeats: 2,
          name: "Hold First Position",
          supports: [{ side: "both", direction: "place", level: "middle" }],
        },
      ],
    };

    const result = translateLabanToPosecode(score);
    expect(result.diagnostics).toHaveLength(0);
    expect(result.lossyFeatureCount).toBe(0);
    expect(result.posecode).toContain("ground-lock: feet");
    expect(result.posecode).toContain("step \"Hold First Position\" 2.00s flow:");

    // Must parse cleanly as valid Posecode
    const parsed = parse(result.posecode);
    expect(parsed.errors).toHaveLength(0);
    expect(parsed.warnings).toHaveLength(0);
  });

  it("translates a grounded forward step with weight transfer and floor travel", () => {
    const score: LabanScore = {
      title: "Grounded Forward Step",
      tempoBpm: 60,
      events: [
        {
          beat: 1,
          durationBeats: 1,
          name: "Step Forward Left",
          supports: [{ side: "left", direction: "forward", level: "middle" }],
        },
        {
          beat: 2,
          durationBeats: 1,
          name: "Step Forward Right",
          supports: [{ side: "right", direction: "forward", level: "middle" }],
        },
      ],
    };

    const result = translateLabanToPosecode(score);
    expect(result.diagnostics).toHaveLength(0);
    expect(result.posecode).toContain("pin: foot_left floor");
    expect(result.posecode).toContain("pin: foot_right floor");
    expect(result.posecode).toContain("travel: 0.00 0.35");
    expect(result.posecode).toContain("travel: 0.00 0.70");

    const parsed = parse(result.posecode);
    expect(parsed.errors).toHaveLength(0);
    expect(parsed.warnings).toHaveLength(0);
  });

  it("translates a pivot turn onto a pinned support foot", () => {
    const score: LabanScore = {
      title: "Quarter Pivot Turn",
      tempoBpm: 120,
      events: [
        {
          beat: 1,
          durationBeats: 2,
          name: "Pivot 90 Clockwise",
          turn: {
            direction: "clockwise",
            degrees: 90,
            support: "left",
            durationBeats: 2,
          },
        },
      ],
    };

    const result = translateLabanToPosecode(score);
    expect(result.diagnostics).toHaveLength(0);
    expect(result.posecode).toContain("turn: 90");
    expect(result.posecode).toContain("pin: foot_left floor");
    expect(result.posecode).toContain("step \"Pivot 90 Clockwise\" 1.00s flow:");

    const parsed = parse(result.posecode);
    expect(parsed.errors).toHaveLength(0);
    expect(parsed.warnings).toHaveLength(0);
  });

  it("emits explicit diagnostics and comments when encountering lossy/unsupported Laban features", () => {
    const score: LabanScore = {
      title: "Complex Polyphonic Phrase",
      tempoBpm: 60,
      events: [
        {
          beat: 1,
          durationBeats: 2,
          name: "Asynchronous Port de Bras and Plié",
          supports: [{ side: "both", direction: "place", level: "low" }],
          unsupportedFeatures: [
            "fractional-weight-60-40",
            "asynchronous-limb-offset",
            "effort-flow-bound",
          ],
        },
      ],
    };

    const result = translateLabanToPosecode(score);
    // Explicit diagnostics instead of silent fabrication
    expect(result.diagnostics).toHaveLength(3);
    expect(result.lossyFeatureCount).toBe(3);
    expect(result.diagnostics[0]!.message).toContain("fractional-weight-60-40");
    expect(result.diagnostics[1]!.message).toContain("asynchronous-limb-offset");
    expect(result.diagnostics[2]!.message).toContain("effort-flow-bound");

    // Generates readable comments
    expect(result.posecode).toContain("[Lossy conversion] Labanotation feature omitted");

    // The generated approximated document must still parse validly
    const parsed = parse(result.posecode);
    expect(parsed.errors).toHaveLength(0);
  });
});
