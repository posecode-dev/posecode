import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { languageVersion, validatePosecode, version } from "../src/compat.js";

const SPORTS_MOVE = `posecode exercise "Crossover"
  rig humanoid
  pose start = standing
  step "Load" 0.4s settle:
    knees: flex 68
    ground-lock: feet
  step "Cross" 0.22s drive:
    turn: -14
    travel: -0.18 0
    ground-lock: feet
  repeat 2
`;

describe("embed compatibility contract", () => {
  it("validates current timing-mode documents without starting WebGL", () => {
    const result = validatePosecode(SPORTS_MOVE);
    expect(result.errors).toEqual([]);
    expect(result.ir?.phases.map((phase) => phase.easing)).toEqual(["settle", "drive"]);
  });

  it("keeps exported package metadata aligned with the package manifest", () => {
    const pkg = JSON.parse(
      readFileSync(resolve(import.meta.dirname, "../package.json"), "utf8"),
    ) as { version: string };
    expect(version).toBe(pkg.version);
    expect(languageVersion).toBe("0.3");
  });
});
