import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { probeMovement } from "../src/index.js";

const examplesDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../spec/examples",
);
const load = (name: string): string =>
  readFileSync(resolve(examplesDir, `${name}.posecode`), "utf8");

const footWarnings = (name: string) =>
  probeMovement(load(name)).diagnostics.warnings.filter((w) =>
    ["heel-height", "toe-height", "sole-angle", "grounding-rom-conflict"].includes(w.kind),
  );

/**
 * A stance foot in a traveling clip rolls onto its ball as the body passes
 * (push-off) and is briefly airborne at each step transition — correct gait,
 * not a grounding artifact, so it is exempt from the static flat-foot checks.
 * A static clip keeps the strict bar, so genuine heel-lift must still surface.
 */
describe("locomotion grounding exemption", () => {
  it("exempts a locomotion stance foot's airborne swing (no large float at a step transition)", () => {
    // Before the fix, box-step's stance pin was measured while it was still
    // descending from the previous phase's swing — a ~0.12m heel float and a
    // ~33° sole tilt mid-transition. The airborne-swing exemption removes those
    // large phase-transition floats (a smaller settling roll may remain).
    const large = footWarnings("box-step").filter(
      (w) =>
        (w.kind === "heel-height" && w.value > 0.1) ||
        (w.kind === "sole-angle" && w.value > 30),
    );
    expect(large, large.map((w) => w.detail).join("\n")).toHaveLength(0);
  });

  it("still flags genuine heel-lift in a static deep pose (no over-suppression)", () => {
    // superhero-landing holds a deep static landing whose shin exceeds the ankle
    // dorsiflexion ROM; that heel-lift is a real artifact and must stay flagged.
    const warns = footWarnings("superhero-landing");
    expect(warns.some((w) => w.kind === "grounding-rom-conflict" || w.kind === "heel-height")).toBe(
      true,
    );
  });
});
