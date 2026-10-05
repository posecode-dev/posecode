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

describe("ground-contact invariants and ROM conflict reporting", () => {
  it("reproduces the demi-plié heel lift under conservative ROM and flags explicit grounding-rom-conflict", () => {
    const plie = probeMovement(load("demi-plie"));

    // The demi-plié knee flexion (55°) exceeds 15° ankle dorsiflexion geometry,
    // so the heel must lift (> 20mm) and MUST NOT fail silently.
    expect(plie.diagnostics.feet.left.maxHeelHeightMeters).toBeGreaterThan(0.02);
    expect(plie.diagnostics.feet.right.maxHeelHeightMeters).toBeGreaterThan(0.02);

    // Explicit diagnostic generated
    const romConflict = plie.diagnostics.warnings.find(
      (w) => w.kind === "grounding-rom-conflict" && w.phaseName === "Plié",
    );
    expect(romConflict).toBeDefined();
    expect(romConflict?.detail).toMatch(/dorsiflexion limit/);
  });

  it("verifies that general movements (deadlift, squat) keep conservative ROM and pass plantigrade invariants", () => {
    for (const name of ["deadlift", "squat"]) {
      const probe = probeMovement(load(name));

      // Invariant 1: Heel height stays strictly within 5mm floor tolerance
      expect(probe.diagnostics.feet.left.maxHeelHeightMeters).toBeLessThan(0.005);
      expect(probe.diagnostics.feet.right.maxHeelHeightMeters).toBeLessThan(0.005);

      // Invariant 2: Toe height stays strictly within 5mm floor tolerance
      expect(probe.diagnostics.feet.left.maxToeHeightMeters).toBeLessThan(0.005);
      expect(probe.diagnostics.feet.right.maxToeHeightMeters).toBeLessThan(0.005);

      // Invariant 3: Sole tilt angle stays strictly within 12 degrees
      expect(probe.diagnostics.feet.left.maxSoleAngleDeg).toBeLessThan(12);
      expect(probe.diagnostics.feet.right.maxSoleAngleDeg).toBeLessThan(12);

      // Invariant 4: No grounding-rom-conflicts in standard movements
      const conflicts = probe.diagnostics.warnings.filter(
        (w) => w.kind === "grounding-rom-conflict",
      );
      expect(conflicts).toHaveLength(0);
    }
  });

  it("distinguishes plantigrade contact from intentional ball-of-foot contact", () => {
    const releve = probeMovement(load("releve"));
    // Relevé explicitly plantarflexes onto the balls of the feet
    // Toe stays grounded
    expect(releve.diagnostics.feet.left.maxToeHeightMeters).toBeLessThan(0.01);
    expect(releve.diagnostics.feet.right.maxToeHeightMeters).toBeLessThan(0.01);
  });
});
