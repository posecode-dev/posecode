import { describe, expect, it } from "vitest";
import { buildMannequin } from "../src/mannequin.js";
import { floorContactHeight } from "../src/contacts.js";
import {
  GROUND_LOCK_PLANTED_MAX_Y,
  groundFigure,
  isGroundLockFootPlanted,
} from "../src/groundlock.js";
import { measureConstraintDiagnostics } from "../src/diagnostics.js";

describe("live constraint diagnostics", () => {
  it("treats a floor-pinned foot as an active support", () => {
    const m = buildMannequin();
    groundFigure(m);

    const diagnostics = measureConstraintDiagnostics(
      m,
      [],
      [{ effector: "foot_left", anchor: "floor" }],
    );

    expect(diagnostics.map((item) => item.id)).toEqual(expect.arrayContaining([
      "grounding:foot_left:toe-height",
      "grounding:foot_left:heel-height",
      "grounding:foot_left:sole-angle",
    ]));
    expect(diagnostics.some((item) => item.id.includes("foot_right"))).toBe(false);
  });

  it("uses ground-lock's exact planted predicate for a grouped swing foot", () => {
    const m = buildMannequin();
    groundFigure(m);
    const ankle = m.bones.get("ankle_left")!;

    ankle.position.y += GROUND_LOCK_PLANTED_MAX_Y + 0.005;
    m.root.updateMatrixWorld(true);
    expect(isGroundLockFootPlanted(floorContactHeight(m, "foot_left") ?? NaN)).toBe(false);
    expect(measureConstraintDiagnostics(m, ["feet"])
      .some((item) => item.id.includes("foot_left"))).toBe(false);
    expect(measureConstraintDiagnostics(m, ["foot_left"])
      .some((item) => item.id.includes("foot_left"))).toBe(true);
    expect(measureConstraintDiagnostics(
      m,
      [],
      [{ effector: "foot_left", anchor: "floor" }],
    ).some((item) => item.id.includes("foot_left"))).toBe(true);

    ankle.position.y -= 0.01;
    m.root.updateMatrixWorld(true);
    expect(isGroundLockFootPlanted(floorContactHeight(m, "foot_left") ?? NaN)).toBe(true);
    expect(measureConstraintDiagnostics(m, ["feet"])
      .some((item) => item.id === "grounding:foot_left:toe-height")).toBe(true);
  });

  it("defines the planted cutoff as an inclusive finite boundary", () => {
    expect(isGroundLockFootPlanted(GROUND_LOCK_PLANTED_MAX_Y)).toBe(true);
    expect(isGroundLockFootPlanted(GROUND_LOCK_PLANTED_MAX_Y + Number.EPSILON)).toBe(false);
    expect(isGroundLockFootPlanted(Number.NaN)).toBe(false);
    expect(isGroundLockFootPlanted(Infinity)).toBe(false);
  });
});
