import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  loadFixtures,
  probeMovement,
  runEval,
  torsoPitchDeg,
  kneeFlexionDeg,
  spineCurlDeg,
} from "../src/index.js";

const examplesDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../spec/examples",
);

describe("probe", () => {
  it("reports parse errors instead of throwing", () => {
    const r = probeMovement("not movit at all");
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.phases).toEqual([]);
  });

  it("returns world-space bones for every phase", () => {
    const r = probeMovement(
      ['movit exercise "t"', "  rig humanoid", '  step "go" 1s linear:', "    elbows: flex 90"].join("\n"),
    );
    expect(r.ok).toBe(true);
    expect(r.phases).toHaveLength(1);
    expect(r.phases[0]!.bones.size).toBe(17);
  });
});

describe("metrics", () => {
  const hinged = probeMovement(
    ['movit exercise "t"', "  rig humanoid", '  step "go" 1s linear:', "    hips: hinge 70"].join("\n"),
  ).phases[0]!;
  const standing = probeMovement(
    ['movit posture "t"', "  rig humanoid", '  step "go" 1s linear:', "    spine: hold neutral"].join("\n"),
  ).phases[0]!;

  it("measures torso pitch: ~0 standing, ~70 hinged", () => {
    expect(torsoPitchDeg(standing)).toBeLessThan(3);
    expect(torsoPitchDeg(hinged)).toBeGreaterThan(60);
  });

  it("measures knee flexion: straight legs ≈ 0", () => {
    expect(kneeFlexionDeg(standing, "left")).toBeLessThan(3);
    expect(kneeFlexionDeg(hinged, "left")).toBeLessThan(3);
  });

  it("a hinge keeps the spine straight (no curl)", () => {
    expect(spineCurlDeg(hinged)).toBeLessThan(5);
  });
});

describe("fixture scorecard", () => {
  it("every canonical example passes every invariant", () => {
    const report = runEval(loadFixtures(examplesDir));
    const failures = report.movements
      .flatMap((m) => m.checks.filter((c) => !c.pass).map((c) => `${m.movement}/${c.id}: ${c.detail}`));
    expect(failures).toEqual([]);
    expect(report.summary.parseFailures).toBe(0);
    expect(report.summary.clampWarnings).toBe(0);
  });
});
