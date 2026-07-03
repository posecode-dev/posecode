import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parse } from "../src/index.js";

// Every bundled example must parse cleanly AND stay within ROM (zero warnings),
// so the gallery never ships a broken or clamped demo. This also guards future
// additions: drop a `.movit` in spec/examples and it is validated automatically.
const EXAMPLES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../spec/examples",
);

const files = readdirSync(EXAMPLES_DIR).filter((f) => f.endsWith(".movit"));

describe("bundled examples", () => {
  it("finds the example documents", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s parses with no errors and no ROM warnings", (file) => {
    const source = readFileSync(join(EXAMPLES_DIR, file), "utf8");
    const { ir, errors, warnings } = parse(source);
    // Surface the offending detail in the failure message.
    expect({ file, errors }).toEqual({ file, errors: [] });
    expect({ file, warnings }).toEqual({ file, warnings: [] });
    expect(ir).not.toBeNull();
    expect(ir!.phases.length).toBeGreaterThan(0);
  });
});

describe("hip-hinge action", () => {
  const HINGE = [
    'movit exercise "Hinge"',
    "  rig humanoid",
    "  pose start = standing",
    '  step "Lower" 2s ease-in-out:',
    "    pelvis: hinge 80",
    "    ground-lock: feet",
    "  repeat 2",
  ].join("\n");

  it("accepts a pelvis hinge within ROM with no warnings", () => {
    const { ir, errors, warnings } = parse(HINGE);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
    const pelvis = ir!.phases[0]!.targets.find((t) => t.boneId === "pelvis")!;
    // hinge tips the torso forward — same sagittal direction as spine flex (+X,
    // the axial chain points up).
    expect(pelvis.euler.x).toBe(80);
  });

  it("clamps an over-deep hinge to the pelvis ROM ceiling", () => {
    const src = HINGE.replace("hinge 80", "hinge 200");
    const { ir, warnings } = parse(src);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.clamped).toBe(120);
    const pelvis = ir!.phases[0]!.targets.find((t) => t.boneId === "pelvis")!;
    expect(pelvis.euler.x).toBe(120);
  });
});
