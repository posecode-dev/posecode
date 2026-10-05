import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { probeMovement } from "../src/index.js";
import { kneeFlexionDeg, heightOf } from "../src/metrics.js";

const examplesDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../spec/examples",
);

function load(name: string): string {
  return readFileSync(resolve(examplesDir, `${name}.posecode`), "utf8");
}

describe("ballet examples domain validation (Issue #103)", () => {
  describe("Demi-plié", () => {
    it("starts from first-position, preserves turnout, flexes knees over feet, and anchors feet", () => {
      const result = probeMovement(load("demi-plie"));
      expect(result.ok).toBe(true);

      const plie = result.phases.find((p) => p.name === "Plié")!;
      const straighten = result.phases.find((p) => p.name === "Straighten")!;
      expect(plie).toBeDefined();
      expect(straighten).toBeDefined();

      // Knees flex deeply in plié and straighten in recovery
      expect(kneeFlexionDeg(plie, "left")).toBeGreaterThan(40);
      expect(kneeFlexionDeg(plie, "right")).toBeGreaterThan(40);
      expect(kneeFlexionDeg(straighten, "left")).toBeLessThan(5);
      expect(kneeFlexionDeg(straighten, "right")).toBeLessThan(5);

      // Both phases maintain ground-lock on feet
      expect(plie.groundLock).toContain("feet");
      expect(straighten.groundLock).toContain("feet");

      // Diagnoses heel lift under conservative 15° ROM
      const romConflict = result.diagnostics.warnings.find(
        (w) => w.kind === "grounding-rom-conflict" && w.phaseName === "Plié",
      );
      expect(romConflict).toBeDefined();
    });
  });

  describe("Elevé", () => {
    it("starts from first-position, keeps legs straight, and rises onto balls of feet without plié", () => {
      const result = probeMovement(load("eleve"));
      expect(result.ok).toBe(true);

      const rise = result.phases.find((p) => p.name === "Rise")!;
      const lower = result.phases.find((p) => p.name === "Lower")!;
      expect(rise).toBeDefined();
      expect(lower).toBeDefined();

      // No plié: legs stay straight throughout
      expect(kneeFlexionDeg(rise, "left")).toBeLessThan(5);
      expect(kneeFlexionDeg(rise, "right")).toBeLessThan(5);
      expect(kneeFlexionDeg(lower, "left")).toBeLessThan(5);
      expect(kneeFlexionDeg(lower, "right")).toBeLessThan(5);

      // Heels elevate off the floor in Rise while toes stay grounded
      expect(result.diagnostics.feet.left.maxToeHeightMeters).toBeLessThan(0.01);
      expect(result.diagnostics.feet.right.maxToeHeightMeters).toBeLessThan(0.01);
      expect(result.diagnostics.feet.left.maxTiptoeDriftMeters).toBeLessThan(0.04);
      expect(result.diagnostics.feet.right.maxTiptoeDriftMeters).toBeLessThan(0.04);

      // Controlled lowering returns feet to floor
      expect(lower.groundLock).toContain("feet");
    });
  });

  describe("Relevé", () => {
    it("begins with demi-plié before rising onto balls of feet, then lowers through plié", () => {
      const result = probeMovement(load("releve"));
      expect(result.ok).toBe(true);
      expect(result.phases.length).toBe(4);

      const [demiPlie, rise, lowerPlie, straighten] = result.phases;
      expect(demiPlie!.name).toBe("Demi-plié");
      expect(rise!.name).toBe("Rise to relevé");
      expect(lowerPlie!.name).toBe("Lower through plié");
      expect(straighten!.name).toBe("Straighten");

      // Phase 1: preparatory demi-plié
      expect(kneeFlexionDeg(demiPlie!, "left")).toBeGreaterThan(40);
      expect(kneeFlexionDeg(demiPlie!, "right")).toBeGreaterThan(40);

      // Phase 2: spring/rise to demi-pointe with straight legs
      expect(kneeFlexionDeg(rise!, "left")).toBeLessThan(5);
      expect(kneeFlexionDeg(rise!, "right")).toBeLessThan(5);

      // Phase 3: lower through demi-plié
      expect(kneeFlexionDeg(lowerPlie!, "left")).toBeGreaterThan(40);
      expect(kneeFlexionDeg(lowerPlie!, "right")).toBeGreaterThan(40);

      // Phase 4: recover to straight legs in first position
      expect(kneeFlexionDeg(straighten!, "left")).toBeLessThan(5);
      expect(kneeFlexionDeg(straighten!, "right")).toBeLessThan(5);

      // Toes remain grounded during rise
      expect(result.diagnostics.feet.left.maxToeHeightMeters).toBeLessThan(0.01);
    });
  });

  describe("Pirouette", () => {
    it("executes full 360° turn on pinned support foot with retiré gesture leg and plie landing", () => {
      const result = probeMovement(load("pirouette"));
      expect(result.ok).toBe(true);

      const prep = result.phases.find((p) => p.name === "Prep - plié")!;
      const spin = result.phases.find((p) => p.name === "Spot & spin")!;
      const land = result.phases.find((p) => p.name === "Land through plié")!;
      const recover = result.phases.find((p) => p.name === "Recover")!;

      expect(prep).toBeDefined();
      expect(spin).toBeDefined();
      expect(land).toBeDefined();
      expect(recover).toBeDefined();

      // Preparation plié
      expect(kneeFlexionDeg(prep, "left")).toBeGreaterThan(30);

      // Spin: full 360° turn (2π radians)
      expect(Math.abs(spin.rootYaw - 2 * Math.PI)).toBeLessThan(0.01);

      // Spin: standing left foot is pinned, knee is straight
      expect(spin.pins.some((p) => p.effector === "foot_left" && p.anchor === "floor")).toBe(true);
      expect(kneeFlexionDeg(spin, "left")).toBeLessThan(5);

      // Spin: right gesture leg is lifted in retiré (knee flexed > 90°)
      expect(kneeFlexionDeg(spin, "right")).toBeGreaterThan(90);
      expect(heightOf(spin, "ankle_right")).toBeGreaterThan(heightOf(spin, "ankle_left") + 0.2);

      // Landing: both knees absorb impact in plié
      expect(kneeFlexionDeg(land, "left")).toBeGreaterThan(20);
      expect(kneeFlexionDeg(land, "right")).toBeGreaterThan(20);
      expect(land.groundLock).toContain("feet");

      // Recover: return to straight legs
      expect(kneeFlexionDeg(recover, "left")).toBeLessThan(5);
      expect(kneeFlexionDeg(recover, "right")).toBeLessThan(5);
    });
  });

  describe("Chassé", () => {
    it("travels across the floor with alternating foot support and closes home in first position", () => {
      const result = probeMovement(load("chasse"));
      expect(result.ok).toBe(true);

      // Travels out at least 0.5m across the movement
      const maxDistance = Math.max(...result.phases.map((p) => Math.hypot(p.rootOffset[0], p.rootOffset[2])));
      expect(maxDistance).toBeGreaterThanOrEqual(0.48);

      // Closes home at origin (0, 0)
      const lastPhase = result.phases.at(-1)!;
      expect(Math.hypot(lastPhase.rootOffset[0], lastPhase.rootOffset[2])).toBeLessThan(0.01);

      // Alternating support feet (pins and reaches)
      const hasLeftPin = result.phases.some((p) => p.pins.some((pin) => pin.effector === "foot_left"));
      const hasRightPin = result.phases.some((p) => p.pins.some((pin) => pin.effector === "foot_right"));
      expect(hasLeftPin).toBe(true);
      expect(hasRightPin).toBe(true);
    });
  });
});
